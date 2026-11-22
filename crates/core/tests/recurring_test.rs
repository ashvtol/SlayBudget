use chrono::NaiveDate;
use slaybudget_core::analytics::recurring::{detect, upcoming, Cadence};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, Transaction};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn tx(id: i64, merchant: &str, date: &str, cents: i64) -> Transaction {
    Transaction {
        tag_ids: vec![],
        id,
        profile_id: 1,
        source_id: 1,
        posted_on: d(date),
        description: merchant.into(),
        merchant: merchant.into(),
        amount_cents: cents,
        currency: "USD".into(),
        category_id: Some(5),
        category_locked: false,
        reviewed: true,
        notes: None,
        refund_of: None,
        parent_id: None,
        tx_type: Default::default(),
        recurring_id: None,
    }
}

#[test]
fn detects_a_monthly_subscription_and_projects_the_next_date() {
    let txs = vec![
        tx(1, "netflix", "2026-08-15", -1599),
        tx(2, "netflix", "2026-09-15", -1599),
        tx(3, "netflix", "2026-10-15", -1599),
        tx(4, "netflix", "2026-11-15", -1599),
    ];
    let found = detect(&txs);
    assert_eq!(found.len(), 1);
    let r = &found[0];
    assert_eq!(r.merchant, "netflix");
    assert_eq!(r.cadence, Cadence::Monthly);
    assert_eq!(r.typical_amount_cents, 1599);
    assert_eq!(r.occurrences, 4);
    assert_eq!(r.last_date, d("2026-11-15"));
    assert_eq!(r.next_date, d("2026-12-15"));
}

#[test]
fn ignores_irregular_merchants_and_one_offs() {
    let txs = vec![
        tx(1, "costco", "2026-08-02", -12000),
        tx(2, "costco", "2026-08-09", -3000),
        tx(3, "costco", "2026-10-28", -24000), // irregular gaps and amounts
        tx(4, "apple", "2026-10-01", -99900),  // single purchase
    ];
    assert!(detect(&txs).is_empty());
}

#[test]
fn weekly_cadence_is_classified() {
    let txs = vec![
        tx(1, "gym cafe", "2026-11-01", -800),
        tx(2, "gym cafe", "2026-11-08", -850),
        tx(3, "gym cafe", "2026-11-15", -820),
    ];
    let found = detect(&txs);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].cadence, Cadence::Weekly);
}

#[test]
fn upcoming_filters_by_today_over_real_db() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    for date in ["2026-08-20", "2026-09-20", "2026-10-20"] {
        let t = NewTransaction {
            profile_id: p,
            source_id: s,
            posted_on: d(date),
            description: "spotify".into(),
            amount_cents: -1199,
            currency: "USD".into(),
            occurrence: 0,
            category_id: None,
            import_id: None,
        };
        assert!(matches!(
            transactions::insert(&conn, &t).unwrap(),
            InsertOutcome::Inserted(_)
        ));
    }
    // Upcoming reads saved bills: save the detected one first (as the app does on first run).
    assert_eq!(
        slaybudget_core::recurrings::seed_if_needed(&conn).unwrap(),
        1
    );
    // next_date = 2026-11-20
    assert_eq!(upcoming(&conn, Some(p), d("2026-11-01")).unwrap().len(), 1);
    assert_eq!(upcoming(&conn, Some(p), d("2026-12-01")).unwrap().len(), 0);
}

#[test]
fn same_day_repeats_count_once_and_do_not_break_the_cadence() {
    // A monthly bill where two months show the same charge twice on one day.
    let txs = vec![
        tx(1, "geico auto", "2026-02-03", -14200),
        tx(2, "geico auto", "2026-03-03", -14200),
        tx(3, "geico auto", "2026-03-03", -14200),
        tx(4, "geico auto", "2026-04-03", -14200),
        tx(5, "geico auto", "2026-05-03", -14200),
        tx(6, "geico auto", "2026-05-03", -14200),
        tx(7, "geico auto", "2026-06-03", -14200),
    ];
    let found = detect(&txs);
    assert_eq!(
        found.len(),
        1,
        "a monthly bill with same-day repeats is still detected"
    );
    assert_eq!(found[0].cadence, Cadence::Monthly);
    assert_eq!(found[0].occurrences, 5);
    assert_eq!(found[0].next_date, d("2026-07-03"));
}

#[test]
fn transfers_are_never_detected_as_bills() {
    let mut txs: Vec<Transaction> = ["2026-08-20", "2026-09-20", "2026-10-20"]
        .iter()
        .enumerate()
        .map(|(i, day)| tx(i as i64 + 1, "citi autopay", day, -50000))
        .collect();
    for t in &mut txs {
        t.tx_type = slaybudget_core::transactions::TxType::Transfer;
    }
    assert!(detect(&txs).is_empty());
}
