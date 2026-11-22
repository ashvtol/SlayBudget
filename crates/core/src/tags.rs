//! Tags (Copilot): free labels on transactions, each with a color. Shared by all profiles.

use crate::error::{CoreError, Result};
use crate::transactions::TransactionId;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub type TagId = i64;

/// Copilot's tag colors, as its color picker lays them out (two rows of seven).
pub const PALETTE: [&str; 14] = [
    "#e5484d", "#e35f2e", "#e8904a", "#b07a3c", "#ddb24a", "#e9d44a", "#a9b94a", "#5cb85c",
    "#6ccdc6", "#4a8ef0", "#7c6cf0", "#9a5cf0", "#d93fb8", "#b54ef0",
];

/// The palette positions new tags take in turn: far-apart hues first, so neighbouring tags differ.
pub const NEW_TAG_ORDER: [usize; 14] = [0, 7, 11, 9, 2, 8, 12, 4, 10, 1, 6, 13, 3, 5];

pub const MAX_NAME: usize = 40;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tag {
    pub id: TagId,
    pub name: String,
    pub color: String,
    /// How many transactions carry it.
    pub count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TagPatch {
    pub name: Option<String>,
    pub color: Option<String>,
}

/// Every tag in creation order, with use counts.
pub fn list(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, (SELECT count(*) FROM transaction_tags x WHERE x.tag_id = t.id)
         FROM tags t ORDER BY t.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// A trimmed, valid name not used by another tag (ignoring case).
fn checked_name(conn: &Connection, name: &str, except: Option<TagId>) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("a tag needs a name".into()));
    }
    if name.chars().count() > MAX_NAME {
        return Err(CoreError::Invalid(format!(
            "a tag name can be at most {MAX_NAME} characters"
        )));
    }
    let taken: Option<i64> = conn
        .query_row(
            "SELECT id FROM tags WHERE lower(name) = lower(?1) AND id IS NOT ?2",
            params![name, except],
            |r| r.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Err(CoreError::Invalid(format!(
            "a tag named “{name}” already exists"
        )));
    }
    Ok(name.to_string())
}

pub fn create(conn: &Connection, name: &str, color: Option<&str>) -> Result<TagId> {
    let name = checked_name(conn, name, None)?;
    let color = match color {
        Some(c) => c.to_string(),
        None => {
            let n: i64 = conn.query_row("SELECT count(*) FROM tags", [], |r| r.get(0))?;
            PALETTE[NEW_TAG_ORDER[n as usize % NEW_TAG_ORDER.len()]].to_string()
        }
    };
    conn.execute(
        "INSERT INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: TagId, patch: &TagPatch) -> Result<()> {
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM tags WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    if exists.is_none() {
        return Err(CoreError::NotFound(format!("tag {id}")));
    }
    if let Some(name) = &patch.name {
        let name = checked_name(conn, name, Some(id))?;
        conn.execute("UPDATE tags SET name = ?1 WHERE id = ?2", params![name, id])?;
    }
    if let Some(color) = &patch.color {
        conn.execute(
            "UPDATE tags SET color = ?1 WHERE id = ?2",
            params![color, id],
        )?;
    }
    Ok(())
}

/// Remove a tag; its transactions keep everything else.
pub fn delete(conn: &Connection, id: TagId) -> Result<()> {
    conn.execute("DELETE FROM transaction_tags WHERE tag_id = ?1", [id])?;
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

/// Every (transaction, tag) pair as SQL args, for the two statements below.
fn pairs(tx_ids: &[TransactionId], tag_ids: &[TagId]) -> (String, Vec<Value>) {
    let rows = vec!["(?, ?)"; tx_ids.len() * tag_ids.len()].join(", ");
    let mut args = Vec::new();
    for &t in tx_ids {
        for &g in tag_ids {
            args.push(Value::from(t));
            args.push(Value::from(g));
        }
    }
    (rows, args)
}

/// Put the tags on the transactions. Returns how many new links were made.
pub fn add(conn: &Connection, tx_ids: &[TransactionId], tag_ids: &[TagId]) -> Result<usize> {
    // One transaction: tagging a whole selection commits once.
    let tx = conn.unchecked_transaction()?;
    let mut made = 0;
    {
        let mut insert = tx.prepare(
            "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?1, ?2)",
        )?;
        for &t in tx_ids {
            for &g in tag_ids {
                made += insert.execute(params![t, g])?;
            }
        }
    }
    tx.commit()?;
    Ok(made)
}

/// Take the tags off the transactions. Returns how many links were removed.
pub fn remove(conn: &Connection, tx_ids: &[TransactionId], tag_ids: &[TagId]) -> Result<usize> {
    if tx_ids.is_empty() || tag_ids.is_empty() {
        return Ok(0);
    }
    let (rows, args) = pairs(tx_ids, tag_ids);
    Ok(conn.execute(
        &format!("DELETE FROM transaction_tags WHERE (transaction_id, tag_id) IN (VALUES {rows})"),
        params_from_iter(args),
    )?)
}
