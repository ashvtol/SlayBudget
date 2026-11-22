use chrono::NaiveDate;
use slaybudget_core::analytics::budgets::month_status;
use slaybudget_core::categories::{self, CategoryPatch};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn add(conn: &rusqlite::Connection, p: i64, s: i64, date: &str, cents: i64, cat: i64) {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: "X".into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: Some(cat),
        import_id: None,
    };
    assert!(matches!(
        transactions::insert(conn, &tx).unwrap(),
        InsertOutcome::Inserted(_)
    ));
}

fn set_budget(conn: &rusqlite::Connection, id: i64, cents: i64) {
    categories::update(
        conn,
        id,
        &CategoryPatch {
            budget_cents: Some(Some(cents)),
            ..Default::default()
        },
    )
    .unwrap();
}

#[test]
fn budget_status_reports_spent_remaining_and_projection() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let groceries = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    set_budget(&conn, groceries, 60000); // $600

    // Halfway through a 30-day month (day 15), $300 spent → projects to $600.
    add(&conn, p, s, "2026-11-05", -10000, groceries);
    add(&conn, p, s, "2026-11-12", -20000, groceries);
    let status = month_status(&conn, Some(p), d("2026-11-15")).unwrap();
    let g = status.iter().find(|b| b.category_id == groceries).unwrap();
    assert_eq!(g.spent_cents, 30000);
    assert_eq!(g.remaining_cents, 30000);
    assert_eq!(g.projected_cents, 60000); // 30000 * 30 / 15
    assert!(!g.over_budget);
}

#[test]
fn over_budget_is_flagged_and_prior_month_is_excluded() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let dining = categories::find_by_legacy_name(&conn, "Restaurants")
        .unwrap()
        .unwrap()
        .id;
    set_budget(&conn, dining, 10000);
    add(&conn, p, s, "2026-10-31", -9000, dining); // prior month, ignored
    add(&conn, p, s, "2026-11-03", -12000, dining);
    let status = month_status(&conn, Some(p), d("2026-11-15")).unwrap();
    let b = status.iter().find(|x| x.category_id == dining).unwrap();
    assert_eq!(b.spent_cents, 12000);
    assert!(b.over_budget);
}

#[test]
fn categories_without_a_budget_are_omitted() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let status = month_status(&conn, Some(p), d("2026-11-15")).unwrap();
    assert!(status.is_empty());
}
