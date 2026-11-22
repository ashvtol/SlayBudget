//! Diagnostic: run every analytics call Insights makes, for each range, against a database.
use slaybudget_core::analytics::aggregate::{category_totals, monthly_totals, TimeRange};
use slaybudget_core::analytics::{budgets, cashflow, recurring};

fn main() {
    let path = std::env::args().nth(1).expect("db");
    let conn = slaybudget_core::db::open_db(std::path::Path::new(&path)).unwrap();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
    for r in [
        TimeRange::Week,
        TimeRange::Month,
        TimeRange::ThreeMonths,
        TimeRange::SixMonths,
        TimeRange::Ytd,
        TimeRange::Year,
        TimeRange::All,
    ] {
        let range = r.range(today);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let m = monthly_totals(&conn, None, range).map(|v| v.len());
            let c = category_totals(&conn, None, range).map(|v| v.len());
            let b = budgets::month_status(&conn, None, today).map(|v| v.len());
            let f = cashflow::cash_flow(&conn, None, range).map(|f| f.current.net_cents);
            let u = recurring::upcoming(&conn, None, today).map(|v| v.len());
            format!("{m:?} {c:?} {b:?} {f:?} {u:?}")
        }));
        println!(
            "{r:?}: {}",
            match res {
                Ok(s) => s,
                Err(_) => "PANIC".into(),
            }
        );
    }
}
