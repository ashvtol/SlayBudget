//! Database connection, pragmas and migrations.

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;

/// Numbered migrations, applied in order. Add new entries at the end; never edit a shipped one.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_initial.sql")),
    (2, include_str!("../../migrations/0002_fx_rates.sql")),
    (3, include_str!("../../migrations/0003_fts.sql")),
    (4, include_str!("../../migrations/0004_merchant_rules.sql")),
    (
        5,
        include_str!("../../migrations/0005_transaction_types.sql"),
    ),
    (
        6,
        include_str!("../../migrations/0006_backfill_transaction_types.sql"),
    ),
    (7, include_str!("../../migrations/0007_recurrings.sql")),
    (8, include_str!("../../migrations/0008_tag_colors.sql")),
    (
        9,
        include_str!("../../migrations/0009_statement_details.sql"),
    ),
    (10, include_str!("../../migrations/0010_budget_plan.sql")),
];

/// Open (or create) the database at `path` and bring it up to the latest schema.
pub fn open_db(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| crate::CoreError::Invalid(e.to_string()))?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    crate::profiles::ensure_default(&conn)?;
    crate::categories::seed_defaults(&conn)?;
    crate::profiles::backfill_institutions(&conn)?;
    crate::categories::fill_missing_emojis(&conn)?;
    crate::recurrings::seed_if_needed(&conn)?;
    Ok(conn)
}

/// An in-memory database with the full schema, for tests.
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    crate::profiles::ensure_default(&conn)?;
    crate::categories::seed_defaults(&conn)?;
    Ok(conn)
}

/// Highest applied migration number, or 0 for an empty database.
pub fn schema_version(conn: &Connection) -> Result<i64> {
    let exists: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        [],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(0);
    }
    Ok(conn.query_row(
        "SELECT coalesce(max(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?)
}

fn configure(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )?;
    let current = schema_version(conn)?;
    for (version, sql) in MIGRATIONS {
        if *version > current {
            conn.execute_batch("BEGIN")?;
            if let Err(e) = conn.execute_batch(sql) {
                conn.execute_batch("ROLLBACK")?;
                return Err(e.into());
            }
            conn.execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                [version],
            )?;
            conn.execute_batch("COMMIT")?;
        }
    }
    Ok(())
}

/// Write a consistent copy of the open database to `path` (which must not exist).
pub fn backup_to(conn: &Connection, path: &Path) -> Result<()> {
    let target = path
        .to_str()
        .ok_or_else(|| crate::CoreError::Invalid("backup path is not valid UTF-8".into()))?;
    conn.execute("VACUUM INTO ?1", [target])?;
    Ok(())
}

/// Run `f` so its changes land together or not at all. Uses a savepoint, so it also works
/// inside a transaction the caller already opened (where a plain BEGIN would fail).
pub fn atomically<T>(conn: &Connection, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    conn.execute_batch("SAVEPOINT slaybudget_atomic")?;
    match f(conn) {
        Ok(value) => {
            conn.execute_batch("RELEASE slaybudget_atomic")?;
            Ok(value)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK TO slaybudget_atomic; RELEASE slaybudget_atomic");
            Err(e)
        }
    }
}
