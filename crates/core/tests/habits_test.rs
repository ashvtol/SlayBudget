use chrono::NaiveDate;
use rusqlite::{params, Connection};
use slaybudget_core::categories::{self, CategoryKind, NewCategory};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::habits::money_habits;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

struct Fx {
    conn: Connection,
    p: i64,
    card: i64,
    savings: i64,
    rent: i64,
    food: i64,
    salary: i64,
    hidden: i64,
}

fn new_cat(conn: &Connection, name: &str, kind: CategoryKind, excluded: bool) -> i64 {
    categories::create(
        conn,
        &NewCategory {
            group: format!("G {name}"),
            name: name.into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded,
            kind,
        },
    )
    .unwrap()
}

fn setup() -> Fx {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let card = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let savings =
        profiles::find_or_create_source(&conn, p, "Ally Savings", SourceKind::Csv).unwrap();
    conn.execute(
        "UPDATE sources SET account_type = 'savings' WHERE id = ?1",
        [savings],
    )
    .unwrap();
    let rent = new_cat(&conn, "Flat Rent", CategoryKind::Expense, false);
    conn.execute("UPDATE categories SET essential = 1 WHERE id = ?1", [rent])
        .unwrap();
    let food = new_cat(&conn, "Dining Out", CategoryKind::Expense, false);
    let salary = new_cat(&conn, "Paycheck", CategoryKind::Income, false);
    let hidden = new_cat(&conn, "Card Payoff", CategoryKind::Expense, true);
    Fx {
        conn,
        p,
        card,
        savings,
        rent,
        food,
        salary,
        hidden,
    }
}

fn add(
    fx: &Fx,
    source: i64,
    date: &str,
    cents: i64,
    cat: Option<i64>,
    kind: &str,
    merchant: &str,
) -> i64 {
    let tx = NewTransaction {
        profile_id: fx.p,
        source_id: source,
        posted_on: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
        description: merchant.to_uppercase(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: cat,
        import_id: None,
    };
    let id = match transactions::insert(&fx.conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!("not inserted"),
    };
    fx.conn
        .execute(
            "UPDATE transactions SET type = ?1, merchant = ?2 WHERE id = ?3",
            params![kind, merchant, id],
        )
        .unwrap();
    id
}

fn bill(fx: &Fx, cat: i64, status: &str) -> i64 {
    fx.conn
        .execute(
            "INSERT INTO recurrings (name, category_id, match_kind, pattern, min_cents, max_cents, frequency, status)
             VALUES ('Netflix', ?1, 'merchant', 'netflix', 1000, 2000, 'monthly', ?2)",
            params![cat, status],
        )
        .unwrap();
    fx.conn.last_insert_rowid()
}

#[test]
fn every_month_from_the_first_with_income_spending_needs_and_savings() {
    let fx = setup();
    add(
        &fx,
        fx.card,
        "2026-08-03",
        500000,
        Some(fx.salary),
        "income",
        "payroll",
    );
    add(
        &fx,
        fx.card,
        "2026-08-01",
        -200000,
        Some(fx.rent),
        "regular",
        "landlord",
    );
    add(
        &fx,
        fx.card,
        "2026-08-05",
        -6000,
        Some(fx.food),
        "regular",
        "din tai",
    );
    add(
        &fx,
        fx.card,
        "2026-08-06",
        1000,
        Some(fx.food),
        "regular",
        "din tai",
    ); // refund
    add(
        &fx,
        fx.card,
        "2026-08-07",
        -40000,
        Some(fx.hidden),
        "regular",
        "amex",
    ); // excluded
    add(
        &fx,
        fx.card,
        "2026-08-08",
        -50000,
        None,
        "transfer",
        "to savings",
    );
    add(
        &fx,
        fx.savings,
        "2026-08-08",
        50000,
        None,
        "transfer",
        "from checking",
    );
    add(
        &fx,
        fx.card,
        "2026-10-02",
        -3000,
        Some(fx.food),
        "regular",
        "din tai",
    );

    let h = money_habits(&fx.conn, None, "2026-11-23").unwrap();
    assert_eq!(h.first_month.as_deref(), Some("2026-08"));
    assert_eq!(h.current_month, "2026-11");
    let months: Vec<&str> = h.months.iter().map(|m| m.month.as_str()).collect();
    assert_eq!(months, ["2026-08", "2026-09", "2026-10", "2026-11"]);
    let aug = &h.months[0];
    assert_eq!(aug.income_cents, 500000);
    assert_eq!(aug.spend_cents, 205000);
    assert_eq!(aug.essential_cents, 200000);
    assert_eq!(aug.to_savings_cents, 50000);
    assert_eq!(h.months[1].spend_cents, 0);
}

#[test]
fn flexible_spending_per_category_and_month_leaves_out_needs_and_bills() {
    let fx = setup();
    let netflix = bill(&fx, fx.food, "active");
    add(
        &fx,
        fx.card,
        "2026-10-05",
        -6000,
        Some(fx.food),
        "regular",
        "din tai",
    );
    let n = add(
        &fx,
        fx.card,
        "2026-10-09",
        -1500,
        Some(fx.food),
        "regular",
        "netflix",
    );
    fx.conn
        .execute(
            "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
            params![netflix, n],
        )
        .unwrap();
    add(
        &fx,
        fx.card,
        "2026-10-01",
        -200000,
        Some(fx.rent),
        "regular",
        "landlord",
    );

    let h = money_habits(&fx.conn, None, "2026-11-23").unwrap();
    assert_eq!(h.flexible.len(), 1);
    assert_eq!(
        (
            h.flexible[0].category_id,
            h.flexible[0].month.as_str(),
            h.flexible[0].cents
        ),
        (fx.food, "2026-10", 6000)
    );
    // The bill counts as a need.
    assert_eq!(
        h.months
            .iter()
            .find(|m| m.month == "2026-10")
            .unwrap()
            .essential_cents,
        201500
    );
}

#[test]
fn this_months_days_skip_bill_charges() {
    let fx = setup();
    let netflix = bill(&fx, fx.food, "active");
    add(
        &fx,
        fx.card,
        "2026-11-03",
        -2500,
        Some(fx.food),
        "regular",
        "din tai",
    );
    let n = add(
        &fx,
        fx.card,
        "2026-11-05",
        -1500,
        Some(fx.food),
        "regular",
        "netflix",
    );
    fx.conn
        .execute(
            "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
            params![netflix, n],
        )
        .unwrap();
    add(
        &fx,
        fx.card,
        "2026-10-30",
        -999,
        Some(fx.food),
        "regular",
        "din tai",
    );

    let h = money_habits(&fx.conn, None, "2026-11-23").unwrap();
    let days: Vec<(&str, i64)> = h
        .days_this_month
        .iter()
        .map(|d| (d.day.as_str(), d.cents))
        .collect();
    assert_eq!(days, [("2026-11-03", 2500)]);
}

#[test]
fn frequent_merchants_over_the_last_year() {
    let fx = setup();
    for i in 0..30 {
        let date = format!("2026-{:02}-{:02}", 1 + i % 10, 1 + i / 10);
        add(
            &fx,
            fx.card,
            &date,
            -450,
            Some(fx.food),
            "regular",
            "blue bottle",
        );
    }
    for i in 0..10 {
        add(
            &fx,
            fx.card,
            &format!("2026-0{}-{}", 1 + i % 9, 15 + i / 9),
            -9000,
            Some(fx.food),
            "regular",
            "rare treat",
        );
    }
    add(
        &fx,
        fx.card,
        "2025-06-01",
        -450,
        Some(fx.food),
        "regular",
        "blue bottle",
    ); // over a year ago

    let h = money_habits(&fx.conn, None, "2026-11-23").unwrap();
    assert_eq!(h.merchants.len(), 1);
    let m = &h.merchants[0];
    assert_eq!(
        (m.name.as_str(), m.visits, m.total_cents),
        ("blue bottle", 30, 13500)
    );
}

#[test]
fn bills_that_went_up_in_the_last_year() {
    let fx = setup();
    let b = bill(&fx, fx.food, "active");
    for (on, from, to) in [
        ("2026-03-01", 1500, 1800),
        ("2026-06-01", 1800, 1700),
        ("2025-01-01", 1200, 1500),
    ] {
        fx.conn
            .execute("INSERT INTO recurring_prices (recurring_id, changed_on, from_cents, to_cents) VALUES (?1, ?2, ?3, ?4)", params![b, on, from, to])
            .unwrap();
    }
    assert_eq!(
        money_habits(&fx.conn, None, "2026-11-23")
            .unwrap()
            .bills_raised_last_12,
        1
    );
}

#[test]
fn no_history_gives_no_months() {
    let fx = setup();
    let h = money_habits(&fx.conn, None, "2026-11-23").unwrap();
    assert_eq!(h.first_month, None);
    assert!(h.months.is_empty());
}
