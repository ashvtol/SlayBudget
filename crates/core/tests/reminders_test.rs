use chrono::NaiveDate;
use slaybudget_core::categories::{self, CategoryPatch};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::reminders::{due, ReminderKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

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
    cat: Option<i64>,
) {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: desc.into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: cat,
        import_id: None,
    };
    assert!(matches!(
        transactions::insert(conn, &tx).unwrap(),
        InsertOutcome::Inserted(_)
    ));
}

#[test]
fn surfaces_upcoming_bills_within_the_horizon() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    for date in ["2026-08-20", "2026-09-20", "2026-10-20"] {
        add(&conn, p, s, date, "netflix", -1599, None); // next ~2026-11-20
    }
    // Bill reminders come from saved recurrings: save the detected one (first-run behaviour).
    slaybudget_core::recurrings::seed_if_needed(&conn).unwrap();
    // 3-day horizon from Nov 18 does not include Nov 20...
    assert!(due(&conn, Some(p), d("2026-11-15"), 3)
        .unwrap()
        .iter()
        .all(|r| r.kind != ReminderKind::UpcomingBill));
    // ...but a 10-day horizon from Nov 15 does.
    let bills: Vec<_> = due(&conn, Some(p), d("2026-11-15"), 10).unwrap();
    assert!(bills
        .iter()
        .any(|r| r.kind == ReminderKind::UpcomingBill && r.title.contains("netflix")));
}

#[test]
fn flags_over_and_projected_over_budgets() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let dining = categories::find_by_legacy_name(&conn, "Restaurants")
        .unwrap()
        .unwrap()
        .id;
    categories::update(
        &conn,
        dining,
        &CategoryPatch {
            budget_cents: Some(Some(10000)),
            ..Default::default()
        },
    )
    .unwrap();
    add(&conn, p, s, "2026-11-03", "bar", -12000, Some(dining)); // over

    let groceries = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    categories::update(
        &conn,
        groceries,
        &CategoryPatch {
            budget_cents: Some(Some(60000)),
            ..Default::default()
        },
    )
    .unwrap();
    add(&conn, p, s, "2026-11-05", "store", -40000, Some(groceries)); // day 15 -> projects ~80000 > 60000

    let reminders = due(&conn, Some(p), d("2026-11-15"), 5).unwrap();
    assert!(reminders
        .iter()
        .any(|r| r.kind == ReminderKind::BudgetOver && r.category_id == Some(dining)));
    assert!(reminders
        .iter()
        .any(|r| r.kind == ReminderKind::BudgetProjectedOver && r.category_id == Some(groceries)));
}
