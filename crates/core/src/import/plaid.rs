//! Map Plaid transactions into our model and import them.
//!
//! Plaid's `amount` is positive when money leaves the account (an expense) and
//! negative when money enters (income) — the opposite of our convention — so we
//! flip the sign. Transaction-level dedupe (by content hash) makes re-syncing
//! the same window idempotent.

use super::pipeline::{import_rows, ImportReport, StatementKind};
use super::ParsedRow;
use crate::error::Result;
use crate::profiles::{ProfileId, SourceId};
use chrono::NaiveDate;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// The subset of a Plaid `/transactions/sync` item we use.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaidTxn {
    pub transaction_id: String,
    pub account_id: String,
    /// `YYYY-MM-DD`.
    pub date: String,
    pub name: String,
    pub merchant_name: Option<String>,
    /// Plaid sign: positive = money out, negative = money in.
    pub amount: f64,
    pub iso_currency_code: Option<String>,
    #[serde(default)]
    pub pending: bool,
}

/// Convert one Plaid transaction to a ParsedRow (sign flipped to our convention).
pub fn to_parsed_row(txn: &PlaidTxn, occurrence: u32) -> Result<ParsedRow> {
    let posted_on = NaiveDate::parse_from_str(&txn.date, "%Y-%m-%d").map_err(|e| {
        crate::error::CoreError::Invalid(format!("bad Plaid date '{}': {e}", txn.date))
    })?;
    let description = txn
        .merchant_name
        .clone()
        .unwrap_or_else(|| txn.name.clone());
    let amount_cents = -(txn.amount * 100.0).round() as i64;
    Ok(ParsedRow {
        posted_on,
        description,
        amount_cents,
        occurrence,
        pending: txn.pending,
        raw_category: None,
        details: Vec::new(),
    })
}

/// Import a batch of Plaid transactions for one account into `source_id`.
/// Idempotent across syncs: duplicate transactions are skipped by hash.
pub fn import_plaid(
    conn: &Connection,
    profile_id: ProfileId,
    source_id: SourceId,
    txns: &[PlaidTxn],
) -> Result<ImportReport> {
    // Assign an occurrence index within identical (date, description, amount) tuples.
    let mut seen: std::collections::HashMap<(String, String, i64), u32> =
        std::collections::HashMap::new();
    let mut rows = Vec::with_capacity(txns.len());
    for txn in txns.iter().filter(|t| !t.pending) {
        let row = to_parsed_row(txn, 0)?;
        let key = (txn.date.clone(), row.description.clone(), row.amount_cents);
        let occ = seen.entry(key).or_insert(0);
        let mut row = row;
        row.occurrence = *occ;
        *occ += 1;
        rows.push(row);
    }
    // A unique synthetic file hash per sync: transaction-level dedupe still
    // prevents duplicate rows, so re-syncing a window is safe.
    let sync_tag = format!("plaid-sync:{source_id}:{}", chrono::Utc::now().timestamp());
    let hash = {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(sync_tag.as_bytes()))
    };
    import_rows(
        conn,
        profile_id,
        source_id,
        "Plaid sync",
        &hash,
        StatementKind::Generic,
        rows,
    )
}
