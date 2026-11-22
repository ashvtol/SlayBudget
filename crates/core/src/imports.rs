//! Past imports: the Import page's "Recent imports" list, and undoing one.

use crate::error::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    pub id: i64,
    pub source_id: i64,
    pub source_name: String,
    pub file_name: String,
    pub imported_at: String,
    /// Rows this file added, and rows it skipped as already imported (at the time).
    pub imported_rows: i64,
    pub skipped_rows: i64,
    /// Rows from this file still present (some may have been deleted since).
    pub remaining: i64,
}

/// Every import, newest first.
pub fn list(conn: &Connection) -> Result<Vec<ImportRecord>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.source_id, s.name, i.file_name, i.imported_at, i.imported_rows, i.skipped_rows,
                (SELECT count(*) FROM transactions t WHERE t.import_id = i.id AND t.parent_id IS NULL)
         FROM imports i JOIN sources s ON s.id = i.source_id
         ORDER BY i.imported_at DESC, i.id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ImportRecord {
            id: r.get(0)?,
            source_id: r.get(1)?,
            source_name: r.get(2)?,
            file_name: r.get(3)?,
            imported_at: r.get(4)?,
            imported_rows: r.get(5)?,
            skipped_rows: r.get(6)?,
            remaining: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Remove the transactions an import added (never rows it skipped, which belong to earlier imports) and its record,
/// so the same file can be imported again. Returns how many transactions were removed.
pub fn undo(conn: &Connection, import_id: i64) -> Result<usize> {
    crate::db::atomically(conn, |c| {
        let ids: Vec<i64> = {
            let mut stmt = c.prepare(
                "SELECT id FROM transactions WHERE import_id = ?1 AND parent_id IS NULL",
            )?;
            let rows = stmt.query_map([import_id], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        crate::duplicates::before_delete(c, &ids)?;
        let removed = c.execute(
            "DELETE FROM transactions WHERE import_id = ?1 AND parent_id IS NULL",
            [import_id],
        )?;
        c.execute("DELETE FROM imports WHERE id = ?1", [import_id])?;
        Ok(removed)
    })
}
