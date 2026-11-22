use chrono::NaiveDate;
use slaybudget_core::import::pdf::{parse_pdf, PdfItem, PdfLine, PdfStatementKind, PdfText};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn line(y: i32, items: &[(i32, &str)]) -> PdfLine {
    PdfLine {
        y,
        items: items
            .iter()
            .map(|(x, s)| PdfItem {
                x: *x,
                text: s.to_string(),
            })
            .collect(),
    }
}

fn plain(lines: &[&str]) -> Vec<PdfLine> {
    lines
        .iter()
        .enumerate()
        .map(|(i, l)| line(1000 - i as i32 * 10, &[(0, l)]))
        .collect()
}

fn doc(lines: Vec<PdfLine>, filename: &str) -> PdfText {
    PdfText {
        lines,
        filename: filename.to_string(),
        today: d("2026-11-16"),
    }
}

#[test]
fn citi_card_statement_parses_sections_and_signs() {
    let text = plain(&[
        "Citi Costco Anywhere Visa",
        "Billing Period: 12/10/2025-01/09/2026",
        "Payments, Credits and Adjustments",
        "12/15 12/15 AUTOPAY PAYMENT - THANK YOU -$640.55",
        "12/20 12/21 COSTCO WHSE #0123 SEATTLE WA -$15.99",
        "Standard Purchases",
        "Sale Post",
        "Date Date Description Amount",
        "12/30 12/31 COSTCO GAS #0123 SEATTLE WA $52.10",
        "01/02 01/03 TRADER JOE'S #130 SEATTLE WA",
        "$41.77",
        "Page 2 of 4",
        "Fees Charged",
        "TOTAL FEES FOR THIS PERIOD $0.00",
        "01/05 01/05 LATE FEE $29.00",
    ]);
    let parsed = parse_pdf(&doc(text, "January 09.pdf")).unwrap();
    assert_eq!(parsed.kind, PdfStatementKind::CitiCard);
    assert_eq!(
        parsed.billing_period.as_deref(),
        Some("12/10/2025 - 01/09/2026")
    );
    let rows = &parsed.rows;
    assert_eq!(rows.len(), 5, "{rows:#?}");
    assert_eq!(
        (rows[0].posted_on, rows[0].amount_cents),
        (d("2025-12-15"), 64_055)
    );
    assert_eq!(rows[0].description, "AUTOPAY PAYMENT - THANK YOU");
    assert_eq!(
        (rows[1].posted_on, rows[1].amount_cents),
        (d("2025-12-21"), 1599)
    );
    assert_eq!(
        (rows[2].posted_on, rows[2].amount_cents),
        (d("2025-12-31"), -5210)
    );
    assert_eq!(
        (rows[3].posted_on, rows[3].amount_cents),
        (d("2026-01-03"), -4177),
        "amount on the next line"
    );
    assert_eq!(rows[3].description, "TRADER JOE'S #130 SEATTLE WA");
    assert_eq!(
        (rows[4].posted_on, rows[4].amount_cents),
        (d("2026-01-05"), -2900)
    );
}

#[test]
fn citi_card_year_falls_back_to_filename_and_never_lands_in_the_future() {
    let text = plain(&[
        "Citi",
        "Standard Purchases",
        "03/05 03/06 SOMETHING $10.00",
        "12/01 12/02 OLD THING $5.00",
    ]);
    let parsed = parse_pdf(&doc(text, "March 09, 26.pdf")).unwrap();
    assert_eq!(parsed.rows[0].posted_on, d("2026-03-06"));
    assert_eq!(
        parsed.rows[1].posted_on,
        d("2025-12-02"),
        "December would be in the future, so the previous year"
    );
}

#[test]
fn citi_checking_statement_uses_column_positions() {
    let lines = vec![
        line(900, &[(40, "Citibank Checking")]),
        line(890, &[(40, "Statement Period Dec 10 - Jan 9, 2026")]),
        line(880, &[(40, "Checking Activity")]),
        line(
            870,
            &[
                (40, "Date"),
                (120, "Description"),
                (380, "Amount Subtracted"),
                (470, "Amount Added"),
                (560, "Balance"),
            ],
        ),
        line(
            860,
            &[
                (40, "12/12"),
                (120, "ACH Electronic Credit"),
                (470, "3,250.00"),
                (560, "5,250.00"),
            ],
        ),
        line(850, &[(120, "ACME PAYROLL")]),
        line(
            840,
            &[
                (40, "12/15"),
                (120, "Debit Card Purchase 12/14 04:55p #1234 COSTCO WHSE"),
                (380, "120.34"),
                (560, "5,129.66"),
            ],
        ),
        line(
            830,
            &[
                (40, "01/02"),
                (120, "Transfer to Bankcard AMERICAN EXPRESS"),
                (380, "1,250.00"),
                (560, "3,879.66"),
            ],
        ),
        line(
            820,
            &[
                (40, "01/03"),
                (120, "Monthly Service Fee"),
                (380, "0.00"),
                (560, "3,879.66"),
            ],
        ),
        line(810, &[(40, "Savings Activity")]),
        line(
            800,
            &[
                (40, "01/04"),
                (120, "Interest"),
                (470, "1.10"),
                (560, "10.00"),
            ],
        ),
    ];
    let parsed = parse_pdf(&doc(lines, "January 09.pdf")).unwrap();
    assert_eq!(parsed.kind, PdfStatementKind::CitiChecking);
    let rows = &parsed.rows;
    assert_eq!(rows.len(), 3, "{rows:#?}");
    assert_eq!(
        (rows[0].posted_on, rows[0].amount_cents),
        (d("2025-12-12"), 325_000)
    );
    assert_eq!(rows[0].description, "ACH Electronic Credit ACME PAYROLL");
    assert_eq!(
        (rows[1].posted_on, rows[1].amount_cents),
        (d("2025-12-15"), -12034)
    );
    assert_eq!(
        (rows[2].posted_on, rows[2].amount_cents),
        (d("2026-01-02"), -125_000)
    );
    assert_eq!(rows[2].description, "Transfer to Bankcard AMERICAN EXPRESS");
}

#[test]
fn unknown_statement_is_an_error() {
    let text = plain(&["Some Other Bank", "Nothing here"]);
    let err = parse_pdf(&doc(text, "x.pdf")).unwrap_err();
    assert!(err.to_string().contains("unrecognized"));
}
