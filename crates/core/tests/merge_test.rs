use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::sources_merge::{merge_source_into, MergeReport};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, TransactionPatch};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn add(
    conn: &rusqlite::Connection,
    p: i64,
    s: i64,
    date: &str,
    desc: &str,
    cents: i64,
    occ: u32,
) -> i64 {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: desc.into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: occ,
        category_id: None,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!("duplicate"),
    }
}

struct Setup {
    conn: rusqlite::Connection,
    p: i64,
    imported: i64,
    amex: i64,
}

fn setup() -> Setup {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let imported = profiles::find_or_create_source(&conn, p, "Imported", SourceKind::Csv).unwrap();
    let amex = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    Setup {
        conn,
        p,
        imported,
        amex,
    }
}

fn count_in(conn: &rusqlite::Connection, source: i64) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE source_id = ?1",
        [source],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn removes_copies_that_have_a_twin_and_reports_them() {
    let s = setup();
    add(&s.conn, s.p, s.imported, "2026-06-27", "UBER", -331, 0);
    add(&s.conn, s.p, s.amex, "2026-06-27", "UBER", -331, 0);
    add(
        &s.conn,
        s.p,
        s.imported,
        "2026-06-26",
        "PLAYSTATION NETWORK",
        -550,
        0,
    );
    add(
        &s.conn,
        s.p,
        s.amex,
        "2026-06-26",
        "PLAYSTATION NETWORK",
        -550,
        0,
    );

    let report = merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    assert_eq!(
        report,
        MergeReport {
            merged: 2,
            moved: 0,
            source_deleted: true
        }
    );
    assert_eq!(count_in(&s.conn, s.amex), 2);
    assert_eq!(count_in(&s.conn, s.imported), 0);
    let sources: Vec<String> = profiles::list_sources(&s.conn, s.p)
        .unwrap()
        .into_iter()
        .map(|x| x.name)
        .collect();
    assert_eq!(sources, vec!["Amex".to_string()]);
}

#[test]
fn dry_run_reports_without_changing_anything() {
    let s = setup();
    add(&s.conn, s.p, s.imported, "2026-06-27", "UBER", -331, 0);
    add(&s.conn, s.p, s.amex, "2026-06-27", "UBER", -331, 0);
    let report = merge_source_into(&s.conn, s.imported, s.amex, true).unwrap();
    assert_eq!(report.merged, 1);
    assert_eq!(count_in(&s.conn, s.imported), 1);
}

#[test]
fn pairs_identical_same_day_charges_one_to_one() {
    let s = setup();
    // Two identical rides on one day in each source: both pairs merge, nothing is lost.
    add(&s.conn, s.p, s.imported, "2026-05-17", "UBER", -500, 0);
    add(&s.conn, s.p, s.imported, "2026-05-17", "UBER", -500, 1);
    add(&s.conn, s.p, s.amex, "2026-05-17", "UBER", -500, 0);
    add(&s.conn, s.p, s.amex, "2026-05-17", "UBER", -500, 1);
    let report = merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    assert_eq!(report.merged, 2);
    assert_eq!(count_in(&s.conn, s.amex), 2);
}

#[test]
fn moves_rows_without_a_twin_into_the_target() {
    let s = setup();
    add(
        &s.conn,
        s.p,
        s.imported,
        "2026-06-01",
        "ONLY IN IMPORTED",
        -100,
        0,
    );
    let report = merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    assert_eq!(
        report,
        MergeReport {
            merged: 0,
            moved: 1,
            source_deleted: true
        }
    );
    assert_eq!(count_in(&s.conn, s.amex), 1);
}

#[test]
fn carries_over_category_notes_review_and_refund_links() {
    let s = setup();
    let groceries = categories::find_by_legacy_name(&s.conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    let dup = add(
        &s.conn,
        s.p,
        s.imported,
        "2026-06-27",
        "WHOLE FOODS",
        -5000,
        0,
    );
    let twin = add(&s.conn, s.p, s.amex, "2026-06-27", "WHOLE FOODS", -5000, 0);
    let refund = add(
        &s.conn,
        s.p,
        s.amex,
        "2026-06-28",
        "WHOLE FOODS REFUND",
        5000,
        0,
    );
    transactions::update(
        &s.conn,
        dup,
        &TransactionPatch {
            category_id: Some(Some(groceries)),
            category_locked: Some(true),
            reviewed: Some(true),
            notes: Some(Some("weekly shop".into())),
            ..Default::default()
        },
    )
    .unwrap();
    s.conn
        .execute(
            "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
            [dup, refund],
        )
        .unwrap();

    merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    let kept = transactions::get(&s.conn, twin).unwrap();
    assert_eq!(kept.category_id, Some(groceries));
    assert!(kept.category_locked);
    assert!(kept.reviewed);
    assert_eq!(kept.notes.as_deref(), Some("weekly shop"));
    assert_eq!(
        transactions::get(&s.conn, refund).unwrap().refund_of,
        Some(twin)
    );
}

#[test]
fn keeps_the_twins_own_edits_over_the_copy() {
    let s = setup();
    let rent = categories::find_by_legacy_name(&s.conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    let dup = add(&s.conn, s.p, s.imported, "2026-06-27", "X", -100, 0);
    let twin = add(&s.conn, s.p, s.amex, "2026-06-27", "X", -100, 0);
    transactions::update(
        &s.conn,
        dup,
        &TransactionPatch {
            notes: Some(Some("old".into())),
            ..Default::default()
        },
    )
    .unwrap();
    transactions::update(
        &s.conn,
        twin,
        &TransactionPatch {
            notes: Some(Some("mine".into())),
            category_id: Some(Some(rent)),
            category_locked: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    let kept = transactions::get(&s.conn, twin).unwrap();
    assert_eq!(kept.notes.as_deref(), Some("mine"));
    assert_eq!(kept.category_id, Some(rent));
}

#[test]
fn carries_over_tags() {
    let s = setup();
    let dup = add(&s.conn, s.p, s.imported, "2026-06-27", "X", -100, 0);
    let twin = add(&s.conn, s.p, s.amex, "2026-06-27", "X", -100, 0);
    s.conn
        .execute("INSERT INTO tags (id, name) VALUES (1, 'trip')", [])
        .unwrap();
    s.conn
        .execute(
            "INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?1, 1)",
            [dup],
        )
        .unwrap();
    merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    let n: i64 = s
        .conn
        .query_row(
            "SELECT COUNT(*) FROM transaction_tags WHERE transaction_id = ?1 AND tag_id = 1",
            [twin],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn never_overrides_a_category_locked_on_the_kept_row() {
    let s = setup();
    let groceries = categories::find_by_legacy_name(&s.conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    let fuel = categories::find_by_legacy_name(&s.conn, "Transportation - Fuel")
        .unwrap()
        .unwrap()
        .id;
    let dup = add(&s.conn, s.p, s.imported, "2026-06-27", "COSTCO", -100, 0);
    let twin = add(&s.conn, s.p, s.amex, "2026-06-27", "COSTCO", -100, 0);
    let lock = |id: i64, cat: i64| {
        transactions::update(
            &s.conn,
            id,
            &TransactionPatch {
                category_id: Some(Some(cat)),
                category_locked: Some(true),
                ..Default::default()
            },
        )
        .unwrap()
    };
    lock(dup, fuel);
    lock(twin, groceries);
    merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    assert_eq!(
        transactions::get(&s.conn, twin).unwrap().category_id,
        Some(groceries)
    );
}

#[test]
fn an_extra_identical_copy_without_its_own_twin_is_moved_not_lost() {
    let s = setup();
    // Two identical rides in the copy source, only one in the kept source.
    add(&s.conn, s.p, s.imported, "2026-05-17", "UBER", -500, 0);
    add(&s.conn, s.p, s.imported, "2026-05-17", "UBER", -500, 1);
    add(&s.conn, s.p, s.amex, "2026-05-17", "UBER", -500, 0);
    let report = merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    assert_eq!(
        report,
        MergeReport {
            merged: 1,
            moved: 1,
            source_deleted: true
        }
    );
    assert_eq!(count_in(&s.conn, s.amex), 2);
}

#[test]
fn merged_category_brings_its_type() {
    let s = setup();
    let payment = categories::find_by_legacy_name(&s.conn, "Payment")
        .unwrap()
        .unwrap()
        .id;
    let copy = add(
        &s.conn,
        s.p,
        s.imported,
        "2026-05-01",
        "AUTOPAY PAYMENT THANK YOU",
        50000,
        0,
    );
    transactions::update(
        &s.conn,
        copy,
        &TransactionPatch {
            category_id: Some(Some(payment)),
            category_locked: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let kept = add(
        &s.conn,
        s.p,
        s.amex,
        "2026-05-01",
        "AUTOPAY PAYMENT THANK YOU",
        50000,
        0,
    );
    merge_source_into(&s.conn, s.imported, s.amex, false).unwrap();
    let t = transactions::get(&s.conn, kept).unwrap();
    assert_eq!(t.category_id, Some(payment));
    assert_eq!(t.tx_type, transactions::TxType::Transfer);
}
