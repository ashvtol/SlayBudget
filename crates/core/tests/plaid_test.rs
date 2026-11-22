use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::plaid::{import_plaid, to_parsed_row, PlaidTxn};
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, TransactionFilter};

fn txn(
    id: &str,
    date: &str,
    name: &str,
    merchant: Option<&str>,
    amount: f64,
    pending: bool,
) -> PlaidTxn {
    PlaidTxn {
        transaction_id: id.into(),
        account_id: "acct1".into(),
        date: date.into(),
        name: name.into(),
        merchant_name: merchant.map(|m| m.into()),
        amount,
        iso_currency_code: Some("USD".into()),
        pending,
    }
}

#[test]
fn maps_plaid_sign_and_prefers_merchant_name() {
    // Plaid positive amount = money out -> our negative (expense).
    let expense = to_parsed_row(
        &txn(
            "t1",
            "2026-11-10",
            "SQ *BLUE BOTTLE",
            Some("Blue Bottle"),
            6.50,
            false,
        ),
        0,
    )
    .unwrap();
    assert_eq!(expense.amount_cents, -650);
    assert_eq!(expense.description, "Blue Bottle");
    // Plaid negative amount = money in -> our positive (income).
    let income = to_parsed_row(
        &txn("t2", "2026-11-01", "PAYROLL", None, -2500.00, false),
        0,
    )
    .unwrap();
    assert_eq!(income.amount_cents, 250000);
    assert_eq!(income.description, "PAYROLL");
}

#[test]
fn import_is_idempotent_across_syncs_and_skips_pending() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Chase (Plaid)", SourceKind::Csv).unwrap();
    let batch = vec![
        txn(
            "t1",
            "2026-11-10",
            "BLUE BOTTLE",
            Some("Blue Bottle"),
            6.50,
            false,
        ),
        txn(
            "t2",
            "2026-11-11",
            "WHOLE FOODS",
            Some("Whole Foods"),
            52.10,
            false,
        ),
        txn(
            "t3",
            "2026-11-12",
            "PENDING COFFEE",
            Some("Coffee"),
            4.00,
            true,
        ), // skipped
    ];
    let r1 = import_plaid(&conn, p, s, &batch).unwrap();
    assert_eq!(r1.inserted, 2);
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        2
    );

    // Re-sync the same window: no new rows.
    let r2 = import_plaid(&conn, p, s, &batch).unwrap();
    assert_eq!(r2.inserted, 0);
    assert_eq!(r2.duplicates, 2);
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        2
    );
}
