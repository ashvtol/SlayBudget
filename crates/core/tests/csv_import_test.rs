use chrono::NaiveDate;
use slaybudget_core::import::csv::{parse_csv, CsvLayout};
use slaybudget_core::import::source_from_path;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

#[test]
fn amex_layout_positive_is_charge_and_multiline_fields_parse() {
    let parsed = parse_csv(&fixture("amex.csv")).unwrap();
    assert_eq!(parsed.layout, CsvLayout::Amex);
    assert_eq!(parsed.rows.len(), 6);
    let uber = &parsed.rows[0];
    assert_eq!(uber.posted_on, d("2026-06-27"));
    assert_eq!(uber.description, "UBER");
    assert_eq!(uber.amount_cents, -331);
    let refund = &parsed.rows[2];
    assert_eq!(refund.amount_cents, 3240);
    let payment = &parsed.rows[3];
    assert_eq!(payment.amount_cents, 125_000);
    assert_eq!(parsed.rows[4].occurrence, 0);
    assert_eq!(
        parsed.rows[5].occurrence, 1,
        "identical rows get distinct occurrences"
    );
    assert_eq!(
        uber.raw_category.as_deref(),
        Some("Transportation-Taxis & Coach")
    );
}

#[test]
fn citi_costco_2026_layout_uses_debit_credit_columns() {
    let parsed = parse_csv(&fixture("citi-costco-2026.csv")).unwrap();
    assert_eq!(parsed.layout, CsvLayout::CitiCostco);
    assert_eq!(parsed.rows.len(), 5);
    assert_eq!(parsed.rows[0].amount_cents, -12034);
    assert_eq!(
        parsed.rows[2].amount_cents, 90_000,
        "credit column, negative in file, is money in"
    );
    assert_eq!(parsed.rows[3].amount_cents, 1599);
    assert_eq!(parsed.rows[4].description, "TRADER JOE'S #130 SEATTLE WA");
    assert!(parsed.rows[4].pending);
    assert!(!parsed.rows[0].pending);
}

#[test]
fn citi_costco_2025_layout_skips_the_report_preamble() {
    let parsed = parse_csv(&fixture("citi-costco-2025.csv")).unwrap();
    assert_eq!(parsed.layout, CsvLayout::CitiCostco);
    assert_eq!(parsed.rows.len(), 3);
    assert_eq!(parsed.rows[0].posted_on, d("2025-12-30"));
    assert_eq!(parsed.rows[1].amount_cents, 64_055);
    assert_eq!(parsed.rows[2].raw_category.as_deref(), Some("Merchandise"));
}

#[test]
fn generic_layout_maps_common_header_names() {
    let parsed = parse_csv(&fixture("generic.csv")).unwrap();
    assert_eq!(parsed.layout, CsvLayout::Generic);
    assert_eq!(parsed.rows.len(), 2);
    assert_eq!(parsed.rows[0].posted_on, d("2026-05-01"));
    assert_eq!(parsed.rows[0].description, "Coffee Shop 12");
    assert_eq!(
        parsed.rows[0].amount_cents, -450,
        "generic: sign is kept as-is"
    );
    assert_eq!(parsed.rows[1].amount_cents, 250_000);
}

#[test]
fn unrecognized_headers_are_an_error_and_zero_rows_are_skipped() {
    assert!(parse_csv("foo,bar\n1,2\n").is_err());
    let parsed =
        parse_csv("Date,Description,Amount\n01/02/2026,ZERO,0.00\n01/03/2026,ONE,1.00\n").unwrap();
    assert_eq!(parsed.rows.len(), 1);
    assert_eq!(parsed.skipped, 1);
}

#[test]
fn source_and_user_come_from_the_statements_folder_layout() {
    assert_eq!(
        source_from_path("Statements/Alex/Amex/YTD-2026.csv"),
        (Some("Alex".into()), "Amex".into())
    );
    assert_eq!(
        source_from_path("/Users/a/Statments/Jamie/Citi-Costco/YTD 2025.CSV"),
        (Some("Jamie".into()), "Citi-Costco".into())
    );
    assert_eq!(
        source_from_path("Alex/Citi-Checking/March 09.pdf"),
        (Some("Alex".into()), "Citi-Checking".into())
    );
    assert_eq!(source_from_path("Amex/x.csv"), (None, "Amex".into()));
    assert_eq!(source_from_path("x.csv"), (None, "Imported".into()));
}

#[test]
fn a_basic_amex_export_in_an_amex_folder_keeps_charges_as_money_out() {
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::import::pipeline;
    use slaybudget_core::profiles;
    use slaybudget_core::transactions::{self, TransactionFilter};
    // Amex's basic export has only Date, Description, Amount, with charges positive.
    let basic = "Date,Description,Amount\n11/16/2026,AMAZON TIPS*YB99X95HAMZN.COM/BILL       WA,5.00\n11/15/2026,AUTOPAY PAYMENT - THANK YOU,-120.00\n";
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    pipeline::import_csv(&conn, p, "Statements/Alex/Amex/YTD-2026.csv", basic).unwrap();
    let rows = transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap();
    let amount = |d: &str| {
        rows.iter()
            .find(|t| t.description.starts_with(d))
            .unwrap()
            .amount_cents
    };
    assert_eq!(amount("AMAZON TIPS"), -500);
    assert_eq!(amount("AUTOPAY"), 12000);
}

#[test]
fn a_basic_csv_elsewhere_keeps_its_signs() {
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::import::pipeline;
    use slaybudget_core::profiles;
    use slaybudget_core::transactions::{self, TransactionFilter};
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Chase/activity.csv",
        "Date,Description,Amount\n11/16/2026,COFFEE,-5.00\n",
    )
    .unwrap();
    assert_eq!(
        transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap()[0].amount_cents,
        -500
    );
}

#[test]
fn an_unsigned_amount_with_a_debit_credit_column_is_read_with_its_sign() {
    // Capital One's layout: "Transaction Amount" always positive, "Transaction Type" says which way it went.
    let csv = "Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n\
               1234,\"ATM Withdrawal - MAIN ST ATM SEATTLE, WA\",11/07/26,Debit,103,7.05\n\
               1234,Zelle money received from SAM RIVERA,11/07/26,Credit,100,110.05\n\
               1234,Monthly Interest Paid,10/31/26,Credit,0.01,10.05\n";
    let parsed = parse_csv(csv).unwrap();
    let rows: Vec<(NaiveDate, &str, i64)> = parsed
        .rows
        .iter()
        .map(|r| (r.posted_on, r.description.as_str(), r.amount_cents))
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                d("2026-11-07"),
                "ATM Withdrawal - MAIN ST ATM SEATTLE, WA",
                -10300
            ),
            (
                d("2026-11-07"),
                "Zelle money received from SAM RIVERA",
                10000
            ),
            (d("2026-10-31"), "Monthly Interest Paid", 1),
        ]
    );
}

#[test]
fn common_names_for_the_amount_and_its_direction_are_recognized() {
    for (amount, kind, debit, credit) in [
        ("Amt", "Type", "Debit", "Credit"),
        ("Transaction Amount", "Credit/Debit", "DR", "CR"),
        ("Amount (USD)", "Debit/Credit Indicator", "D", "C"),
    ] {
        let csv = format!("Date,Description,{kind},{amount}\n01/05/2026,COFFEE,{debit},4.50\n01/06/2026,REFUND,{credit},2.00\n");
        let parsed = parse_csv(&csv).unwrap_or_else(|e| panic!("{amount}/{kind}: {e}"));
        assert_eq!(
            parsed
                .rows
                .iter()
                .map(|r| r.amount_cents)
                .collect::<Vec<_>>(),
            vec![-450, 200],
            "{amount}/{kind}"
        );
    }
}
