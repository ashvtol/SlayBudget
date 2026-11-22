//! One-time migration of Financial-Tracker's `transactions.json` and `ai-model.json`.

use super::number_occurrences;
use super::ParsedRow;
use crate::analytics::refunds;
use crate::categories;
use crate::categorize::learning;
use crate::error::{CoreError, Result};
use crate::profiles::{self, SourceKind};
use crate::transactions::{self, InsertOutcome, NewTransaction, TransactionPatch};
use chrono::NaiveDate;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyInput {
    pub transactions_json: String,
    pub model_json: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct LegacyReport {
    pub transactions_inserted: usize,
    pub transactions_duplicate: usize,
    pub transactions_skipped: usize,
    pub profiles_created: usize,
    pub sources_created: usize,
    pub categories_created: usize,
    pub merchants_learned: usize,
    pub merchants_skipped: usize,
}

#[derive(Deserialize)]
struct LegacyFile {
    transactions: Vec<LegacyTx>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyTx {
    date: String,
    description: String,
    amount: f64,
    category: String,
    source: String,
    user: String,
    #[serde(default)]
    is_expense: bool,
    #[serde(default)]
    is_immutable_category: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyModel {
    #[serde(default)]
    learning_model: BTreeMap<String, String>,
    #[serde(default)]
    custom_categories: Vec<String>,
}

fn source_kind(name: &str) -> SourceKind {
    let lower = name.to_lowercase();
    if lower == "citi" || lower.contains("checking") || lower.contains("debit") {
        SourceKind::Pdf
    } else {
        SourceKind::Csv
    }
}

/// Legacy amounts are magnitudes (floats) with a flag; convert to signed cents.
fn to_cents(amount: f64, is_expense: bool) -> i64 {
    let magnitude = (amount.abs() * 100.0).round() as i64;
    if is_expense {
        -magnitude
    } else {
        magnitude
    }
}

pub fn migrate_legacy(conn: &Connection, input: &LegacyInput) -> Result<LegacyReport> {
    let file: LegacyFile = serde_json::from_str(&input.transactions_json)
        .map_err(|e| CoreError::Invalid(format!("transactions.json: {e}")))?;
    let model: Option<LegacyModel> = match &input.model_json {
        Some(json) => Some(
            serde_json::from_str(json)
                .map_err(|e| CoreError::Invalid(format!("ai-model.json: {e}")))?,
        ),
        None => None,
    };
    let mut report = LegacyReport::default();
    let categories_before = categories::list(conn)?.len();

    // Custom categories first, so they exist even when no transaction uses them yet.
    if let Some(m) = &model {
        for name in &m.custom_categories {
            categories::find_or_create_by_legacy_name(conn, name)?;
        }
    }

    // Group rows by (user, source) so occurrence numbering matches the importer's.
    let mut groups: BTreeMap<(String, String), Vec<(ParsedRow, &LegacyTx)>> = BTreeMap::new();
    for tx in &file.transactions {
        let Some(posted_on) = tx
            .date
            .get(..10)
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        else {
            report.transactions_skipped += 1;
            continue;
        };
        let amount_cents = to_cents(tx.amount, tx.is_expense);
        if amount_cents == 0 || tx.description.trim().is_empty() {
            report.transactions_skipped += 1;
            continue;
        }
        let row = ParsedRow {
            posted_on,
            description: tx.description.trim().to_string(),
            amount_cents,
            occurrence: 0,
            pending: false,
            raw_category: Some(tx.category.clone()),
            details: Vec::new(),
        };
        groups
            .entry((tx.user.clone(), tx.source.clone()))
            .or_default()
            .push((row, tx));
    }

    for ((user, source), mut rows) in groups {
        let profiles_before = profiles::list(conn)?.len();
        let profile_id = match profiles::list(conn)?.into_iter().find(|p| p.name == user) {
            Some(p) => p.id,
            None => profiles::create(conn, &user, None)?,
        };
        report.profiles_created += profiles::list(conn)?.len() - profiles_before;

        let sources_before = profiles::list_sources(conn, profile_id)?.len();
        let source_id =
            profiles::find_or_create_source(conn, profile_id, &source, source_kind(&source))?;
        report.sources_created += profiles::list_sources(conn, profile_id)?.len() - sources_before;

        let mut parsed: Vec<ParsedRow> = rows.iter().map(|(r, _)| r.clone()).collect();
        number_occurrences(&mut parsed);
        for (row, (_, tx)) in parsed.iter().zip(rows.iter_mut()) {
            let category_id = categories::find_or_create_by_legacy_name(conn, &tx.category)?;
            let new_tx = NewTransaction {
                profile_id,
                source_id,
                posted_on: row.posted_on,
                description: row.description.clone(),
                amount_cents: row.amount_cents,
                currency: "USD".into(),
                occurrence: row.occurrence,
                category_id: Some(category_id),
                import_id: None,
            };
            match transactions::insert(conn, &new_tx)? {
                InsertOutcome::Inserted(id) => {
                    report.transactions_inserted += 1;
                    transactions::update(
                        conn,
                        id,
                        &TransactionPatch {
                            reviewed: Some(true),
                            category_locked: Some(tx.is_immutable_category),
                            ..Default::default()
                        },
                    )?;
                }
                InsertOutcome::Duplicate(_) => report.transactions_duplicate += 1,
            }
        }
        if report.transactions_inserted > 0 {
            refunds::rematch(conn, Some(profile_id))?;
        }
    }

    if let Some(m) = &model {
        for (merchant, category) in &m.learning_model {
            let category_id = categories::find_or_create_by_legacy_name(conn, category)?;
            if learning::learn(conn, merchant, category_id, None)? {
                report.merchants_learned += 1;
            } else {
                report.merchants_skipped += 1;
            }
        }
    }

    report.categories_created = categories::list(conn)?.len() - categories_before;
    // Save detected bills (first data) or link the new rows to saved ones.
    crate::recurrings::after_import(conn)?;
    Ok(report)
}
