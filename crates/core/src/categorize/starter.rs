//! Starter knowledge shipped with the app: common US merchants and descriptor patterns, each mapped to categories by
//! name. It seeds the classifier at weight 1, so a new install guesses sensibly before it has learned anything, and the
//! user's own corrections (weight 3) soon outweigh it.

use super::model;
use super::rules::normalize_description;
use crate::error::Result;
use crate::settings;
use rusqlite::{Connection, OptionalExtension};
use std::sync::LazyLock;

/// Bump when the list changes, so it is taught again.
pub const STARTER_VERSION: &str = "2";
const SEEDED_KEY: &str = "starter_seeded";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub pattern: &'static str,
    /// Category legacy names or names, most specific first; the first that exists is used.
    pub targets: Vec<&'static str>,
    words: Vec<&'static str>,
}

static ENTRIES: LazyLock<Vec<Entry>> = LazyLock::new(|| {
    include_str!("../../data/merchants.tsv")
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let (pattern, targets) = l.split_once('\t')?;
            Some(Entry {
                pattern,
                targets: targets.split('|').map(str::trim).collect(),
                words: pattern.split_whitespace().collect(),
            })
        })
        .collect()
});

pub fn entries() -> &'static [Entry] {
    &ENTRIES
}

/// The entry whose words appear, in order and whole, in this merchant key or description; the longest wins.
pub fn lookup(text: &str) -> Option<&'static Entry> {
    let normalized = normalize_description(&text.replace(['.', '/', ','], " "));
    let words: Vec<&str> = normalized.split(' ').filter(|w| !w.is_empty()).collect();
    entries()
        .iter()
        .filter(|e| {
            !e.words.is_empty()
                && words
                    .windows(e.words.len())
                    .any(|w| w == e.words.as_slice())
        })
        .max_by_key(|e| e.pattern.len())
}

/// The category this entry points to here: the first target that matches a category's legacy name or name.
pub fn target(conn: &Connection, e: &Entry) -> Result<Option<i64>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id FROM categories WHERE lower(legacy_name) = lower(?1) OR lower(name) = lower(?1)
         ORDER BY (lower(legacy_name) = lower(?1)) DESC, id LIMIT 1",
    )?;
    for t in &e.targets {
        if let Some(id) = stmt.query_row([t], |r| r.get::<_, i64>(0)).optional()? {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// Teach the classifier the list at weight 1, once per `STARTER_VERSION`. Returns how many entries were taught.
pub fn seed(conn: &Connection) -> Result<usize> {
    if settings::get(conn, SEEDED_KEY)?.as_deref() == Some(STARTER_VERSION) {
        return Ok(0);
    }
    crate::db::atomically(conn, |c| {
        let mut taught = 0;
        for e in entries() {
            let Some(category) = target(c, e)? else {
                continue;
            };
            let income: bool = c.query_row(
                "SELECT kind = 'income' FROM categories WHERE id = ?1",
                [category],
                |r| r.get(0),
            )?;
            let f = model::features(e.pattern, e.pattern, if income { 1 } else { -1 }, None);
            model::train(c, &f, category, 1.0)?;
            taught += 1;
        }
        settings::set(c, SEEDED_KEY, STARTER_VERSION)?;
        Ok(taught)
    })
}
