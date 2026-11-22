//! User-defined rules, applied before the learned model.

use crate::error::{CoreError, Result};
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    Contains,
    StartsWith,
    Equals,
    Regex,
    /// Equals the extracted merchant key.
    Merchant,
}

impl MatchKind {
    fn as_str(self) -> &'static str {
        match self {
            MatchKind::Contains => "contains",
            MatchKind::StartsWith => "starts_with",
            MatchKind::Equals => "equals",
            MatchKind::Regex => "regex",
            MatchKind::Merchant => "merchant",
        }
    }
    fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "contains" => MatchKind::Contains,
            "starts_with" => MatchKind::StartsWith,
            "equals" => MatchKind::Equals,
            "regex" => MatchKind::Regex,
            "merchant" => MatchKind::Merchant,
            other => return Err(CoreError::Invalid(format!("unknown match kind {other}"))),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRule {
    pub name: String,
    pub match_kind: MatchKind,
    /// Compared case-insensitively against the description. Regex patterns are compiled case-insensitive.
    pub pattern: String,
    /// Bounds on the absolute amount, in cents.
    pub min_cents: Option<i64>,
    pub max_cents: Option<i64>,
    pub source_id: Option<i64>,
    pub category_id: i64,
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: i64,
    pub name: String,
    pub match_kind: MatchKind,
    pub pattern: String,
    pub min_cents: Option<i64>,
    pub max_cents: Option<i64>,
    pub source_id: Option<i64>,
    pub category_id: i64,
    pub priority: i64,
    pub enabled: bool,
}

pub struct RuleInput<'a> {
    pub description: &'a str,
    /// The extracted merchant key (`extract_merchant`), for `Merchant` rules.
    pub merchant: &'a str,
    pub amount_cents: i64,
    pub source_id: i64,
}

fn compile(pattern: &str) -> Result<Regex> {
    Regex::new(&format!("(?i){pattern}"))
        .map_err(|e| CoreError::Invalid(format!("invalid regex: {e}")))
}

pub fn create(conn: &Connection, rule: &NewRule) -> Result<i64> {
    if rule.pattern.trim().is_empty() {
        return Err(CoreError::Invalid("rule pattern is empty".into()));
    }
    if rule.match_kind == MatchKind::Regex {
        compile(&rule.pattern)?;
    }
    conn.execute(
        "INSERT INTO rules (name, match_kind, pattern, min_cents, max_cents, source_id, category_id, priority)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![rule.name.trim(), rule.match_kind.as_str(), rule.pattern.trim(), rule.min_cents, rule.max_cents, rule.source_id, rule.category_id, rule.priority],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Lower-case, with `-`, `#`, `*` and runs of whitespace turned into single spaces.
pub fn normalize_description(s: &str) -> String {
    s.to_lowercase()
        .split(|c: char| c.is_whitespace() || matches!(c, '-' | '#' | '*'))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Save a rule, replacing any with the same kind and pattern. It gets the highest
/// priority, so the newest rule runs first.
pub fn save_or_replace(conn: &Connection, rule: &NewRule) -> Result<i64> {
    let pattern = match rule.match_kind {
        MatchKind::Contains | MatchKind::Merchant => normalize_description(&rule.pattern),
        _ => rule.pattern.trim().to_string(),
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM rules WHERE match_kind = ?1 AND lower(pattern) = lower(?2)",
        params![rule.match_kind.as_str(), pattern],
    )?;
    let top: i64 = tx.query_row("SELECT coalesce(max(priority), 0) FROM rules", [], |r| {
        r.get(0)
    })?;
    let id = create(
        &tx,
        &NewRule {
            pattern,
            priority: top + 1,
            ..rule.clone()
        },
    )?;
    tx.commit()?;
    Ok(id)
}

pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE rules SET enabled = ?1 WHERE id = ?2",
        params![enabled as i64, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM rules WHERE id = ?1", [id])?;
    Ok(())
}

/// Highest priority first, then oldest first.
pub fn list(conn: &Connection) -> Result<Vec<Rule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, match_kind, pattern, min_cents, max_cents, source_id, category_id, priority, enabled
         FROM rules ORDER BY priority DESC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        let kind: String = r.get(2)?;
        Ok((
            Rule {
                id: r.get(0)?,
                name: r.get(1)?,
                match_kind: MatchKind::Contains,
                pattern: r.get(3)?,
                min_cents: r.get(4)?,
                max_cents: r.get(5)?,
                source_id: r.get(6)?,
                category_id: r.get(7)?,
                priority: r.get(8)?,
                enabled: r.get::<_, i64>(9)? != 0,
            },
            kind,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (mut rule, kind) = row?;
        rule.match_kind = MatchKind::parse(&kind)?;
        out.push(rule);
    }
    Ok(out)
}

/// The category of the first enabled rule that matches, if any.
pub fn apply(conn: &Connection, input: &RuleInput<'_>) -> Result<Option<i64>> {
    // Payment platforms are categorized one transaction at a time, never by a rule.
    if super::is_payment_platform(input.merchant) {
        return Ok(None);
    }
    let rules = list(conn)?;
    for rule in rules.iter().filter(|r| r.enabled) {
        if matches(rule, input)? {
            return Ok(Some(rule.category_id));
        }
    }
    Ok(None)
}

fn matches(rule: &Rule, input: &RuleInput<'_>) -> Result<bool> {
    let magnitude = input.amount_cents.abs();
    if rule.min_cents.is_some_and(|m| magnitude < m)
        || rule.max_cents.is_some_and(|m| magnitude > m)
    {
        return Ok(false);
    }
    if rule.source_id.is_some_and(|s| s != input.source_id) {
        return Ok(false);
    }
    let desc = input.description.trim().to_lowercase();
    let pat = rule.pattern.to_lowercase();
    Ok(match rule.match_kind {
        MatchKind::Contains => normalize_description(&desc).contains(&normalize_description(&pat)),
        MatchKind::Merchant => input.merchant.trim().to_lowercase() == pat.trim(),
        MatchKind::StartsWith => desc.starts_with(&pat),
        MatchKind::Equals => desc == pat,
        MatchKind::Regex => compile(&rule.pattern)?.is_match(&desc),
    })
}
