//! Fold one statement source into another: the cleanup for a statement that was
//! imported twice under two source names (for example a bare file filed under
//! "Imported" and the same statement under "Amex").
//!
//! Each row in `from` is paired with an identical row in `into` (same profile,
//! date, amount and description, one to one). The kept row takes over anything
//! the user set on the copy that it lacks (category, notes, review state, tags,
//! refund links), then the copy is deleted. Rows without a twin are moved.
//! Runs in one database transaction; a dry run rolls it back.

use crate::error::Result;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MergeReport {
    /// Copies removed because `into` already had the same transaction.
    pub merged: i64,
    /// Rows that only existed in `from` and were moved to `into`.
    pub moved: i64,
    /// Whether `from` ended up empty and was deleted.
    pub source_deleted: bool,
}

struct Row {
    id: i64,
    profile_id: i64,
    posted_on: String,
    description: String,
    amount_cents: i64,
    category_id: Option<i64>,
    category_locked: bool,
    reviewed: bool,
    notes: Option<String>,
    has_children: bool,
}

fn normalize(description: &str) -> String {
    description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn key(r: &Row) -> (i64, String, i64, String) {
    (
        r.profile_id,
        r.posted_on.clone(),
        r.amount_cents,
        normalize(&r.description),
    )
}

fn rows_of(conn: &Connection, source: i64) -> Result<Vec<Row>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.profile_id, t.posted_on, t.description, t.amount_cents, t.category_id,
                t.category_locked, t.reviewed, t.notes,
                EXISTS (SELECT 1 FROM transactions c WHERE c.parent_id = t.id)
         FROM transactions t WHERE t.source_id = ?1 AND t.parent_id IS NULL ORDER BY t.id",
    )?;
    let rows = stmt.query_map([source], |r| {
        Ok(Row {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            posted_on: r.get(2)?,
            description: r.get(3)?,
            amount_cents: r.get(4)?,
            category_id: r.get(5)?,
            category_locked: r.get::<_, i64>(6)? != 0,
            reviewed: r.get::<_, i64>(7)? != 0,
            notes: r.get(8)?,
            has_children: r.get::<_, i64>(9)? != 0,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Same shape as `transactions::dedupe_hash`, for a row moved to another source.
fn moved_hash(into: i64, r: &Row, occurrence: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{}|{}|{}|{}|{}",
        into,
        r.posted_on,
        r.amount_cents,
        normalize(&r.description),
        occurrence
    ));
    hex::encode(hasher.finalize())
}

pub fn merge_source_into(
    conn: &Connection,
    from: i64,
    into: i64,
    dry_run: bool,
) -> Result<MergeReport> {
    let tx = conn.unchecked_transaction()?;
    let copies = rows_of(&tx, from)?;
    let kept = rows_of(&tx, into)?;

    // Twins available in `into`, oldest first, consumed one to one.
    let mut twins: HashMap<(i64, String, i64, String), Vec<&Row>> = HashMap::new();
    for r in &kept {
        twins.entry(key(r)).or_default().push(r);
    }
    let mut occurrences: HashMap<(i64, String, i64, String), usize> =
        twins.iter().map(|(k, v)| (k.clone(), v.len())).collect();

    let mut report = MergeReport::default();
    for copy in &copies {
        let k = key(copy);
        let twin = if copy.has_children {
            None // keep a split transaction whole: move it rather than merge
        } else {
            twins.get_mut(&k).and_then(|list| {
                if list.is_empty() {
                    None
                } else {
                    Some(list.remove(0))
                }
            })
        };

        match twin {
            Some(twin) => {
                // Category: a locked choice on the copy wins unless the kept row is locked itself.
                if !twin.category_locked
                    && copy.category_id.is_some()
                    && (copy.category_locked || twin.category_id.is_none())
                {
                    tx.execute(
                        &format!(
                            "UPDATE transactions SET category_id = ?1, category_locked = ?2, type = {} WHERE id = ?3",
                            crate::transactions::type_of_category_sql("?1")
                        ),
                        params![copy.category_id, copy.category_locked as i64, twin.id],
                    )?;
                }
                let twin_has_notes = twin
                    .notes
                    .as_deref()
                    .map(|n| !n.trim().is_empty())
                    .unwrap_or(false);
                if !twin_has_notes
                    && copy
                        .notes
                        .as_deref()
                        .map(|n| !n.trim().is_empty())
                        .unwrap_or(false)
                {
                    tx.execute(
                        "UPDATE transactions SET notes = ?1 WHERE id = ?2",
                        params![copy.notes, twin.id],
                    )?;
                }
                if copy.reviewed && !twin.reviewed {
                    tx.execute(
                        "UPDATE transactions SET reviewed = 1 WHERE id = ?1",
                        [twin.id],
                    )?;
                }
                tx.execute(
                    "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
                     SELECT ?1, tag_id FROM transaction_tags WHERE transaction_id = ?2",
                    params![twin.id, copy.id],
                )?;
                tx.execute(
                    "UPDATE transactions SET refund_of = ?1 WHERE refund_of = ?2",
                    params![twin.id, copy.id],
                )?;
                tx.execute("DELETE FROM transactions WHERE id = ?1", [copy.id])?;
                report.merged += 1;
            }
            None => {
                let n = occurrences.entry(k).or_insert(0);
                tx.execute(
                    "UPDATE transactions SET source_id = ?1, dedupe_hash = ?2 WHERE id = ?3",
                    params![into, moved_hash(into, copy, *n), copy.id],
                )?;
                *n += 1;
                report.moved += 1;
            }
        }
    }

    // Keep the record of which files were imported, now under `into`.
    tx.execute(
        "UPDATE OR IGNORE imports SET source_id = ?1 WHERE source_id = ?2",
        params![into, from],
    )?;
    tx.execute("DELETE FROM imports WHERE source_id = ?1", [from])?;
    let deleted = tx.execute(
        "DELETE FROM sources WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM transactions WHERE source_id = ?1)",
        [from],
    )?;
    report.source_deleted = deleted > 0;

    if dry_run {
        tx.rollback()?;
    } else {
        tx.commit()?;
    }
    Ok(report)
}
