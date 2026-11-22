use chrono::NaiveDate;
use slaybudget_core::analytics::refunds::{self, RefundMatch};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn setup() -> (rusqlite::Connection, i64, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    (conn, p, s)
}

fn add(conn: &rusqlite::Connection, p: i64, s: i64, date: &str, desc: &str, cents: i64) -> i64 {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: d(date),
        description: desc.into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: None,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        InsertOutcome::Duplicate(id) => id,
    }
}

#[test]
fn charge_pairs_with_closest_same_merchant_credit_in_window() {
    let (conn, p, s) = setup();
    let charge = add(
        &conn,
        p,
        s,
        "2026-10-01",
        "AMAZON MKTPLACE PMTS AB12",
        -3240,
    );
    let far = add(&conn, p, s, "2026-10-20", "AMAZON MKTPLACE PMTS XY99", 3240);
    let near = add(&conn, p, s, "2026-10-05", "AMAZON MKTPLACE PMTS CD34", 3240);
    let matches = refunds::rematch(&conn, Some(p)).unwrap();
    assert_eq!(
        matches,
        vec![RefundMatch {
            charge_id: charge,
            refund_id: near,
            amount_cents: 3240,
            days_between: 4
        }]
    );
    assert_eq!(
        transactions::get(&conn, near).unwrap().refund_of,
        Some(charge)
    );
    assert_eq!(transactions::get(&conn, far).unwrap().refund_of, None);
}

#[test]
fn refund_keyword_bridges_different_merchants() {
    let (conn, p, s) = setup();
    let charge = add(&conn, p, s, "2026-09-01", "NIKE STORE 44", -8999);
    let credit = add(&conn, p, s, "2026-09-10", "REFUND NIKE.COM", 8999);
    let m = refunds::rematch(&conn, Some(p)).unwrap();
    assert_eq!(m[0].charge_id, charge);
    assert_eq!(m[0].refund_id, credit);
}

#[test]
fn outside_window_or_different_amount_does_not_match() {
    let (conn, p, s) = setup();
    add(&conn, p, s, "2026-01-01", "TARGET 1", -5000);
    add(&conn, p, s, "2026-06-01", "TARGET 1", 5000);
    add(&conn, p, s, "2026-07-01", "COSTCO", -2000);
    add(&conn, p, s, "2026-07-02", "COSTCO", 2001);
    assert!(refunds::rematch(&conn, Some(p)).unwrap().is_empty());
}

#[test]
fn a_credit_is_used_at_most_once() {
    let (conn, p, s) = setup();
    let c1 = add(&conn, p, s, "2026-10-01", "UBER TRIP", -1500);
    let c2 = add(&conn, p, s, "2026-10-02", "UBER TRIP", -1500);
    let credit = add(&conn, p, s, "2026-10-03", "UBER TRIP", 1500);
    let m = refunds::rematch(&conn, Some(p)).unwrap();
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].refund_id, credit);
    assert_eq!(m[0].charge_id, c2, "closest charge wins the credit");
    assert_ne!(m[0].charge_id, c1);
}

#[test]
fn rematch_clears_stale_links() {
    let (conn, p, s) = setup();
    let charge = add(&conn, p, s, "2026-10-01", "ZARA", -4000);
    let credit = add(&conn, p, s, "2026-10-04", "ZARA", 4000);
    refunds::rematch(&conn, Some(p)).unwrap();
    assert_eq!(
        transactions::get(&conn, credit).unwrap().refund_of,
        Some(charge)
    );
    transactions::update(
        &conn,
        credit,
        &transactions::TransactionPatch {
            amount_cents: Some(4100),
            ..Default::default()
        },
    )
    .unwrap();
    refunds::rematch(&conn, Some(p)).unwrap();
    assert_eq!(transactions::get(&conn, credit).unwrap().refund_of, None);
}
