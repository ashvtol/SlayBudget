//! Import Financial-Tracker's learned merchants (`ai-model.json`) after the user reviews them.
//! Only transactions still in Other (or uncategorized) and not locked are moved.

use crate::categories::{self, normalized_name, CategoryId};
use crate::categorize::{is_payment_platform, learning};
use crate::error::{CoreError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum FtTarget {
    Existing(CategoryId),
    /// Create this Financial-Tracker category on import.
    New(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtProposal {
    pub merchant: String,
    pub ft_category: String,
    pub target: FtTarget,
    /// Transactions this would move out of Other now.
    pub moves: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtChoice {
    pub merchant: String,
    pub target: FtTarget,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtReport {
    pub learned: usize,
    pub moved: usize,
    pub created: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    #[serde(default)]
    learning_model: BTreeMap<String, String>,
}

/// Read either Financial-Tracker's `ai-model.json` or SlayBudget's own rules export
/// (its learned merchants; explicit rules aren't imported here).
fn parse_model(json: &str) -> Result<Model> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| CoreError::Invalid(format!("rules file: {e}")))?;
    if value.get("format").and_then(|f| f.as_str()) == Some(crate::categorize::export::FORMAT) {
        let file: crate::categorize::export::RulesFile = serde_json::from_value(value)
            .map_err(|e| CoreError::Invalid(format!("rules file: {e}")))?;
        let learning_model = file
            .learned
            .into_iter()
            .map(|l| (l.merchant, l.category))
            .collect();
        return Ok(Model { learning_model });
    }
    serde_json::from_value(value).map_err(|e| CoreError::Invalid(format!("ai-model.json: {e}")))
}

const MOVABLE: &str = "parent_id IS NULL AND category_locked = 0 AND merchant = ?1 AND
    (category_id IS NULL OR category_id IN (SELECT id FROM categories WHERE legacy_name = 'Other'))";

/// One proposal per learned merchant (payment platforms left out), sorted by FT category.
pub fn preview(conn: &Connection, model_json: &str) -> Result<Vec<FtProposal>> {
    let model = parse_model(model_json)?;
    let mut targets: HashMap<String, FtTarget> = HashMap::new();
    let mut out = Vec::new();
    for (merchant, ft_category) in model.learning_model {
        let merchant = merchant.trim().to_lowercase();
        if merchant.is_empty() || is_payment_platform(&merchant) {
            continue;
        }
        let target = match targets.get(&ft_category) {
            Some(t) => t.clone(),
            None => {
                let t = propose(conn, &ft_category)?;
                targets.insert(ft_category.clone(), t.clone());
                t
            }
        };
        let moves = conn.query_row(
            &format!("SELECT count(*) FROM transactions WHERE {MOVABLE}"),
            [&merchant],
            |r| r.get(0),
        )?;
        out.push(FtProposal {
            merchant,
            ft_category,
            target,
            moves,
        });
    }
    out.sort_by(|a, b| {
        a.ft_category
            .cmp(&b.ft_category)
            .then(a.merchant.cmp(&b.merchant))
    });
    Ok(out)
}

/// The legacy-name match, else an existing category whose normalized name equals the FT
/// name's last part (after " - ") or its first word ("Coffee Shop" -> Coffee), else new.
fn propose(conn: &Connection, ft_category: &str) -> Result<FtTarget> {
    if let Some(c) = categories::find_by_legacy_name(conn, ft_category)? {
        return Ok(FtTarget::Existing(c.id));
    }
    let last = ft_category.rsplit(" - ").next().unwrap_or(ft_category);
    let wanted = normalized_name(last);
    let first = wanted.split_whitespace().next().unwrap_or("").to_string();
    let all = categories::list(conn)?;
    let found = all
        .iter()
        .find(|c| normalized_name(&c.name) == wanted)
        .or_else(|| {
            all.iter()
                .find(|c| !first.is_empty() && normalized_name(&c.name) == first)
        });
    Ok(match found {
        Some(c) => FtTarget::Existing(c.id),
        None => FtTarget::New(ft_category.trim().to_string()),
    })
}

/// Learn each chosen merchant and move its unlocked Other transactions, in one transaction.
pub fn apply(conn: &Connection, choices: &[FtChoice]) -> Result<FtReport> {
    let tx = conn.unchecked_transaction()?;
    let mut report = FtReport::default();
    let mut created: HashMap<String, CategoryId> = HashMap::new();
    for choice in choices {
        let merchant = choice.merchant.trim().to_lowercase();
        let category_id = match &choice.target {
            FtTarget::Existing(id) => *id,
            FtTarget::New(name) => {
                // Key by the name the category would get ("Wedding - Venue" -> "venue"),
                // and reuse any category already named that, so nothing is created twice.
                let last = name.rsplit(" - ").next().unwrap_or(name);
                let key = normalized_name(last);
                match created.get(&key) {
                    Some(id) => *id,
                    None => {
                        let id = match categories::find_by_legacy_name(&tx, name)? {
                            Some(c) => c.id,
                            None => match categories::list(&tx)?
                                .into_iter()
                                .find(|c| normalized_name(&c.name) == key)
                            {
                                Some(c) => c.id,
                                None => {
                                    report.created += 1;
                                    categories::find_or_create_by_legacy_name(&tx, name)?
                                }
                            },
                        };
                        created.insert(key, id);
                        id
                    }
                }
            }
        };
        if !learning::learn(&tx, &merchant, category_id, None)? {
            continue;
        }
        report.learned += 1;
        report.moved += tx.execute(
            &format!(
                "UPDATE transactions SET category_id = ?2, reviewed = 1, type = {ty},
                category_source = 'user', category_reason = NULL, suggested_category_id = NULL, suggested_reason = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE {MOVABLE}",
                ty = crate::transactions::type_of_category_sql("?2")
            ),
            params![merchant, category_id],
        )?;
    }
    tx.commit()?;
    Ok(report)
}
