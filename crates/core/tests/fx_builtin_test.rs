use slaybudget_core::fx::builtin;

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() / b < 1e-6
}

#[test]
fn rates_go_through_the_euro_and_the_same_currency_is_one() {
    let r = builtin();
    let usd = r.per_euro("USD", "2026-10").unwrap();
    let inr = r.per_euro("INR", "2026-10").unwrap();
    assert!(close(r.rate("USD", "INR", "2026-10").unwrap(), inr / usd));
    assert!(close(r.rate("EUR", "USD", "2026-10").unwrap(), usd));
    assert!(close(r.rate("USD", "EUR", "2026-10").unwrap(), 1.0 / usd));
    assert_eq!(r.rate("INR", "INR", "2026-10"), Some(1.0));
    assert_eq!(r.rate("USD", "XXX", "2026-10"), None);
    let one_usd_in_inr = r.rate("USD", "INR", "2026-10").unwrap();
    assert!((80.0..120.0).contains(&one_usd_in_inr), "{one_usd_in_inr}");
}

#[test]
fn months_after_the_data_use_the_latest_and_months_before_use_the_first() {
    let r = builtin();
    let latest = r.latest_month().to_string();
    assert!(latest.as_str() >= "2026-10");
    assert_eq!(
        r.rate("USD", "INR", "2099-01"),
        r.rate("USD", "INR", &latest)
    );
    // INR's first monthly average is 2000-01.
    assert_eq!(
        r.rate("USD", "INR", "1995-03"),
        r.rate("USD", "INR", "2000-01")
    );
}

#[test]
fn the_built_in_currencies() {
    let r = builtin();
    let list = r.currencies();
    for c in ["EUR", "USD", "INR", "GBP", "JPY", "CAD", "AUD", "SGD"] {
        assert!(list.contains(&c.to_string()), "{c}");
    }
    assert!(
        !list.contains(&"GRD".to_string()),
        "retired currencies are left out"
    );
}
