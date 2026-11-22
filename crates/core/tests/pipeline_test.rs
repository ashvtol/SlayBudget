use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::categorize::learning;
use slaybudget_core::categorize::rules::{self, MatchKind, NewRule};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::ofx::parse_ofx;
use slaybudget_core::import::pipeline::{self, StatementKind};
use slaybudget_core::profiles;
use slaybudget_core::transactions::{self, TransactionFilter};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn legacy(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::find_by_legacy_name(conn, name)
        .unwrap()
        .unwrap()
        .id
}

fn category_of(conn: &rusqlite::Connection, profile: i64, description: &str) -> Option<i64> {
    transactions::list(conn, &TransactionFilter::for_profile(profile))
        .unwrap()
        .into_iter()
        .find(|t| t.description == description)
        .and_then(|t| t.category_id)
}

#[test]
fn csv_import_categorizes_and_is_idempotent() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let report = pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    assert_eq!(
        (report.inserted, report.duplicates, report.skipped),
        (6, 0, 0)
    );
    assert_eq!(report.source_name, "Amex");
    let again = pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    assert_eq!(again.inserted, 0);
    assert!(again.already_imported);
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        6
    );

    assert_eq!(
        category_of(&conn, p, "UBER"),
        Some(legacy(&conn, "Transportation - Cab/Rideshare"))
    );
    assert_eq!(
        category_of(&conn, p, "WHOLE FOODS MKT 10234"),
        Some(legacy(&conn, "Groceries"))
    );
    assert_eq!(
        category_of(&conn, p, "NETFLIX.COM"),
        Some(legacy(&conn, "Digital Entertainment"))
    );
    assert_eq!(
        category_of(&conn, p, "AUTOPAY PAYMENT - THANK YOU"),
        Some(legacy(&conn, "Payment"))
    );
    assert_eq!(
        category_of(&conn, p, "AMAZON.COM*AB12CD34 AMZN.COM/BILL"),
        Some(legacy(&conn, "Credits/Refunds")),
        "credit on a card statement"
    );
}

#[test]
fn a_regrown_export_only_adds_its_new_rows() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    let grown = fixture("amex.csv")
        + "07/01/2026,NEW MERCHANT,12.00,,NEW MERCHANT,,,,,'320262000000000007',\n";
    let report =
        pipeline::import_csv(&conn, p, "Statements/Alex/Amex/YTD-2026.csv", &grown).unwrap();
    assert!(
        !report.already_imported,
        "different content is a new import"
    );
    assert_eq!(
        (report.inserted, report.duplicates),
        (1, 6),
        "only the new row lands"
    );
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        7
    );
}

#[test]
fn rules_beat_learned_which_beat_heuristics() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let groceries = legacy(&conn, "Groceries");
    let fuel = legacy(&conn, "Transportation - Fuel");
    let other = legacy(&conn, "Other");
    learning::learn(&conn, "netflix.com", groceries, None).unwrap();
    rules::create(
        &conn,
        &NewRule {
            name: "uber is fuel".into(),
            match_kind: MatchKind::Contains,
            pattern: "uber".into(),
            min_cents: None,
            max_cents: None,
            source_id: None,
            category_id: fuel,
            priority: 0,
        },
    )
    .unwrap();
    pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    assert_eq!(category_of(&conn, p, "UBER"), Some(fuel), "rule wins");
    assert_eq!(
        category_of(&conn, p, "NETFLIX.COM"),
        Some(groceries),
        "learned wins over heuristic"
    );
    assert_ne!(category_of(&conn, p, "WHOLE FOODS MKT 10234"), Some(other));
}

#[test]
fn checking_statement_kinds_route_income_and_card_payments() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Citi-Checking", profiles::SourceKind::Pdf)
        .unwrap();
    let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
    let rows = vec![
        slaybudget_core::import::ParsedRow {
            posted_on: d("2026-01-02"),
            description: "ACH Electronic Credit ACME PAYROLL".into(),
            amount_cents: 325_000,
            occurrence: 0,
            pending: false,
            raw_category: None,
            details: Vec::new(),
        },
        slaybudget_core::import::ParsedRow {
            posted_on: d("2026-01-03"),
            description: "Transfer to Bankcard AMERICAN EXPRESS".into(),
            amount_cents: -125_000,
            occurrence: 0,
            pending: false,
            raw_category: None,
            details: Vec::new(),
        },
        slaybudget_core::import::ParsedRow {
            posted_on: d("2026-01-04"),
            description: "Debit Card Purchase 01/03 #1 SHELL OIL".into(),
            amount_cents: -4800,
            occurrence: 0,
            pending: false,
            raw_category: None,
            details: Vec::new(),
        },
    ];
    let report = pipeline::import_rows(
        &conn,
        p,
        s,
        "January 09.pdf",
        "hash-1",
        StatementKind::Checking,
        rows,
    )
    .unwrap();
    assert_eq!(report.inserted, 3);
    assert_eq!(
        category_of(&conn, p, "ACH Electronic Credit ACME PAYROLL"),
        Some(legacy(&conn, "Income - Salary"))
    );
    assert_eq!(
        category_of(&conn, p, "Transfer to Bankcard AMERICAN EXPRESS"),
        Some(legacy(&conn, "Payment"))
    );
    assert_eq!(
        category_of(&conn, p, "Debit Card Purchase 01/03 #1 SHELL OIL"),
        Some(legacy(&conn, "Transportation - Fuel"))
    );
}

#[test]
fn ofx_parses_transactions_and_skips_zero_amounts() {
    let parsed = parse_ofx(&fixture("sample.qfx")).unwrap();
    assert_eq!(parsed.rows.len(), 2);
    assert_eq!(
        parsed.rows[0].posted_on,
        NaiveDate::from_ymd_opt(2026, 6, 3).unwrap()
    );
    assert_eq!(parsed.rows[0].description, "CHIPOTLE 1234 SEATTLE WA");
    assert_eq!(parsed.rows[0].amount_cents, -2345);
    assert_eq!(parsed.rows[1].amount_cents, 50_000);
    assert_eq!(parsed.skipped, 1);
    assert_eq!(parsed.currency.as_deref(), Some("USD"));
    assert!(parse_ofx("not ofx").is_err());
}

#[test]
fn import_runs_refund_matching() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let csv = "Date,Description,Amount,Extended Details,Appears On Your Statement As\n06/01/2026,ZARA 1,40.00,,\n06/04/2026,ZARA 1,-40.00,,\n";
    pipeline::import_csv(&conn, p, "Amex/x.csv", csv).unwrap();
    let all = transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap();
    let credit = all.iter().find(|t| t.amount_cents > 0).unwrap();
    assert!(credit.refund_of.is_some());
}

#[test]
fn a_bare_amex_file_is_filed_under_amex_not_imported() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let report = pipeline::import_csv(&conn, p, "activity.csv", &fixture("amex.csv")).unwrap();
    assert_eq!(report.source_name, "Amex");
}

#[test]
fn a_bare_citi_costco_file_is_filed_under_citi_costco() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let report =
        pipeline::import_csv(&conn, p, "export.csv", &fixture("citi-costco-2026.csv")).unwrap();
    assert_eq!(report.source_name, "Citi-Costco");
}

#[test]
fn the_same_file_under_another_source_counts_as_already_imported() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    let again = pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex-Gold/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    assert!(again.already_imported);
    assert_eq!(again.inserted, 0);
    assert_eq!(again.source_name, "Amex");
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        6
    );
    // No empty source is left behind for the second path.
    let names: Vec<String> = profiles::list_sources(&conn, p)
        .unwrap()
        .into_iter()
        .map(|s| s.name)
        .collect();
    assert_eq!(names, vec!["Amex".to_string()]);
}
