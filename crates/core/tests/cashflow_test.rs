use chrono::NaiveDate;
use slaybudget_core::analytics::aggregate::DateRange;
use slaybudget_core::analytics::cashflow::cash_flow;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}
/// Money in is filed as salary (Income), money out uncategorized (Regular).
fn add(conn: &rusqlite::Connection, p: i64, s: i64, date: &str, cents: i64) {
    let salary = slaybudget_core::categories::find_by_legacy_name(conn, "Income - Salary")
        .unwrap()
        .unwrap()
        .id;
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: "X".into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: (cents > 0).then_some(salary),
        import_id: None,
    };
    assert!(matches!(
        transactions::insert(conn, &tx).unwrap(),
        InsertOutcome::Inserted(_)
    ));
}

#[test]
fn cash_flow_compares_to_the_preceding_window() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    // October (previous): -200 net. November (current): +100 net.
    add(&conn, p, s, "2026-10-10", 100000);
    add(&conn, p, s, "2026-10-20", -120000);
    add(&conn, p, s, "2026-11-10", 150000);
    add(&conn, p, s, "2026-11-20", -140000);

    let range = DateRange {
        from: Some(d("2026-11-01")),
        to: Some(d("2026-11-30")),
    };
    let cf = cash_flow(&conn, Some(p), range).unwrap();
    assert_eq!(cf.current.net_cents, 10000);
    assert_eq!(cf.previous.net_cents, -20000); // Oct 2 .. Oct 31 window of equal length
    assert_eq!(cf.net_delta_cents, 30000);
}

#[test]
fn cash_flow_ignores_excluded_categories() {
    use slaybudget_core::categories::{self, CategoryPatch};
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let fuel = categories::find_by_legacy_name(&conn, "Transportation - Fuel")
        .unwrap()
        .unwrap()
        .id;
    categories::update(
        &conn,
        fuel,
        &CategoryPatch {
            excluded: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    add(&conn, p, s, "2026-11-10", 150000);
    add(&conn, p, s, "2026-11-20", -40000);
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d("2026-11-21"),
        description: "AMEX PAYMENT".into(),
        amount_cents: -185000,
        currency: "USD".into(),
        occurrence: 0,
        category_id: Some(fuel),
        import_id: None,
    };
    transactions::insert(&conn, &tx).unwrap();

    let range = DateRange {
        from: Some(d("2026-11-01")),
        to: Some(d("2026-11-30")),
    };
    let flow = cash_flow(&conn, None, range).unwrap();
    assert_eq!(flow.current.income_cents, 150000);
    assert_eq!(flow.current.expense_cents, 40000);
    assert_eq!(flow.current.net_cents, 110000);
}

#[test]
fn cash_flow_over_all_time_does_not_need_dates() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    add(&conn, p, s, "2025-03-10", 100000);
    add(&conn, p, s, "2026-10-20", -40000);
    let all = DateRange {
        from: None,
        to: None,
    };
    let cf = cash_flow(&conn, Some(p), all).unwrap();
    assert_eq!(cf.current.income_cents, 100000);
    assert_eq!(cf.current.expense_cents, 40000);
    // Nothing comes before all of time.
    assert_eq!(cf.previous.net_cents, 0);

    let empty = open_in_memory().unwrap();
    assert_eq!(cash_flow(&empty, None, all).unwrap().current.net_cents, 0);
}
