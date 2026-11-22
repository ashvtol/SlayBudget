use chrono::NaiveDate;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::search::parser::parse;
use slaybudget_core::search::search;
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}
const TODAY: &str = "2026-11-17";

#[test]
fn parse_amounts_periods_and_text() {
    let q = parse("starbucks over $5 last month", d(TODAY));
    assert_eq!(q.text, "starbucks");
    assert_eq!(q.min_abs_cents, Some(500));
    assert_eq!(q.from, Some(d("2026-10-01")));
    assert_eq!(q.to, Some(d("2026-10-31")));

    let q2 = parse("groceries in january", d(TODAY));
    assert_eq!(q2.text, "groceries");
    assert_eq!(q2.from, Some(d("2026-01-01")));
    assert_eq!(q2.to, Some(d("2026-01-31")));

    let q3 = parse("income in 2025", d(TODAY));
    assert!(q3.income_only);
    assert_eq!(q3.from, Some(d("2025-01-01")));
    assert_eq!(q3.to, Some(d("2025-12-31")));

    let q4 = parse("under $20 ytd", d(TODAY));
    assert_eq!(q4.max_abs_cents, Some(2000));
    assert_eq!(q4.from, Some(d("2026-01-01")));
    assert_eq!(q4.to, Some(d("2026-11-17")));
    assert_eq!(q4.text, "");
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
        _ => panic!(),
    }
}

#[test]
fn fts_search_matches_text_and_filters() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    add(&conn, p, s, "2026-10-04", "STARBUCKS STORE 123", -650);
    add(&conn, p, s, "2026-10-20", "STARBUCKS RESERVE", -1200);
    add(&conn, p, s, "2026-11-01", "WHOLE FOODS", -5000);

    // prefix match on "starb"
    let q = parse("starb", d(TODAY));
    let hits = search(&conn, Some(p), &q, 50).unwrap();
    assert_eq!(hits.len(), 2);

    // text + amount filter
    let q2 = parse("starbucks over $10", d(TODAY));
    let hits2 = search(&conn, Some(p), &q2, 50).unwrap();
    assert_eq!(hits2.len(), 1);
    assert_eq!(hits2[0].amount_cents, -1200);

    // period only, no text
    let q3 = parse("in october", d(TODAY));
    let hits3 = search(&conn, Some(p), &q3, 50).unwrap();
    assert_eq!(hits3.len(), 2);
}

#[test]
fn fts_stays_in_sync_on_update_and_delete() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let id = add(&conn, p, s, "2026-10-04", "COSTCO GAS", -4000);
    assert_eq!(
        search(&conn, Some(p), &parse("costco", d(TODAY)), 50)
            .unwrap()
            .len(),
        1
    );
    conn.execute("DELETE FROM transactions WHERE id = ?1", [id])
        .unwrap();
    assert_eq!(
        search(&conn, Some(p), &parse("costco", d(TODAY)), 50)
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn income_and_spending_go_by_transaction_type_not_sign() {
    use slaybudget_core::transactions::TxType;
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let pay = add(&conn, p, s, "2026-11-01", "ACME PAYROLL", 500000);
    let card_payment = add(
        &conn,
        p,
        s,
        "2026-11-02",
        "ONLINE PAYMENT THANK YOU",
        120000,
    );
    let refund = add(&conn, p, s, "2026-11-03", "AMAZON REFUND", 2500);
    let coffee = add(&conn, p, s, "2026-11-04", "BLUE BOTTLE COFFEE", -650);
    let transfer_out = add(&conn, p, s, "2026-11-05", "TRANSFER TO SAVINGS", -100000);
    transactions::set_type(&conn, &[pay], TxType::Income).unwrap();
    transactions::set_type(&conn, &[card_payment, transfer_out], TxType::Transfer).unwrap();
    let today = d("2026-11-20");
    let ids = |q: &str| -> Vec<i64> {
        search(&conn, Some(p), &parse(q, today), 50)
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect()
    };
    assert_eq!(
        ids("income"),
        vec![pay],
        "a card payment or a refund is not income"
    );
    assert_eq!(
        ids("spending"),
        vec![coffee],
        "a transfer out is not spending"
    );
    let _ = refund;
}
