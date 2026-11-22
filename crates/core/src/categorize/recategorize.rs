//! Recategorizing with rules: preview which transactions a change would move, apply it,
//! and the "Other" clean-up groups. Locked rows are never changed.

use super::rules::normalize_description;
use super::similarity::{similarity, MATCH_THRESHOLD};
use super::{is_payment_platform, learning};
use crate::error::Result;
use crate::transactions::{
    self, row_to_tx, Transaction, TransactionId, TransactionPatch, SELECT_COLS,
};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Which transactions a change applies to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Target {
    /// Same merchant key (plus fuzzy matches, flagged `similar`).
    Merchant(String),
    /// Normalized description contains this text (3 characters or more).
    Contains(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub transaction: Transaction,
    pub similar: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherGroup {
    pub merchant: String,
    pub count: i64,
    /// Sum of absolute amounts, in cents.
    pub total_cents: i64,
    pub platform: bool,
    pub sample_description: String,
    /// The bank's own category for these rows (most common), e.g. Amex "Restaurant-Restaurant".
    pub bank_category: Option<String>,
    /// The category that bank category points to, when one exists here.
    pub suggested_category_id: Option<i64>,
}

pub const MIN_CONTAINS: usize = 3;

/// Rows in "Other": the seeded Other category or no category, top-level only.
const IN_OTHER: &str = "parent_id IS NULL AND (category_id IS NULL OR category_id IN
    (SELECT id FROM categories WHERE legacy_name = 'Other'))";

/// Transactions in every profile that `target` matches and that are not already in
/// `category_id`, newest first.
pub fn preview(conn: &Connection, target: &Target, category_id: i64) -> Result<Vec<Match>> {
    let candidates = top_level_not_in(conn, category_id)?;
    let out = match target {
        Target::Merchant(key) => {
            let key = key.trim().to_lowercase();
            if key.is_empty() || is_payment_platform(&key) {
                return Ok(Vec::new());
            }
            candidates
                .into_iter()
                .filter_map(|t| {
                    if t.merchant == key {
                        Some((t, false))
                    } else if !is_payment_platform(&t.merchant)
                        && similarity(&t.merchant, &key) >= MATCH_THRESHOLD
                    {
                        Some((t, true))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        }
        Target::Contains(text) => {
            let text = normalize_description(text);
            if text.chars().count() < MIN_CONTAINS {
                return Ok(Vec::new());
            }
            candidates
                .into_iter()
                .filter(|t| !is_payment_platform(&t.merchant))
                .filter(|t| normalize_description(&t.description).contains(&text))
                .map(|t| (t, false))
                .collect()
        }
    };
    Ok(out
        .into_iter()
        .map(|(t, similar)| Match {
            locked: t.category_locked,
            similar,
            transaction: t,
        })
        .collect())
}

fn top_level_not_in(conn: &Connection, category_id: i64) -> Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM transactions
         WHERE parent_id IS NULL AND category_id IS NOT ?1
         ORDER BY posted_on DESC, id DESC"
    ))?;
    let rows = stmt.query_map([category_id], row_to_tx)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Move the unlocked transactions among `ids` to `category_id` and mark them reviewed,
/// in one database transaction. Returns how many changed.
pub fn apply(conn: &Connection, ids: &[TransactionId], category_id: i64) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let marks = vec!["?"; ids.len()].join(",");
    let mut args: Vec<rusqlite::types::Value> = vec![category_id.into()];
    args.extend(ids.iter().map(|&i| rusqlite::types::Value::from(i)));
    let n = tx.execute(
        &format!(
            "UPDATE transactions SET category_id = ?1, reviewed = 1, type = {ty},
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE category_locked = 0 AND id IN ({marks})",
            ty = crate::transactions::type_of_category_sql("?1")
        ),
        params_from_iter(args),
    )?;
    tx.commit()?;
    Ok(n)
}

/// A manual change to one transaction: set its category, mark it reviewed, and teach the
/// learned model its merchant (payment platforms are never learned).
pub fn set_one(conn: &Connection, id: TransactionId, category_id: i64) -> Result<()> {
    transactions::update(
        conn,
        id,
        &TransactionPatch {
            category_id: Some(Some(category_id)),
            reviewed: Some(true),
            ..Default::default()
        },
    )?;
    let t = transactions::get(conn, id)?;
    learning::learn(conn, &t.merchant, category_id, None)?;
    Ok(())
}

/// Other's transactions grouped by merchant key, largest group first.
/// Category names to try for a bank category ("Main-Sub"), most specific first.
fn bank_candidates(bank: &str) -> &'static [&'static str] {
    let lower = bank.trim().to_lowercase();
    let (main, sub) = lower.split_once('-').unwrap_or((lower.as_str(), ""));
    match (main, sub) {
        ("restaurant", "bar & café") | ("restaurant", "bar & cafe") => {
            &["coffee shop", "coffee", "drinks", "restaurants"]
        }
        ("restaurant", _) => &["restaurants", "dining", "food & dining"],
        ("transportation", "taxis & coach") => {
            &["rideshare", "taxi", "other transport", "transportation"]
        }
        ("transportation", "fuel") => &["fuel", "gas"],
        ("transportation", "parking charges") | ("transportation", "parking") => &["parking"],
        ("transportation", "tolls & fees") | ("transportation", "tolls") => &["tolls"],
        ("transportation", "rail services") | ("transportation", "mass transit") => {
            &["public transit", "other transport"]
        }
        ("transportation", "auto services") => &["car maintenance", "auto"],
        ("transportation", _) => &["other transport", "transportation"],
        ("merchandise & supplies", "groceries") => &["groceries"],
        ("merchandise & supplies", "pharmacies") => &["healthcare", "pharmacy"],
        ("merchandise & supplies", _) => &["shopping"],
        ("travel", _) => &["travel"],
        ("entertainment", _) => &["entertainment"],
        ("communications", _) => &["phone & internet", "internet", "phone"],
        ("business services", "insurance services") => &["insurance"],
        ("business services", "health care services") => &["healthcare"],
        ("business services", "mailing & shipping") => &["shipping"],
        ("other", "charities") => &["gifts & donations", "donations", "charity"],
        ("other", "education") => &["education"],
        ("fees & adjustments", _) => &["bank fees", "fees"],
        _ => &[],
    }
}

/// The category a bank category (Amex's "Restaurant-Restaurant") points to, among the
/// categories in use here; `None` when nothing fits.
pub fn bank_category_suggestion(conn: &Connection, bank: &str) -> Result<Option<i64>> {
    let candidates = bank_candidates(bank);
    if candidates.is_empty() {
        return Ok(None);
    }
    let mut stmt = conn.prepare(
        "SELECT id, lower(name) FROM categories WHERE archived = 0 AND kind = 'expense' AND (legacy_name IS NULL OR legacy_name <> 'Other')",
    )?;
    let names: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(candidates
        .iter()
        .find_map(|want| names.iter().find(|(_, n)| n == want).map(|(id, _)| *id)))
}

pub fn other_groups(conn: &Connection) -> Result<Vec<OtherGroup>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT merchant, count(*), sum(abs(amount_cents)), max(description)
         FROM transactions WHERE {IN_OTHER}
         GROUP BY merchant ORDER BY count(*) DESC, sum(abs(amount_cents)) DESC, merchant"
    ))?;
    let rows = stmt.query_map(params![], |r| {
        let merchant: String = r.get(0)?;
        Ok(OtherGroup {
            platform: is_payment_platform(&merchant),
            merchant,
            count: r.get(1)?,
            total_cents: r.get(2)?,
            sample_description: r.get(3)?,
            bank_category: None,
            suggested_category_id: None,
        })
    })?;
    let mut groups: Vec<OtherGroup> = rows.collect::<std::result::Result<_, _>>()?;
    // The bank's category per merchant: the most common "Category" statement detail.
    let mut bank = conn.prepare(&format!(
        "SELECT json_extract(j.value, '$[1]') AS c, count(*) FROM transactions t, json_each(t.details) j
         WHERE {IN_OTHER} AND t.merchant = ?1 AND json_extract(j.value, '$[0]') = 'Category'
         GROUP BY c ORDER BY count(*) DESC, c LIMIT 1"
    ))?;
    for g in groups.iter_mut() {
        let found: Option<String> = bank.query_row([&g.merchant], |r| r.get(0)).optional()?;
        if let Some(c) = found.filter(|c| !c.trim().is_empty()) {
            g.suggested_category_id = bank_category_suggestion(conn, &c)?;
            g.bank_category = Some(c);
        }
    }
    Ok(groups)
}

/// How many transactions are in Other.
pub fn other_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        &format!("SELECT count(*) FROM transactions WHERE {IN_OTHER}"),
        [],
        |r| r.get(0),
    )?)
}
