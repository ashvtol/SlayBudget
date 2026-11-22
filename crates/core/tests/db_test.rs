use slaybudget_core::db::{open_db, schema_version};

#[test]
fn open_creates_file_and_applies_migrations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let conn = open_db(&path).unwrap();
    assert!(path.exists());
    assert!(schema_version(&conn).unwrap() >= 1);
}

#[test]
fn open_twice_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let v1 = schema_version(&open_db(&path).unwrap()).unwrap();
    let v2 = schema_version(&open_db(&path).unwrap()).unwrap();
    assert_eq!(v1, v2);
}

#[test]
fn foreign_keys_and_wal_are_enabled() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_db(&dir.path().join("test.db")).unwrap();
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1);
    assert_eq!(mode.to_lowercase(), "wal");
}

#[test]
fn in_memory_db_works_for_tests() {
    let conn = slaybudget_core::db::open_in_memory().unwrap();
    assert!(schema_version(&conn).unwrap() >= 1);
}
