//! Possible duplicates found on import: rows that look like one you already have but don't match exactly
//! (identical rows are skipped by fingerprint before they get here). A flag never deletes anything: it tags the new
//! row "Possible duplicate", marks it to review, and explains why. You resolve it by deleting one of the pair or by
//! saying it's not a duplicate (that pair is then never flagged again).

use crate::categorize::rules::normalize_description;
use crate::error::{CoreError, Result};
use crate::notifications::producers::money;
use crate::transactions::TransactionId;
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const TAG_NAME: &str = "Possible duplicate";
pub const TAG_COLOR: &str = "#ddb24a";
/// Rows up to this many days apart can be the same purchase (a pending charge can take a week to post).
const WINDOW_DAYS: i64 = 7;
/// A charge of at most this much is a card hold (gas pumps, hotels).
const HOLD_CENTS: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Certain,
    Likely,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    /// The flagged (new) row was deleted.
    Deleted,
    /// Not a duplicate: both stay, and the pair is never flagged again.
    Kept,
    /// The existing row was deleted (it was the pending one, say).
    OtherDeleted,
}

impl Resolution {
    fn as_str(self) -> &'static str {
        match self {
            Resolution::Deleted => "deleted",
            Resolution::Kept => "kept",
            Resolution::OtherDeleted => "other_deleted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFlag {
    pub id: i64,
    /// The new row (None once deleted).
    pub tx_id: Option<TransactionId>,
    /// The existing row it looks like (None once deleted).
    pub other_id: Option<TransactionId>,
    pub import_id: Option<i64>,
    pub confidence: Confidence,
    pub reason: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
    pub resolution: Option<Resolution>,
}

const FLAG_COLS: &str =
    "id, tx_id, other_id, import_id, confidence, reason, created_at, resolved_at, resolution";

fn row_to_flag(r: &rusqlite::Row<'_>) -> rusqlite::Result<DuplicateFlag> {
    let confidence: String = r.get(4)?;
    let resolution: Option<String> = r.get(8)?;
    Ok(DuplicateFlag {
        id: r.get(0)?,
        tx_id: r.get(1)?,
        other_id: r.get(2)?,
        import_id: r.get(3)?,
        confidence: if confidence == "certain" {
            Confidence::Certain
        } else {
            Confidence::Likely
        },
        reason: r.get(5)?,
        created_at: r.get(6)?,
        resolved_at: r.get(7)?,
        resolution: resolution.map(|s| match s.as_str() {
            "deleted" => Resolution::Deleted,
            "kept" => Resolution::Kept,
            _ => Resolution::OtherDeleted,
        }),
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<DuplicateFlag> {
    conn.query_row(
        &format!("SELECT {FLAG_COLS} FROM duplicate_flags WHERE id = ?1"),
        [id],
        row_to_flag,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("duplicate flag {id}")))
}

/// The open flag a transaction is part of (as the new row or the existing one), if any.
pub fn for_transaction(conn: &Connection, tx_id: TransactionId) -> Result<Option<DuplicateFlag>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {FLAG_COLS} FROM duplicate_flags
                 WHERE resolution IS NULL AND (tx_id = ?1 OR other_id = ?1) ORDER BY id DESC LIMIT 1"
            ),
            [tx_id],
            row_to_flag,
        )
        .optional()?)
}

/// Every open flag, newest first.
pub fn list_open(conn: &Connection) -> Result<Vec<DuplicateFlag>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FLAG_COLS} FROM duplicate_flags WHERE resolution IS NULL ORDER BY id DESC"
    ))?;
    let rows = stmt.query_map([], row_to_flag)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

struct Row {
    id: TransactionId,
    posted_on: NaiveDate,
    description: String,
    merchant: String,
    amount_cents: i64,
    hash: String,
    source_id: i64,
    source_name: String,
    imported_at: Option<String>,
}

const ROW_SQL: &str = "SELECT t.id, t.posted_on, t.description, t.merchant, t.amount_cents, t.dedupe_hash, t.source_id,
        s.name, i.imported_at
     FROM transactions t JOIN sources s ON s.id = t.source_id LEFT JOIN imports i ON i.id = t.import_id";

fn to_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(0)?,
        posted_on: parse_day(&r.get::<_, String>(1)?),
        description: r.get(2)?,
        merchant: r.get(3)?,
        amount_cents: r.get(4)?,
        hash: r.get(5)?,
        source_id: r.get(6)?,
        source_name: r.get(7)?,
        imported_at: r.get(8)?,
    })
}

/// Rows that can take part in a pair: not a split (parent or part), not a transfer, not linked as a refund.
const ELIGIBLE: &str = "t.parent_id IS NULL AND t.refund_of IS NULL AND t.type != 'transfer'
     AND t.id NOT IN (SELECT parent_id FROM transactions WHERE parent_id IS NOT NULL)";

fn parse_day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap_or_default()
}

fn day(d: NaiveDate) -> String {
    d.format("%b %-d").to_string()
}

fn gap_words(days: i64) -> String {
    match days {
        0 => "the same day".into(),
        1 => "a day apart".into(),
        n => format!("{n} days apart"),
    }
}

/// Share of the shorter description's words found in the other.
fn word_overlap(a: &str, b: &str) -> f64 {
    let a: HashSet<String> = normalize_description(a)
        .split(' ')
        .map(str::to_string)
        .collect();
    let b: HashSet<String> = normalize_description(b)
        .split(' ')
        .map(str::to_string)
        .collect();
    let shorter = a.len().min(b.len());
    if shorter == 0 {
        return 0.0;
    }
    a.intersection(&b).count() as f64 / shorter as f64
}

/// How a new row matches an existing one, best first when sorted.
fn compare(n: &Row, e: &Row) -> Option<(Confidence, i64, i64, String)> {
    let gap = (n.posted_on - e.posted_on).num_days().abs();
    let diff = (n.amount_cents - e.amount_cents).abs();
    let same_place = !n.merchant.is_empty() && n.merchant == e.merchant;
    let was = money(e.amount_cents.abs());
    if gap == 0 && diff == 0 && (same_place || word_overlap(&n.description, &e.description) >= 0.6)
    {
        let origin = match &e.imported_at {
            Some(at) => format!(
                "imported {}",
                at.get(..10)
                    .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                    .map(day)
                    .unwrap_or_default()
            ),
            None => "added by hand".into(),
        };
        let worded =
            if normalize_description(&n.description) == normalize_description(&e.description) {
                ""
            } else {
                ", worded differently"
            };
        let reason = format!(
            "Same day and amount as {} ({was}, {}, {origin}){worded}.",
            e.description, e.source_name
        );
        return Some((Confidence::Certain, gap, diff, reason));
    }
    if !same_place || gap > WINDOW_DAYS {
        return None;
    }
    let reason = if diff == 0 {
        let when = if e.posted_on < n.posted_on {
            "earlier"
        } else {
            "later"
        };
        let days = if gap == 1 {
            "1 day".to_string()
        } else {
            format!("{gap} days")
        };
        format!(
            "Same place and amount ({was}) as {} on {}, {days} {when}; a pending charge that posted later?",
            e.description,
            day(e.posted_on)
        )
    } else if e.amount_cents.abs() <= HOLD_CENTS && n.amount_cents.abs() > e.amount_cents.abs() {
        format!(
            "Same place {} as a {was} card hold at {} on {}; a hold is usually replaced by the final charge.",
            gap_words(gap),
            e.description,
            day(e.posted_on)
        )
    } else {
        let larger = n.amount_cents.abs().max(e.amount_cents.abs());
        if diff > (larger * 30 / 100).max(2500) {
            return None;
        }
        let tip = if n.amount_cents < 0 && n.amount_cents < e.amount_cents {
            " (a tip?)"
        } else {
            ""
        };
        format!(
            "Same place {} as {} on {} ({was}); the amount changed by {}{tip}.",
            gap_words(gap),
            e.description,
            day(e.posted_on),
            money(diff)
        )
    };
    Some((Confidence::Likely, gap, diff, reason))
}

/// The "Possible duplicate" tag, made (amber) on first use.
pub fn tag_id(conn: &Connection) -> Result<i64> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT id FROM tags WHERE lower(name) = lower(?1)",
            [TAG_NAME],
            |r| r.get(0),
        )
        .optional()?;
    match found {
        Some(id) => Ok(id),
        None => crate::tags::create(conn, TAG_NAME, Some(TAG_COLOR)),
    }
}

/// After an import: compare each newly inserted row with existing rows on the same account and flag lookalikes.
/// `accounted_ids` are existing rows this file repeated exactly; they can't be anyone's duplicate. Existing rows are
/// only candidates when they fall within the file's dates (a file can only "not repeat" rows it covers).
pub fn detect(
    conn: &Connection,
    import_id: i64,
    new_ids: &[TransactionId],
    accounted_ids: &[TransactionId],
) -> Result<Vec<DuplicateFlag>> {
    if new_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut new_rows = Vec::new();
    {
        let mut stmt = conn.prepare(&format!("{ROW_SQL} WHERE t.id = ?1 AND {ELIGIBLE}"))?;
        for &id in new_ids {
            if let Some(r) = stmt.query_row([id], to_row).optional()? {
                new_rows.push(r);
            }
        }
    }
    let mut all_dates: Vec<NaiveDate> = new_rows.iter().map(|r| r.posted_on).collect();
    {
        let mut stmt = conn.prepare("SELECT posted_on FROM transactions WHERE id = ?1")?;
        for &id in accounted_ids {
            if let Some(d) = stmt
                .query_row([id], |r| r.get::<_, String>(0).map(|s| parse_day(&s)))
                .optional()?
            {
                all_dates.push(d);
            }
        }
    }
    let (Some(&first), Some(&last)) = (all_dates.iter().min(), all_dates.iter().max()) else {
        return Ok(Vec::new());
    };
    new_rows.sort_by_key(|r| (r.posted_on, r.id));
    let mut excluded: HashSet<TransactionId> =
        new_ids.iter().chain(accounted_ids).copied().collect();

    crate::db::atomically(conn, |c| {
        let mut candidates = c.prepare(&format!(
            "{ROW_SQL} WHERE t.source_id = ?1 AND {ELIGIBLE} AND t.import_id IS NOT ?2
               AND t.posted_on BETWEEN ?3 AND ?4 AND t.amount_cents * ?5 > 0
               AND NOT EXISTS (SELECT 1 FROM duplicate_flags f WHERE f.resolution = 'kept'
                   AND ((f.tx_hash = ?6 AND f.other_hash = t.dedupe_hash) OR (f.other_hash = ?6 AND f.tx_hash = t.dedupe_hash)))"
        ))?;
        let mut flags = Vec::new();
        let mut tag: Option<i64> = None;
        for n in &new_rows {
            let from = (n.posted_on - chrono::Duration::days(WINDOW_DAYS)).max(first);
            let to = (n.posted_on + chrono::Duration::days(WINDOW_DAYS)).min(last);
            let found = candidates
                .query_map(
                    params![
                        n.source_id,
                        import_id,
                        from.to_string(),
                        to.to_string(),
                        n.amount_cents.signum(),
                        n.hash
                    ],
                    to_row,
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let best = found
                .into_iter()
                .filter(|e| !excluded.contains(&e.id))
                .filter_map(|e| compare(n, &e).map(|m| (m, e)))
                .min_by_key(|((conf, gap, diff, _), e)| (*conf as u8, *gap, *diff, e.id));
            let Some(((confidence, _, _, reason), e)) = best else {
                continue;
            };
            excluded.insert(e.id);
            c.execute(
                "INSERT INTO duplicate_flags (tx_id, other_id, tx_hash, other_hash, import_id, confidence, reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    n.id,
                    e.id,
                    n.hash,
                    e.hash,
                    import_id,
                    if confidence == Confidence::Certain { "certain" } else { "likely" },
                    reason
                ],
            )?;
            let flag_id = c.last_insert_rowid();
            let tag_id = match tag {
                Some(t) => t,
                None => *tag.insert(tag_id(c)?),
            };
            c.execute(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?1, ?2)",
                params![n.id, tag_id],
            )?;
            c.execute("UPDATE transactions SET reviewed = 0 WHERE id = ?1", [n.id])?;
            flags.push(get(c, flag_id)?);
        }
        Ok(flags)
    })
}

/// Take the tag off a row once no open flag needs it.
fn untag_if_settled(conn: &Connection, tx_id: TransactionId) -> Result<()> {
    let open: i64 = conn.query_row(
        "SELECT count(*) FROM duplicate_flags WHERE tx_id = ?1 AND resolution IS NULL",
        [tx_id],
        |r| r.get(0),
    )?;
    if open == 0 {
        conn.execute(
            "DELETE FROM transaction_tags WHERE transaction_id = ?1
               AND tag_id = (SELECT id FROM tags WHERE lower(name) = lower(?2))",
            params![tx_id, TAG_NAME],
        )?;
    }
    Ok(())
}

fn mark(conn: &Connection, flag_id: i64, resolution: Resolution) -> Result<()> {
    conn.execute(
        "UPDATE duplicate_flags SET resolution = ?1, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?2 AND resolution IS NULL",
        params![resolution.as_str(), flag_id],
    )?;
    Ok(())
}

/// Before transactions are deleted (from anywhere): resolve the open flags they're part of, and untag survivors.
pub(crate) fn before_delete(conn: &Connection, ids: &[TransactionId]) -> Result<()> {
    let gone: HashSet<TransactionId> = ids.iter().copied().collect();
    for &id in ids {
        conn.execute(
            "UPDATE duplicate_flags SET resolution = 'deleted', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE tx_id = ?1 AND resolution IS NULL",
            [id],
        )?;
        let survivors: Vec<(i64, Option<TransactionId>)> = {
            let mut stmt = conn.prepare(
                "SELECT id, tx_id FROM duplicate_flags WHERE other_id = ?1 AND resolution IS NULL",
            )?;
            let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (flag_id, tx_id) in survivors {
            mark(conn, flag_id, Resolution::OtherDeleted)?;
            if let Some(tx) = tx_id.filter(|t| !gone.contains(t)) {
                untag_if_settled(conn, tx)?;
            }
        }
    }
    Ok(())
}

/// Settle a flag: delete this one, delete the other one, or keep both (never flagged again).
pub fn resolve(conn: &Connection, flag_id: i64, resolution: Resolution) -> Result<()> {
    let flag = get(conn, flag_id)?;
    if flag.resolution.is_some() {
        return Ok(());
    }
    match resolution {
        Resolution::Kept => crate::db::atomically(conn, |c| {
            mark(c, flag_id, Resolution::Kept)?;
            if let Some(tx) = flag.tx_id {
                untag_if_settled(c, tx)?;
            }
            Ok(())
        }),
        Resolution::Deleted | Resolution::OtherDeleted => {
            let target = if resolution == Resolution::Deleted {
                flag.tx_id
            } else {
                flag.other_id
            };
            let target = target
                .ok_or_else(|| CoreError::Invalid("that transaction is already gone".into()))?;
            crate::transactions::delete_many(conn, &[target])?;
            Ok(())
        }
    }
}
