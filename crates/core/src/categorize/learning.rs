//! The learning model: merchant key -> category, taught by the user's corrections.

use super::is_payment_platform;
use super::similarity::{similarity, MATCH_THRESHOLD};
use crate::error::Result;
use crate::profiles::ProfileId;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MerchantRule {
    pub id: i64,
    pub merchant: String,
    pub category_id: i64,
    pub profile_id: Option<ProfileId>,
    pub hits: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Suggestion {
    pub category_id: i64,
    /// The learned merchant key that matched.
    pub matched: String,
    pub score: f64,
}

/// Remember that `merchant` belongs to `category_id`. Returns false when the
/// merchant is a payment platform, which is never learned.
pub fn learn(
    conn: &Connection,
    merchant: &str,
    category_id: i64,
    profile_id: Option<ProfileId>,
) -> Result<bool> {
    let merchant = merchant.trim().to_lowercase();
    if merchant.is_empty() || is_payment_platform(&merchant) {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO merchant_rules (merchant, category_id, profile_id, hits) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(merchant, coalesce(profile_id, 0)) DO UPDATE SET
            category_id = excluded.category_id,
            hits = hits + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![merchant, category_id, profile_id],
    )?;
    Ok(true)
}

pub fn forget(conn: &Connection, merchant: &str, profile_id: Option<ProfileId>) -> Result<()> {
    conn.execute(
        "DELETE FROM merchant_rules WHERE merchant = ?1 AND profile_id IS ?2",
        params![merchant.trim().to_lowercase(), profile_id],
    )?;
    Ok(())
}

pub fn reset(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM merchant_rules", [])?;
    Ok(())
}

pub fn list(conn: &Connection) -> Result<Vec<MerchantRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, merchant, category_id, profile_id, hits FROM merchant_rules ORDER BY merchant",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MerchantRule {
            id: r.get(0)?,
            merchant: r.get(1)?,
            category_id: r.get(2)?,
            profile_id: r.get(3)?,
            hits: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Best category for a merchant key: exact match first, then the highest fuzzy
/// score at or above the threshold. Profile-scoped rules win over global ones.
pub fn suggest(
    conn: &Connection,
    merchant: &str,
    profile_id: Option<ProfileId>,
) -> Result<Option<Suggestion>> {
    let merchant = merchant.trim().to_lowercase();
    if merchant.is_empty() || is_payment_platform(&merchant) {
        return Ok(None);
    }
    let rules = list(conn)?;
    let scoped: Vec<&MerchantRule> = rules
        .iter()
        .filter(|r| r.profile_id.is_some() && r.profile_id == profile_id)
        .collect();
    let global: Vec<&MerchantRule> = rules.iter().filter(|r| r.profile_id.is_none()).collect();
    for set in [scoped, global] {
        if let Some(s) = best(&set, &merchant) {
            return Ok(Some(s));
        }
    }
    Ok(None)
}

fn best(rules: &[&MerchantRule], merchant: &str) -> Option<Suggestion> {
    if let Some(r) = rules.iter().find(|r| r.merchant == merchant) {
        return Some(Suggestion {
            category_id: r.category_id,
            matched: r.merchant.clone(),
            score: 1.0,
        });
    }
    rules
        .iter()
        .map(|r| (r, similarity(merchant, &r.merchant)))
        .filter(|(_, s)| *s >= MATCH_THRESHOLD)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(r, score)| Suggestion {
            category_id: r.category_id,
            matched: r.merchant.clone(),
            score,
        })
}
