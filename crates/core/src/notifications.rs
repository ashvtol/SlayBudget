//! Notification center: the inbox behind the bell and macOS banners. Each event has a stable key, so it is stored
//! (and bannered) once, even after it is read or dismissed. Producers that detect events live in `producers`.

pub mod config;
pub mod producers;

use crate::error::Result;
use crate::profiles::ProfileId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How long items are kept, and how many at most.
const KEEP_DAYS: i64 = 90;
const KEEP_MAX: i64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Update,
    BillUpcoming,
    BillMissed,
    PriceUp,
    DoubleCharge,
    LargeTransaction,
    OverBudget,
    MonthlyRecap,
    ReviewDigest,
    MoneyIn,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Update => "update",
            Kind::BillUpcoming => "billUpcoming",
            Kind::BillMissed => "billMissed",
            Kind::PriceUp => "priceUp",
            Kind::DoubleCharge => "doubleCharge",
            Kind::LargeTransaction => "largeTransaction",
            Kind::OverBudget => "overBudget",
            Kind::MonthlyRecap => "monthlyRecap",
            Kind::ReviewDigest => "reviewDigest",
            Kind::MoneyIn => "moneyIn",
        }
    }
    fn parse(s: &str) -> Kind {
        serde_json::from_value(Value::String(s.into())).unwrap_or(Kind::Update)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNotification {
    pub key: String,
    pub kind: Kind,
    pub title: String,
    pub body: String,
    /// Where clicking it goes, e.g. `{"kind":"recurring","id":4}`.
    pub target: Value,
    /// The profile whose data it is about; None for all profiles or the app itself.
    pub profile_id: Option<ProfileId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub key: String,
    pub kind: Kind,
    pub title: String,
    pub body: String,
    pub target: Value,
    pub profile_id: Option<ProfileId>,
    pub created_at: String,
    pub read: bool,
    pub delivered: bool,
}

const COLUMNS: &str =
    "id, key, kind, title, body, target, profile_id, created_at, read_at IS NOT NULL, delivered_at IS NOT NULL";

fn from_row(r: &Row) -> rusqlite::Result<Notification> {
    let kind: String = r.get(2)?;
    let target: String = r.get(5)?;
    Ok(Notification {
        id: r.get(0)?,
        key: r.get(1)?,
        kind: Kind::parse(&kind),
        title: r.get(3)?,
        body: r.get(4)?,
        target: serde_json::from_str(&target).unwrap_or(Value::Null),
        profile_id: r.get(6)?,
        created_at: r.get(7)?,
        read: r.get(8)?,
        delivered: r.get(9)?,
    })
}

/// A profile sees its own items plus household-wide ones (profile_id NULL: recaps, budgets, updates); "All" sees all.
const SCOPE: &str = "(?1 IS NULL OR profile_id IS NULL OR profile_id = ?1)";

/// Store an event unless its key was seen before. `read` marks baseline items (already true at first run) so they
/// go to the bell quietly and never get a banner.
pub fn add_if_new(
    conn: &Connection,
    n: &NewNotification,
    now: &str,
    read: bool,
) -> Result<Option<Notification>> {
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO notifications (key, kind, title, body, target, profile_id, created_at, read_at, delivered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            n.key,
            n.kind.as_str(),
            n.title,
            n.body,
            n.target.to_string(),
            n.profile_id,
            now,
            if read { Some(now) } else { None },
        ],
    )?;
    if inserted == 0 {
        return Ok(None);
    }
    let id = conn.last_insert_rowid();
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM notifications WHERE id = ?1"),
            [id],
            from_row,
        )
        .optional()?)
}

/// Items not dismissed, newest first.
pub fn list(conn: &Connection, profile: Option<ProfileId>) -> Result<Vec<Notification>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM notifications WHERE dismissed_at IS NULL AND {SCOPE}
         ORDER BY created_at DESC, id DESC LIMIT {KEEP_MAX}"
    ))?;
    let rows = stmt.query_map(params![profile], from_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn mark_read(conn: &Connection, id: i64, now: &str) -> Result<()> {
    conn.execute(
        "UPDATE notifications SET read_at = coalesce(read_at, ?2) WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn mark_all_read(conn: &Connection, profile: Option<ProfileId>, now: &str) -> Result<()> {
    conn.execute(
        &format!("UPDATE notifications SET read_at = ?2 WHERE read_at IS NULL AND {SCOPE}"),
        params![profile, now],
    )?;
    Ok(())
}

/// Hide from the bell. The row stays (until pruned) so the event can't come back.
pub fn dismiss(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE notifications SET dismissed_at = coalesce(dismissed_at, read_at, created_at), read_at = coalesce(read_at, created_at) WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Unread items whose banner hasn't been shown yet (held by quiet hours, or new).
pub fn pending_banners(conn: &Connection, profile: Option<ProfileId>) -> Result<Vec<Notification>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM notifications
         WHERE delivered_at IS NULL AND read_at IS NULL AND dismissed_at IS NULL AND {SCOPE}
         ORDER BY created_at, id"
    ))?;
    let rows = stmt.query_map(params![profile], from_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn mark_delivered(conn: &Connection, ids: &[i64], now: &str) -> Result<()> {
    let mut stmt = conn.prepare(
        "UPDATE notifications SET delivered_at = coalesce(delivered_at, ?2) WHERE id = ?1",
    )?;
    for id in ids {
        stmt.execute(params![id, now])?;
    }
    Ok(())
}

/// Drop items older than 90 days, then all but the newest 200.
pub fn prune(conn: &Connection, now: &str) -> Result<()> {
    conn.execute(
        &format!("DELETE FROM notifications WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', ?1, '-{KEEP_DAYS} days')"),
        [now],
    )?;
    conn.execute(
        &format!(
            "DELETE FROM notifications WHERE id NOT IN
             (SELECT id FROM notifications ORDER BY created_at DESC, id DESC LIMIT {KEEP_MAX})"
        ),
        [],
    )?;
    Ok(())
}
