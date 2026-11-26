//! Quicken and QuickBooks files: QIF, QFX and QBO (Web Connect, which is OFX), OFX 2 (XML), and their CSV exports.
//! Rows are made up; the layouts are the programs'. Money out is negative.

use chrono::NaiveDate;
use slaybudget_core::import::csv::parse_csv;
use slaybudget_core::import::ofx::{is_card, parse_ofx};

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}
fn coffee_and_paycheck() -> Vec<(NaiveDate, i64)> {
    vec![(d("2026-01-05"), -450), (d("2026-01-06"), 10000)]
}
fn ofx_rows(text: &str) -> Vec<(NaiveDate, i64)> {
    parse_ofx(text)
        .unwrap()
        .rows
        .iter()
        .map(|r| (r.posted_on, r.amount_cents))
        .collect()
}
fn csv_rows(text: &str) -> Vec<(NaiveDate, i64)> {
    parse_csv(text)
        .unwrap()
        .rows
        .iter()
        .map(|r| (r.posted_on, r.amount_cents))
        .collect()
}

const QIF_BANK: &str = "!Type:Bank\n\
D01/05/2026\nT-4.50\nPCOFFEE SHOP\nMlatte\nLDining\n^\n\
D1/ 6'26\nU100.00\nT100.00\nPPAYROLL DEPOSIT\nN1042\nLSalary\n^\n";

#[test]
fn a_quicken_qif_bank_file_is_read() {
    let parsed = parse_ofx(QIF_BANK).unwrap();
    let rows: Vec<_> = parsed
        .rows
        .iter()
        .map(|r| (r.posted_on, r.amount_cents))
        .collect();
    assert_eq!(rows, coffee_and_paycheck());
    assert_eq!(parsed.rows[0].description, "COFFEE SHOP");
    assert_eq!(parsed.rows[0].raw_category.as_deref(), Some("Dining"));
    assert!(parsed.rows[0]
        .details
        .contains(&("Memo".into(), "latte".into())));
    assert!(parsed.rows[1]
        .details
        .contains(&("Number".into(), "1042".into())));
    assert!(!is_card(QIF_BANK));
}

#[test]
fn a_qif_card_file_with_splits_transfers_and_an_account_block() {
    // A multi-account export: the account block comes first, then its transactions.
    let qif = "!Option:AutoSwitch\n!Account\nNVisa\nTCCard\n^\n!Clear:AutoSwitch\n!Type:CCard\n\
               D01/05/26\nT-4.50\nPCOFFEE SHOP\nLDining\nSDining\n$-3.00\nSGifts\n$-1.50\n^\n\
               D01/06/26\nT100.00\nPPAYMENT THANK YOU\nL[Checking]\n^\n\
               D01/07/26\nT0.00\nPZERO\n^\n";
    let parsed = parse_ofx(qif).unwrap();
    let rows: Vec<_> = parsed
        .rows
        .iter()
        .map(|r| (r.posted_on, r.amount_cents))
        .collect();
    assert_eq!(rows, coffee_and_paycheck());
    // A [bracketed] category is a transfer between accounts, not a category.
    assert_eq!(parsed.rows[1].raw_category, None);
    assert_eq!(parsed.skipped, 1);
    assert!(is_card(qif));
}

#[test]
fn qif_dates_from_older_quicken_and_day_first_files() {
    let qif = "!Type:Bank\nD1/ 5' 6\nT-4.50\nPA\n^\nD2006-01-06\nT1\nPB\n^\n";
    let rows = ofx_rows(qif);
    assert_eq!(rows[0].0, d("2006-01-05"));
    assert_eq!(rows[1].0, d("2006-01-06"));
    let uk = "!Type:Bank\nD05/01/2026\nT-4.50\nPA\n^\nD13/01/2026\nT1\nPB\n^\n";
    assert_eq!(ofx_rows(uk)[0].0, d("2026-01-05"));
}

#[test]
fn a_quickbooks_qbo_and_an_ofx_2_xml_file_are_read() {
    let qbo = "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>B1<FID>10898</FI><INTU.BID>10898</SONRS></SIGNONMSGSRSV1>\
               <BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKTRANLIST>\
               <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105120000[0:GMT]<TRNAMT>-4.50<FITID>1<NAME>COFFEE SHOP</STMTTRN>\
               <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260106<TRNAMT>100.00<FITID>2<NAME>PAYROLL</STMTTRN>\
               </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";
    assert_eq!(ofx_rows(qbo), coffee_and_paycheck());
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<?OFX OFXHEADER=\"200\" VERSION=\"220\"?>\n<OFX>\n<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD</CURDEF><BANKTRANLIST>\n\
               <STMTTRN>\n  <TRNTYPE>DEBIT</TRNTYPE>\n  <DTPOSTED>20260105000000.000[-5:EST]</DTPOSTED>\n  <TRNAMT>-4.50</TRNAMT>\n  <FITID>1</FITID>\n  <NAME>COFFEE SHOP</NAME>\n</STMTTRN>\n\
               <STMTTRN>\n  <TRNTYPE>CREDIT</TRNTYPE>\n  <DTPOSTED>20260106000000.000[-5:EST]</DTPOSTED>\n  <TRNAMT>100.00</TRNAMT>\n  <FITID>2</FITID>\n  <NAME>PAYMENT</NAME>\n</STMTTRN>\n\
               </BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>\n</OFX>\n";
    assert_eq!(ofx_rows(xml), coffee_and_paycheck());
    assert!(is_card(xml));
}

#[test]
fn quickbooks_csv_exports() {
    // The bank upload layouts QuickBooks Online accepts: 3 columns, or 4 with Credit and Debit.
    assert_eq!(
        csv_rows(
            "Date,Description,Amount\n01/05/2026,COFFEE SHOP,-4.50\n01/06/2026,PAYROLL,100.00\n"
        ),
        coffee_and_paycheck()
    );
    assert_eq!(
        csv_rows("Date,Description,Credit,Debit\n01/05/2026,COFFEE SHOP,,4.50\n01/06/2026,PAYROLL,100.00,\n"),
        coffee_and_paycheck()
    );
    // A Transaction Detail report: title lines, an account section, totals, and a blank first column.
    let report = "Sample Company LLC\nTransaction Detail by Account\nJanuary 2026\n\n\
                  ,Date,Transaction Type,Num,Name,Memo/Description,Split,Amount,Balance\n\
                  Checking,,,,,,,,\n\
                  ,01/05/2026,Expense,,Coffee Shop,latte,Meals,-4.50,995.50\n\
                  ,01/06/2026,Deposit,,Payroll,,Income,100.00,\"1,095.50\"\n\
                  Total for Checking,,,,,,,$95.50,\n";
    assert_eq!(csv_rows(report), coffee_and_paycheck());
}

#[test]
fn quicken_csv_exports() {
    // Quicken for Windows: a report title, the date range, then a header with blank leading columns.
    let windows = "Transaction Report\n\"1/1/2026 through 1/31/2026\"\n\n\
                   ,,Date,Account,Num,Description,Memo,Category,Tag,Clr,Amount\n\
                   ,,1/5/2026,Checking,,COFFEE SHOP,latte,Dining,,R,-4.50\n\
                   ,,1/6/2026,Checking,DEP,PAYROLL,,Salary,,R,100.00\n";
    assert_eq!(csv_rows(windows), coffee_and_paycheck());
    // Quicken for Mac: Payee instead of Description.
    let mac = "\"Date\",\"Payee\",\"Category\",\"Amount\",\"Account\"\n\
               \"01/05/2026\",\"Coffee Shop\",\"Dining\",\"-4.50\",\"Checking\"\n\
               \"01/06/2026\",\"Payroll\",\"Salary\",\"100.00\",\"Checking\"\n";
    assert_eq!(csv_rows(mac), coffee_and_paycheck());
}
