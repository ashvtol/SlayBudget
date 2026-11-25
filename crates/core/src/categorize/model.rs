//! The learning classifier: multinomial naive Bayes over the words and letters of a description. Its counts live in
//! the database (`model_counts`, `model_totals`), so learning from a correction is an increment, not a retrain. It
//! runs only on this computer.

use super::rules::normalize_description;
use crate::accounts::AccountType;
use crate::error::Result;
use rusqlite::{params, Connection};
use std::collections::{BTreeSet, HashMap};

/// Laplace smoothing.
const ALPHA: f64 = 1.0;
/// Auto-apply at this probability or more, with at least `AUTO_MARGIN`.
pub const AUTO_PROBABILITY: f64 = 0.90;
pub const AUTO_MARGIN: f64 = 0.5;
/// Suggest at this probability or more.
pub const SUGGEST_PROBABILITY: f64 = 0.60;

/// Payment-processor prefixes in descriptions ("TST* JOES", "SQ *BLUE BTL").
const PREFIXES: &[&str] = &[
    "tst", "sq", "sp", "paypal", "dd", "ic", "pos", "ach", "py", "tock", "bt", "cke", "fs", "pp",
    "goog", "apple", "amzn", "doordash", "ubr", "lyft",
];

/// What the classifier sees in one transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Features(pub Vec<String>);

/// The classifier's best category, how sure it is, and the next best.
#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    pub category_id: i64,
    /// Softmax of the log scores, 0 to 1.
    pub probability: f64,
    /// Lead over the runner-up in log score, per known feature (does not grow with description length).
    pub margin: f64,
    pub runner_up: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Band {
    Auto,
    Suggest,
    None,
}

/// Letters (3 to 5 in a row) of the merchant key, words of the description, a processor prefix, money in or out, and
/// the account type.
pub fn features(
    description: &str,
    merchant: &str,
    amount_cents: i64,
    account: Option<AccountType>,
) -> Features {
    let mut set = BTreeSet::new();
    let key: Vec<char> = merchant.trim().to_lowercase().chars().collect();
    if !key.is_empty() && key.len() < 3 {
        set.insert(format!("c:{}", key.iter().collect::<String>()));
    }
    for n in 3..=5 {
        for w in key.windows(n) {
            set.insert(format!("c:{}", w.iter().collect::<String>()));
        }
    }
    let normalized = normalize_description(description);
    let words: Vec<&str> = normalized.split(' ').filter(|w| !w.is_empty()).collect();
    if let Some(first) = words.first() {
        let bare = first.trim_end_matches(['*', '.']);
        if PREFIXES.contains(&bare) {
            set.insert(format!("p:{bare}"));
        }
    }
    for w in &words {
        let digits = w.chars().filter(char::is_ascii_digit).count();
        if w.chars().count() >= 2 && digits * 2 < w.chars().count() {
            set.insert(format!("w:{w}"));
        }
    }
    set.insert(if amount_cents > 0 { "d:in" } else { "d:out" }.to_string());
    if let Some(a) = account {
        set.insert(format!("a:{}", a.as_str()));
    }
    Features(set.into_iter().collect())
}

/// Add `weight` for these features to a category; a negative weight unlearns. Nothing goes below zero.
pub fn train(conn: &Connection, f: &Features, category_id: i64, weight: f64) -> Result<()> {
    if f.0.is_empty() || weight == 0.0 {
        return Ok(());
    }
    let mut count = conn.prepare_cached(
        "INSERT INTO model_counts (feature, category_id, weight) VALUES (?1, ?2, max(0, ?3))
         ON CONFLICT(feature, category_id) DO UPDATE SET weight = weight + excluded.weight",
    )?;
    let mut removed = 0.0;
    for feature in &f.0 {
        if weight < 0.0 {
            let had: f64 = conn
                .query_row(
                    "SELECT coalesce((SELECT weight FROM model_counts WHERE feature = ?1 AND category_id = ?2), 0)",
                    params![feature, category_id],
                    |r| r.get(0),
                )?;
            removed += had.min(-weight);
            conn.execute(
                "UPDATE model_counts SET weight = max(0, weight + ?3) WHERE feature = ?1 AND category_id = ?2",
                params![feature, category_id, weight],
            )?;
        } else {
            count.execute(params![feature, category_id, weight])?;
        }
    }
    let tokens = if weight < 0.0 {
        -removed
    } else {
        weight * f.0.len() as f64
    };
    conn.execute(
        "INSERT INTO model_totals (category_id, docs, tokens) VALUES (?1, max(0, ?2), max(0, ?3))
         ON CONFLICT(category_id) DO UPDATE SET docs = max(0, docs + ?2), tokens = max(0, tokens + ?3)",
        params![category_id, weight, tokens],
    )?;
    conn.execute("DELETE FROM model_counts WHERE weight <= 0", [])?;
    Ok(())
}

/// The most likely category among the categories that still exist, or None when nothing was learned or none of the
/// features was ever seen.
pub fn predict(conn: &Connection, f: &Features) -> Result<Option<Prediction>> {
    let mut stmt = conn.prepare_cached(
        "SELECT t.category_id, t.docs, t.tokens FROM model_totals t JOIN categories c ON c.id = t.category_id
         WHERE t.docs > 0",
    )?;
    let totals: Vec<(i64, f64, f64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    if totals.is_empty() {
        return Ok(None);
    }
    let vocabulary: f64 = conn.query_row(
        "SELECT count(DISTINCT feature) FROM model_counts",
        [],
        |r| r.get(0),
    )?;
    let mut counts: HashMap<(String, i64), f64> = HashMap::new();
    let mut known = Vec::new();
    {
        let mut q =
            conn.prepare_cached("SELECT category_id, weight FROM model_counts WHERE feature = ?1")?;
        for feature in &f.0 {
            let rows: Vec<(i64, f64)> = q
                .query_map([feature], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            if rows.is_empty() {
                continue;
            }
            known.push(feature.clone());
            for (c, w) in rows {
                counts.insert((feature.clone(), c), w);
            }
        }
    }
    // Money in or out and the account type say nothing about the merchant: something of the merchant itself must
    // have been seen before.
    if !known
        .iter()
        .any(|k| !k.starts_with("d:") && !k.starts_with("a:"))
    {
        return Ok(None);
    }
    let all_docs: f64 = totals.iter().map(|t| t.1).sum();
    let k = totals.len() as f64;
    let mut scores: Vec<(i64, f64)> = totals
        .iter()
        .map(|&(c, docs, tokens)| {
            let prior = ((docs + ALPHA) / (all_docs + ALPHA * k)).ln();
            let denom = tokens + ALPHA * vocabulary;
            let likelihood: f64 = known
                .iter()
                .map(|feat| {
                    let n = counts.get(&(feat.clone(), c)).copied().unwrap_or(0.0);
                    ((n + ALPHA) / denom).ln()
                })
                .sum();
            (c, prior + likelihood)
        })
        .collect();
    scores.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let top = scores[0].1;
    let sum: f64 = scores.iter().map(|s| (s.1 - top).exp()).sum();
    let (runner_up, margin) = match scores.get(1) {
        Some(&(c, s)) => (Some(c), (top - s) / known.len() as f64),
        None => (None, f64::INFINITY),
    };
    Ok(Some(Prediction {
        category_id: scores[0].0,
        probability: 1.0 / sum,
        margin,
        runner_up,
    }))
}

/// The classifier's answer, with the starter list's known merchants taking precedence until your own examples say
/// otherwise: one row from a curated list is weak evidence against generic words ("store"), but it is a lookup.
pub fn classify(conn: &Connection, merchant: &str, f: &Features) -> Result<Option<Prediction>> {
    let predicted = predict(conn, f)?;
    let Some(entry) = super::starter::lookup(merchant) else {
        return Ok(predicted);
    };
    let Some(known) = super::starter::target(conn, entry)? else {
        return Ok(predicted);
    };
    // The list is about where money goes: money coming in to a shop is a refund, not a purchase.
    let expense: bool = conn.query_row(
        "SELECT kind = 'expense' FROM categories WHERE id = ?1",
        [known],
        |r| r.get(0),
    )?;
    if expense && f.0.iter().any(|x| x == "d:in") {
        return Ok(predicted);
    }
    if let Some(p) = &predicted {
        if p.category_id == known || yours_like(conn, merchant, p.category_id)? > 0 {
            return Ok(predicted);
        }
    }
    Ok(Some(Prediction {
        category_id: known,
        probability: AUTO_PROBABILITY,
        margin: AUTO_MARGIN,
        runner_up: predicted.map(|p| p.category_id),
    }))
}

/// Auto-apply, suggest, or leave it.
pub fn band(p: &Prediction) -> Band {
    if p.probability >= AUTO_PROBABILITY && p.margin >= AUTO_MARGIN {
        Band::Auto
    } else if p.probability >= SUGGEST_PROBABILITY {
        Band::Suggest
    } else {
        Band::None
    }
}

/// Forget everything the classifier learned.
pub fn reset(conn: &Connection) -> Result<()> {
    conn.execute_batch("DELETE FROM model_counts; DELETE FROM model_totals;")?;
    Ok(())
}

/// Why this merchant belongs in this category, from your own examples: "Like 6 others you put in Coffee Shop (Blue
/// Bottle, Philz)", or "Known merchant: Starbucks" from the starter list.
pub fn explain(conn: &Connection, merchant: &str, category_id: i64) -> Result<String> {
    let name = crate::categories::get(conn, category_id)?.name;
    let merchant = merchant.trim().to_lowercase();
    let like = like_yours(conn, &merchant, category_id)?;
    let n: i64 = like.iter().map(|(_, c)| c).sum();
    if n > 0 {
        let names: Vec<String> = like.iter().take(2).map(|(m, _)| title(m)).collect();
        let others = if n == 1 { "other" } else { "others" };
        return Ok(format!(
            "Like {n} {others} you put in {name} ({})",
            names.join(", ")
        ));
    }
    if let Some(e) = super::starter::lookup(&merchant) {
        if super::starter::target(conn, e)? == Some(category_id) {
            return Ok(format!("Known merchant: {}", title(e.pattern)));
        }
    }
    Ok(format!("Looks like your other {name} transactions"))
}

/// Your rows in this category from this merchant or one sharing a word with it: (merchant, rows), most first.
fn like_yours(conn: &Connection, merchant: &str, category_id: i64) -> Result<Vec<(String, i64)>> {
    let merchant = merchant.trim().to_lowercase();
    let words: Vec<&str> = merchant
        .split_whitespace()
        .filter(|w| w.chars().count() >= 3 && !w.chars().any(|c| c.is_ascii_digit()))
        .collect();
    let mut stmt = conn.prepare_cached(
        "SELECT merchant, count(*) FROM transactions
         WHERE category_id = ?1 AND category_source = 'user' AND parent_id IS NULL
         GROUP BY merchant ORDER BY count(*) DESC, merchant",
    )?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([category_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|(m, _)| *m == merchant || m.split_whitespace().any(|w| words.contains(&w)))
        .collect())
}

fn yours_like(conn: &Connection, merchant: &str, category_id: i64) -> Result<i64> {
    Ok(like_yours(conn, merchant, category_id)?
        .iter()
        .map(|(_, c)| c)
        .sum())
}

/// "blue bottle" -> "Blue Bottle".
pub fn title(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}
