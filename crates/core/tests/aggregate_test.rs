use chrono::NaiveDate;
use slaybudget_core::analytics::aggregate::{
    category_totals, monthly_totals, sub_months, DateRange, TimeRange,
};
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, SplitPart};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn setup() -> (rusqlite::Connection, i64, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    (conn, p, s)
}

fn add(
    conn: &rusqlite::Connection,
    p: i64,
    s: i64,
    date: &str,
    cents: i64,
    cat: Option<i64>,
) -> i64 {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: "X".into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: cat,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!(),
    }
}

fn cat(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::find_by_legacy_name(conn, name)
        .unwrap()
        .unwrap()
        .id
}

#[test]
fn sub_months_clamps_day_and_crosses_years() {
    assert_eq!(sub_months(d("2026-03-31"), 1), d("2026-02-28"));
    assert_eq!(sub_months(d("2026-01-15"), 1), d("2025-12-15"));
    assert_eq!(sub_months(d("2026-05-31"), 3), d("2026-02-28"));
    assert_eq!(sub_months(d("2026-06-10"), 12), d("2025-06-10"));
}

#[test]
fn time_ranges_resolve_against_today() {
    let today = d("2026-11-17");
    assert_eq!(TimeRange::Week.range(today).from, Some(d("2026-11-11")));
    assert_eq!(TimeRange::Ytd.range(today).from, Some(d("2026-01-01")));
    assert_eq!(
        TimeRange::All.range(today),
        DateRange {
            from: None,
            to: None
        }
    );
    assert_eq!(TimeRange::Month.range(today).to, Some(today));
}

#[test]
fn monthly_totals_group_income_and_expense_by_month() {
    let (conn, p, s) = setup();
    add(
        &conn,
        p,
        s,
        "2026-10-05",
        500000,
        Some(cat(&conn, "Income - Salary")),
    ); // income
    add(&conn, p, s, "2026-10-20", -20000, None); // expense
    add(&conn, p, s, "2026-11-02", -15000, None);
    let all = monthly_totals(
        &conn,
        Some(p),
        DateRange {
            from: None,
            to: None,
        },
    )
    .unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].month, "2026-10");
    assert_eq!(all[0].income_cents, 500000);
    assert_eq!(all[0].expense_cents, 20000);
    assert_eq!(all[0].net_cents, 480000);
    assert_eq!(all[1].month, "2026-11");
    assert_eq!(all[1].net_cents, -15000);
}

#[test]
fn the_range_bounds_filter_rows() {
    let (conn, p, s) = setup();
    add(&conn, p, s, "2026-09-01", -1000, None);
    add(&conn, p, s, "2026-11-10", -2000, None);
    let nov = monthly_totals(&conn, Some(p), TimeRange::Month.range(d("2026-11-17"))).unwrap();
    assert_eq!(nov.len(), 1);
    assert_eq!(nov[0].month, "2026-11");
}

#[test]
fn category_totals_are_split_aware_and_expenses_only() {
    let (conn, p, s) = setup();
    let groceries = cat(&conn, "Groceries");
    let shopping = cat(&conn, "Shopping");
    add(&conn, p, s, "2026-11-01", -5000, Some(groceries));
    add(
        &conn,
        p,
        s,
        "2026-11-02",
        9000,
        Some(cat(&conn, "Income - Salary")),
    ); // income ignored for spend
    let split_id = add(&conn, p, s, "2026-11-03", -10000, Some(groceries));
    transactions::split(
        &conn,
        split_id,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: Some(groceries),
                description: None,
            },
            SplitPart {
                amount_cents: -4000,
                category_id: Some(shopping),
                description: None,
            },
        ],
    )
    .unwrap();

    let totals = category_totals(
        &conn,
        Some(p),
        DateRange {
            from: None,
            to: None,
        },
    )
    .unwrap();
    // groceries: 5000 (plain) + 6000 (split child) = 11000; shopping: 4000. Parent excluded.
    let g = totals
        .iter()
        .find(|t| t.category_id == Some(groceries))
        .unwrap();
    assert_eq!(g.total_cents, 11000);
    assert_eq!(g.count, 2);
    let sh = totals
        .iter()
        .find(|t| t.category_id == Some(shopping))
        .unwrap();
    assert_eq!(sh.total_cents, 4000);
    // largest first
    assert_eq!(totals[0].category_id, Some(groceries));
}

#[test]
fn combined_view_spans_profiles() {
    let (conn, p1, s1) = setup();
    let p2 = profiles::create(&conn, "Jamie", None).unwrap();
    let s2 = profiles::find_or_create_source(&conn, p2, "Citi", SourceKind::Csv).unwrap();
    add(&conn, p1, s1, "2026-11-01", -1000, None);
    add(&conn, p2, s2, "2026-11-01", -2000, None);
    let combined = monthly_totals(
        &conn,
        None,
        DateRange {
            from: None,
            to: None,
        },
    )
    .unwrap();
    assert_eq!(combined[0].expense_cents, 3000);
    let just_p1 = monthly_totals(
        &conn,
        Some(p1),
        DateRange {
            from: None,
            to: None,
        },
    )
    .unwrap();
    assert_eq!(just_p1[0].expense_cents, 1000);
}

fn exclude(conn: &rusqlite::Connection, id: i64) {
    categories::update(
        conn,
        id,
        &categories::CategoryPatch {
            excluded: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
}

#[test]
fn excluded_categories_do_not_count_as_income_or_spending() {
    let (conn, p, s) = setup();
    // Any category can be excluded; Fuel stands in for e.g. "Card Payment".
    let fuel = cat(&conn, "Transportation - Fuel");
    exclude(&conn, fuel);
    let groceries = cat(&conn, "Groceries");
    add(&conn, p, s, "2026-11-03", -5000, Some(groceries));
    add(&conn, p, s, "2026-11-04", -185000, Some(fuel)); // e.g. a card payment
    add(&conn, p, s, "2026-11-05", 185000, Some(fuel)); // and its matching credit
    add(&conn, p, s, "2026-11-06", -700, None); // uncategorized still counts

    let range = DateRange {
        from: Some(d("2026-11-01")),
        to: Some(d("2026-11-30")),
    };
    let months = monthly_totals(&conn, None, range).unwrap();
    assert_eq!(months.len(), 1);
    assert_eq!(months[0].expense_cents, 5700);
    assert_eq!(months[0].income_cents, 0);

    let cats = category_totals(&conn, None, range).unwrap();
    assert!(cats.iter().all(|c| c.category_id != Some(fuel)));
    assert_eq!(cats.iter().map(|c| c.total_cents).sum::<i64>(), 5700);
}

#[test]
fn totals_follow_transaction_types() {
    let (conn, p, s) = setup();
    let food = cat(&conn, "Food & Dining");
    add(&conn, p, s, "2026-05-01", -5000, Some(food)); // regular spend
    add(&conn, p, s, "2026-05-02", 1000, Some(food)); // refund: reduces food
    add(&conn, p, s, "2026-05-03", 2000, None); // venmo payback, regular: not income
    add(
        &conn,
        p,
        s,
        "2026-05-04",
        300000,
        Some(cat(&conn, "Income - Salary")),
    ); // income
    add(
        &conn,
        p,
        s,
        "2026-05-05",
        -40000,
        Some(cat(&conn, "Payment")),
    ); // transfer
    let t = add(&conn, p, s, "2026-05-06", -7000, None);
    transactions::set_type(&conn, &[t], transactions::TxType::Transfer).unwrap();

    let range = DateRange {
        from: Some(d("2026-05-01")),
        to: Some(d("2026-05-31")),
    };
    let m = monthly_totals(&conn, None, range).unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].income_cents, 300000);
    // 5000 spent, 1000 refunded, 2000 paid back.
    assert_eq!(m[0].expense_cents, 2000);

    let cats = category_totals(&conn, None, range).unwrap();
    let food_total = cats.iter().find(|c| c.category_id == Some(food)).unwrap();
    assert_eq!(food_total.total_cents, 4000);
    assert!(cats
        .iter()
        .all(|c| c.category_id != Some(cat(&conn, "Income - Salary"))));
}
