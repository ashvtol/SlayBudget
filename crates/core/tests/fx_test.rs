use chrono::NaiveDate;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::fx::{self, FxRate};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

#[test]
fn rate_on_uses_the_most_recent_rate_on_or_before_the_date() {
    let conn = open_in_memory().unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-10-01"), 83.0).unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 84.0).unwrap();
    assert_eq!(
        fx::rate_on(&conn, "USD", "INR", d("2026-10-15")).unwrap(),
        Some(83.0)
    );
    assert_eq!(
        fx::rate_on(&conn, "USD", "INR", d("2026-11-10")).unwrap(),
        Some(84.0)
    );
    // before any rate
    assert_eq!(
        fx::rate_on(&conn, "USD", "INR", d("2026-09-01")).unwrap(),
        None
    );
    // same currency is identity
    assert_eq!(
        fx::rate_on(&conn, "USD", "USD", d("2026-11-10")).unwrap(),
        Some(1.0)
    );
}

#[test]
fn inverse_pair_is_used_when_only_the_other_direction_is_stored() {
    let conn = open_in_memory().unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 80.0).unwrap();
    let inr_to_usd = fx::rate_on(&conn, "INR", "USD", d("2026-11-10"))
        .unwrap()
        .unwrap();
    assert!((inr_to_usd - 0.0125).abs() < 1e-9);
}

#[test]
fn convert_cents_applies_the_dated_rate() {
    let conn = open_in_memory().unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 84.0).unwrap();
    // $100.00 -> 8400.00 INR
    assert_eq!(
        fx::convert_cents(&conn, 10000, "USD", "INR", d("2026-11-05")).unwrap(),
        Some(840000)
    );
    assert_eq!(
        fx::convert_cents(&conn, 10000, "USD", "EUR", d("2026-11-05")).unwrap(),
        None
    );
}

#[test]
fn month_average_and_latest() {
    let conn = open_in_memory().unwrap();
    let mut conn = conn;
    let rates = vec![
        FxRate {
            base: "USD".into(),
            quote: "INR".into(),
            as_of: d("2026-11-01"),
            rate: 82.0,
        },
        FxRate {
            base: "USD".into(),
            quote: "INR".into(),
            as_of: d("2026-11-15"),
            rate: 84.0,
        },
        FxRate {
            base: "USD".into(),
            quote: "INR".into(),
            as_of: d("2026-10-10"),
            rate: 80.0,
        },
    ];
    assert_eq!(fx::upsert_many(&mut conn, &rates).unwrap(), 3);
    assert_eq!(
        fx::month_average(&conn, "USD", "INR", "2026-11").unwrap(),
        Some(83.0)
    );
    assert_eq!(fx::latest(&conn, "USD", "INR").unwrap(), Some(84.0));
}

#[test]
fn upsert_replaces_a_same_day_rate_and_rejects_nonpositive() {
    let conn = open_in_memory().unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 83.0).unwrap();
    fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 83.5).unwrap();
    assert_eq!(fx::latest(&conn, "USD", "INR").unwrap(), Some(83.5));
    assert!(fx::upsert(&conn, "USD", "INR", d("2026-11-01"), 0.0).is_err());
}
