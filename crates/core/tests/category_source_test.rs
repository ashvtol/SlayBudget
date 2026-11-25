use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::db::{open_at_version, open_db, open_in_memory};
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, CategorySource, InsertOutcome, NewTransaction, TransactionFilter, TransactionPatch,
};

fn add(conn: &rusqlite::Connection, p: i64, s: i64, day: u32, desc: &str) -> i64 {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: NaiveDate::from_ymd_opt(2026, 5, day).unwrap(),
        description: desc.into(),
        amount_cents: -500,
        currency: "USD".into(),
        occurrence: 0,
        category_id: None,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!("duplicate"),
    }
}

#[test]
fn migrating_from_15_marks_reviewed_rows_as_yours_and_backs_up_first() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("slaybudget.db");
    {
        let conn = open_at_version(&path, 15).unwrap();
        conn.execute_batch(
            "INSERT INTO profiles (id, name) VALUES (1, 'Alex');
             INSERT INTO sources (id, profile_id, name, kind) VALUES (1, 1, 'Amex', 'csv');
             INSERT INTO transactions (profile_id, source_id, posted_on, description, merchant, amount_cents, currency, dedupe_hash, reviewed)
               VALUES (1, 1, '2026-05-01', 'STARBUCKS', 'starbucks', -500, 'USD', 'a', 1),
                      (1, 1, '2026-05-02', 'SAFEWAY', 'safeway', -900, 'USD', 'b', 0);",
        )
        .unwrap();
    }
    let conn = open_db(&path).unwrap();
    let sources: Vec<String> = conn
        .prepare("SELECT category_source FROM transactions ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(sources, vec!["user", "keyword"]);
    let backups: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with("slaybudget.before-smart-categorization-"))
        .collect();
    assert_eq!(backups.len(), 1, "one backup before migration 16");
}

#[test]
fn a_new_database_is_not_backed_up() {
    let dir = tempfile::tempdir().unwrap();
    let _ = open_db(&dir.path().join("slaybudget.db")).unwrap();
    let n = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.contains(".before-"))
        .count();
    assert_eq!(n, 0);
}

#[test]
fn new_rows_start_as_keyword_and_a_category_you_pick_becomes_yours() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let id = add(&conn, p, s, 1, "STARBUCKS");
    let coffee = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    let t = transactions::get(&conn, id).unwrap();
    assert_eq!(t.category_source, CategorySource::Keyword);

    conn.execute(
        "UPDATE transactions SET suggested_category_id = ?1, suggested_reason = 'x', category_reason = 'y' WHERE id = ?2",
        [coffee, id],
    )
    .unwrap();
    transactions::update(
        &conn,
        id,
        &TransactionPatch {
            category_id: Some(Some(coffee)),
            ..Default::default()
        },
    )
    .unwrap();
    let t = transactions::get(&conn, id).unwrap();
    assert_eq!(t.category_source, CategorySource::User);
    assert_eq!(t.suggested_category_id, None);
    assert_eq!(t.suggested_reason, None);
    assert_eq!(t.category_reason, None);
}

#[test]
fn the_suggested_filter_lists_only_rows_with_a_suggestion() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let a = add(&conn, p, s, 1, "STARBUCKS");
    let _b = add(&conn, p, s, 2, "SAFEWAY");
    let coffee = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    conn.execute(
        "UPDATE transactions SET suggested_category_id = ?1 WHERE id = ?2",
        [coffee, a],
    )
    .unwrap();
    let rows = transactions::list(
        &conn,
        &TransactionFilter {
            suggested: Some(true),
            ..TransactionFilter::for_profile(p)
        },
    )
    .unwrap();
    assert_eq!(rows.iter().map(|t| t.id).collect::<Vec<_>>(), vec![a]);
    assert_eq!(rows[0].suggested_category_id, Some(coffee));
}

#[test]
fn source_names_round_trip() {
    for s in [
        CategorySource::User,
        CategorySource::Rule,
        CategorySource::Learned,
        CategorySource::Model,
        CategorySource::Transfer,
        CategorySource::Bank,
        CategorySource::Keyword,
    ] {
        assert_eq!(CategorySource::parse(s.as_str()), s);
    }
}

#[test]
fn moving_rows_you_ticked_makes_them_yours() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let a = add(&conn, p, s, 1, "SAFEWAY 1");
    let groceries = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    slaybudget_core::categorize::recategorize::apply(&conn, &[a], groceries).unwrap();
    assert_eq!(
        transactions::get(&conn, a).unwrap().category_source,
        CategorySource::User
    );
}
