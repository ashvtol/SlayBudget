use chrono::NaiveDate;
use slaybudget_core::analytics::aggregate::{category_totals, monthly_totals, DateRange};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::fx::{self, builtin, Basis};
use slaybudget_core::import::pipeline;
use slaybudget_core::profiles;
use slaybudget_core::settings;

const CSV: &str = "Transaction Date,Posted Date,Memo,Amount\n2025-01-10,2025-01-10,SHELL 1,-100.00\n2026-10-10,2026-10-10,SHELL 2,-100.00\n";

fn setup() -> rusqlite::Connection {
    let conn = open_in_memory().unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    pipeline::import_csv(&conn, p, "Statements/Visa/a.csv", CSV).unwrap();
    conn
}
fn all() -> DateRange {
    DateRange {
        from: None,
        to: None,
    }
}
fn show(conn: &rusqlite::Connection, currency: &str, basis: &str) {
    settings::set(conn, "display_currency", currency).unwrap();
    settings::set(conn, "fx_basis", basis).unwrap();
    fx::refresh_display(conn).unwrap();
}
fn inr(month: &str, usd_cents: i64) -> i64 {
    (usd_cents as f64 * builtin().rate("USD", "INR", month).unwrap()).round() as i64
}

#[test]
fn amounts_stay_as_they_are_until_you_pick_another_currency() {
    let conn = setup();
    assert_eq!(
        fx::display(&conn),
        fx::Display {
            currency: "USD".into(),
            basis: Basis::Month
        }
    );
    let months = monthly_totals(&conn, None, all()).unwrap();
    assert_eq!(
        months.iter().map(|m| m.expense_cents).collect::<Vec<_>>(),
        vec![10_000, 10_000]
    );
}

#[test]
fn totals_convert_row_by_row_at_each_months_rate() {
    let conn = setup();
    show(&conn, "INR", "monthAverage");
    let months = monthly_totals(&conn, None, all()).unwrap();
    assert_eq!(months[0].expense_cents, inr("2025-01", 10_000));
    assert_eq!(months[1].expense_cents, inr("2026-10", 10_000));
    assert_ne!(
        months[0].expense_cents, months[1].expense_cents,
        "different months, different rates"
    );
    let total: i64 = category_totals(&conn, None, all())
        .unwrap()
        .iter()
        .map(|c| c.total_cents)
        .sum();
    assert_eq!(total, inr("2025-01", 10_000) + inr("2026-10", 10_000));
}

#[test]
fn latest_rates_use_the_newest_month_for_everything_and_switching_back_is_exact() {
    let conn = setup();
    show(&conn, "INR", "latest");
    let latest = builtin().latest_month().to_string();
    let months = monthly_totals(&conn, None, all()).unwrap();
    assert!(months
        .iter()
        .all(|m| m.expense_cents == inr(&latest, 10_000)));
    show(&conn, "USD", "transactionDate");
    assert!(monthly_totals(&conn, None, all())
        .unwrap()
        .iter()
        .all(|m| m.expense_cents == 10_000));
}

#[test]
fn converting_one_amount() {
    let d = fx::Display {
        currency: "INR".into(),
        basis: Basis::Month,
    };
    let on = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();
    assert_eq!(fx::to_display(&d, 1_000, "USD", on), inr("2026-10", 1_000));
    assert_eq!(fx::to_display(&d, 1_000, "INR", on), 1_000);
    assert_eq!(
        fx::to_display(&d, 1_000, "XXX", on),
        1_000,
        "an unknown currency is shown as it is"
    );
    let back = fx::from_display(&d, fx::to_display(&d, 123_456, "USD", on), "USD", on);
    assert!(
        (back - 123_456).abs() <= 1,
        "round trip within a cent: {back}"
    );
}

#[test]
fn shown_amounts_transactions_at_their_month_budgets_and_bills_at_the_latest() {
    let conn = setup();
    let plain = fx::Shown::of(&conn);
    assert!(plain.is_plain(), "USD shown as USD: nothing to convert");
    assert_eq!(plain.budget(50_000), 50_000);

    show(&conn, "INR", "monthAverage");
    let shown = fx::Shown::of(&conn);
    assert!(!shown.is_plain());
    let latest = builtin().latest_month().to_string();
    assert_eq!(
        shown.budget(50_000),
        inr(&latest, 50_000),
        "budgets are in USD until you set one in INR"
    );
    assert_eq!(shown.charge(50_000), inr(&latest, 50_000));
    assert!((shown.charge_back(shown.charge(50_000)) - 50_000).abs() <= 1);
    let on = NaiveDate::from_ymd_opt(2025, 1, 10).unwrap();
    assert_eq!(shown.transaction(10_000, "USD", on), inr("2025-01", 10_000));
}

#[test]
fn a_budget_you_type_in_another_currency_is_stored_exactly_and_the_others_follow() {
    use slaybudget_core::{budgets, categories};
    let conn = setup();
    let cats = categories::list(&conn).unwrap();
    let groceries = cats.iter().find(|c| c.name == "Groceries").unwrap().id;
    let gas = cats.iter().find(|c| c.name != "Groceries").unwrap().id;
    budgets::set_budget(&conn, gas, None, Some(10_000)).unwrap();
    show(&conn, "INR", "monthAverage");
    budgets::set_budget_shown(&conn, groceries, None, Some(4_000_000)).unwrap();
    assert_eq!(fx::budget_currency(&conn), "INR");
    let latest = builtin().latest_month().to_string();
    let shown = fx::Shown::of(&conn);
    let budget_of = |id: i64| {
        categories::list(&conn)
            .unwrap()
            .into_iter()
            .find(|c| c.id == id)
            .unwrap()
            .budget_cents
            .unwrap()
    };
    assert_eq!(
        shown.budget(budget_of(groceries)),
        4_000_000,
        "exactly what you typed"
    );
    assert_eq!(
        shown.budget(budget_of(gas)),
        inr(&latest, 10_000),
        "the others moved to rupees at the latest rate"
    );
    // Back to dollars: shown converted, data unchanged.
    show(&conn, "USD", "monthAverage");
    let back = fx::Shown::of(&conn).budget(budget_of(groceries));
    assert_eq!(
        back,
        (4_000_000.0 / builtin().rate("USD", "INR", &latest).unwrap()).round() as i64
    );
}
