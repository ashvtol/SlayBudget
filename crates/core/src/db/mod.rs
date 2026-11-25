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
    (11, include_str!("../../migrations/0011_notifications.sql")),
    (
        12,
        include_str!("../../migrations/0012_duplicate_flags.sql"),
    ),
    (13, include_str!("../../migrations/0013_account_clues.sql")),
    (14, include_str!("../../migrations/0014_price_changes.sql")),
    (
        15,
        include_str!("../../migrations/0015_essential_categories.sql"),
    ),
    (
        16,
        include_str!("../../migrations/0016_smart_categorization.sql"),
    ),
    (
        17,
        include_str!("../../migrations/0017_every_few_years.sql"),
    ),
];

/// Migration 16 rewrites how every category is tracked, and 17 changes the recurrings table:
/// the database is copied beside itself first.
const BACKUP_BEFORE: i64 = 17;

/// Open (or create) the database at `path` and bring it up to the latest schema.
pub fn open_db(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| crate::CoreError::Invalid(e.to_string()))?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    let current = schema_version(&conn)?;
    if current > 0 && current < BACKUP_BEFORE {
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
        let label = if current < 16 {
            "smart-categorization"
        } else {
            "every-few-years"
        };
        backup_before(&conn, label, &stamp)?;
    }
    migrate(&conn, i64::MAX)?;
    crate::fx::refresh_display(&conn)?;
    crate::profiles::ensure_default(&conn)?;
    crate::categories::seed_defaults(&conn)?;
    crate::categories::apply_default_essentials(&conn)?;
    crate::profiles::backfill_institutions(&conn)?;
    crate::categories::fill_missing_emojis(&conn)?;
    crate::recurrings::seed_if_needed(&conn)?;
    Ok(conn)
}

/// An in-memory database with the full schema, for tests.
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn, i64::MAX)?;
    crate::fx::refresh_display(&conn)?;
    crate::profiles::ensure_default(&conn)?;
    crate::categories::seed_defaults(&conn)?;
    crate::categories::apply_default_essentials(&conn)?;
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
    crate::fx::register(conn)?;
    Ok(())
}

/// A database file with migrations applied only up to `version` and nothing seeded, for migration tests.
#[doc(hidden)]
pub fn open_at_version(path: &Path, version: i64) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn, version)?;
    Ok(conn)
}

fn migrate(conn: &Connection, up_to: i64) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )?;
    let current = schema_version(conn)?;
    for (version, sql) in MIGRATIONS {
        if *version > current && *version <= up_to {
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

/// Before a destructive change: copy the database beside itself as `<name>.before-<kind>-<stamp>.db`, keeping only
/// the newest 3 backups of that kind. Returns the path, or None for a database with no file (in memory).
pub fn backup_before(
    conn: &Connection,
    kind: &str,
    stamp: &str,
) -> Result<Option<std::path::PathBuf>> {
    let Some(db) = conn
        .path()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
    else {
        return Ok(None);
    };
    let dir = db.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = db
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("slaybudget")
        .to_string();
    let prefix = format!("{stem}.before-{kind}-");
    let target = dir.join(format!("{prefix}{stamp}.db"));
    if !target.exists() {
        backup_to(conn, &target)?;
    }
    let mut existing: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| crate::CoreError::Invalid(e.to_string()))?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with(&prefix) && n.ends_with(".db"))
        .collect();
    existing.sort();
    let excess = existing.len().saturating_sub(3);
    for old in &existing[..excess] {
        let _ = std::fs::remove_file(dir.join(old));
    }
    Ok(Some(target))
}
