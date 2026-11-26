//! Every bank layout SlayBudget should read with the generic CSV reader, from each bank's published export format.
//! Rows are made up; the headers, the amount style and the sign convention are the bank's. Money out is negative.

use chrono::NaiveDate;
use slaybudget_core::import::csv::parse_csv;

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

/// (date, cents) for each row the reader keeps.
fn read(name: &str, text: &str) -> Vec<(NaiveDate, i64)> {
    let parsed = parse_csv(text).unwrap_or_else(|e| panic!("{name}: {e}"));
    parsed
        .rows
        .iter()
        .map(|r| (r.posted_on, r.amount_cents))
        .collect()
}

/// A coffee for $4.50 on Jan 5 and money in of $100 on Jan 6, in every bank's layout.
fn expected() -> Vec<(NaiveDate, i64)> {
    vec![(d("2026-01-05"), -450), (d("2026-01-06"), 10000)]
}

#[test]
fn chase_credit_card() {
    let csv = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n\
               01/05/2026,01/06/2026,COFFEE SHOP,Food & Drink,Sale,-4.50,\n\
               01/06/2026,01/06/2026,Payment Thank You-Mobile,,Payment,100.00,\n";
    assert_eq!(read("Chase card", csv), expected());
}

#[test]
fn chase_checking() {
    let csv = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n\
               DEBIT,01/05/2026,\"COFFEE SHOP 123\",-4.50,DEBIT_CARD,995.50,,\n\
               CREDIT,01/06/2026,\"PAYROLL DEPOSIT\",100.00,ACH_CREDIT,1095.50,,\n";
    assert_eq!(read("Chase checking", csv), expected());
}

#[test]
fn bank_of_america_checking_with_its_summary_on_top() {
    let csv = "Description,,Summary Amt.\n\
               Beginning balance as of 01/01/2026,,\"1,000.00\"\n\
               Total credits,,\"100.00\"\n\
               Total debits,,\"-4.50\"\n\
               Ending balance as of 01/31/2026,,\"1,095.50\"\n\
               \n\
               Date,Description,Amount,Running Bal.\n\
               01/01/2026,Beginning balance as of 01/01/2026,,\"1,000.00\"\n\
               01/05/2026,\"COFFEE SHOP\",\"-4.50\",\"995.50\"\n\
               01/06/2026,\"PAYROLL DEPOSIT\",\"100.00\",\"1,095.50\"\n";
    assert_eq!(read("BofA checking", csv), expected());
}

#[test]
fn bank_of_america_credit_card() {
    let csv = "Posted Date,Reference Number,Payee,Address,Amount\n\
               01/05/2026,24692163,\"COFFEE SHOP\",\"SEATTLE WA \",-4.50\n\
               01/06/2026,24692164,\"PAYMENT - THANK YOU\",\"\",100.00\n";
    assert_eq!(read("BofA card", csv), expected());
}

#[test]
fn wells_fargo_with_no_header_row() {
    let csv = "\"01/05/2026\",\"-4.50\",\"*\",\"\",\"PURCHASE AUTHORIZED ON 01/04 COFFEE SHOP\"\n\
               \"01/06/2026\",\"100.00\",\"*\",\"\",\"PAYROLL DEPOSIT\"\n";
    assert_eq!(read("Wells Fargo", csv), expected());
}

#[test]
fn capital_one_credit_card() {
    let csv = "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n\
               2026-01-05,2026-01-06,1234,COFFEE SHOP,Dining,4.50,\n\
               2026-01-06,2026-01-06,1234,CAPITAL ONE AUTOPAY PYMT,Payment/Credit,,100.00\n";
    assert_eq!(read("Capital One card", csv), expected());
}

#[test]
fn capital_one_checking() {
    let csv = "Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n\
               1234,Debit Card Purchase - COFFEE SHOP,01/05/26,Debit,4.50,995.50\n\
               1234,Zelle money received from SAM RIVERA,01/06/26,Credit,100,1095.50\n";
    assert_eq!(read("Capital One checking", csv), expected());
}

#[test]
fn discover_lists_purchases_as_positive() {
    let csv = "Trans. Date,Post Date,Description,Amount,Category\n\
               01/05/2026,01/06/2026,COFFEE SHOP,4.50,Restaurants\n\
               01/06/2026,01/06/2026,INTERNET PAYMENT - THANK YOU,-100.00,Payments and Credits\n";
    assert_eq!(read("Discover", csv), expected());
}

#[test]
fn apple_card_lists_purchases_as_positive() {
    let csv = "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n\
               01/05/2026,01/06/2026,\"COFFEE SHOP 123 MAIN ST SEATTLE WA\",Coffee Shop,Restaurants,Purchase,4.50\n\
               01/06/2026,01/06/2026,\"ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234\",Payment,Payment,Payment,-100.00\n";
    assert_eq!(read("Apple Card", csv), expected());
}

#[test]
fn us_bank() {
    let csv = "\"Date\",\"Transaction\",\"Name\",\"Memo\",\"Amount\"\n\
               \"2026-01-05\",\"DEBIT\",\"COFFEE SHOP\",\"Download from usbank.com.\",\"-4.50\"\n\
               \"2026-01-06\",\"CREDIT\",\"PAYROLL DEPOSIT\",\"Download from usbank.com.\",\"100.00\"\n";
    assert_eq!(read("US Bank", csv), expected());
}

#[test]
fn ally_with_spaces_after_commas() {
    let csv = "Date, Time, Amount, Type, Description\n\
               2026-01-05, 08:15:00, -4.50, Withdrawal, COFFEE SHOP\n\
               2026-01-06, 09:00:00, 100.00, Deposit, PAYROLL DEPOSIT\n";
    assert_eq!(read("Ally", csv), expected());
}

#[test]
fn navy_federal_with_a_credit_debit_indicator() {
    let csv = "Posting Date,Transaction Date,Amount,Credit Debit Indicator,type,Type Group,Reference,Instructed Currency,Currency Exchange Rate,Instructed Amount,Description,Category,Check Serial Number,Card Ending\n\
               01/05/2026,01/05/2026,4.50,Debit,Debit Card,Card,123,USD,,,COFFEE SHOP,Dining,,1234\n\
               01/06/2026,01/06/2026,100.00,Credit,Deposit,Deposit,124,USD,,,PAYROLL DEPOSIT,Income,,\n";
    assert_eq!(read("Navy Federal", csv), expected());
}

#[test]
fn schwab_with_withdrawal_and_deposit_columns() {
    let csv = "\"Date\",\"Status\",\"Type\",\"CheckNumber\",\"Description\",\"Withdrawal\",\"Deposit\",\"RunningBalance\"\n\
               \"01/05/2026\",\"Posted\",\"VISA\",\"\",\"COFFEE SHOP\",\"$4.50\",\"\",\"$995.50\"\n\
               \"01/06/2026\",\"Posted\",\"ACH\",\"\",\"PAYROLL DEPOSIT\",\"\",\"$100.00\",\"$1,095.50\"\n";
    assert_eq!(read("Schwab", csv), expected());
}

#[test]
fn pnc_with_withdrawals_and_deposits() {
    let csv = "Date,Description,Withdrawals,Deposits,Balance\n\
               01/05/2026,COFFEE SHOP,$4.50,,$995.50\n\
               01/06/2026,PAYROLL DEPOSIT,,$100.00,\"$1,095.50\"\n";
    assert_eq!(read("PNC", csv), expected());
}

#[test]
fn td_bank() {
    let csv = "Date,Bank RTN,Account Number,Transaction Type,Description,Debit,Credit,Check Number,Balance\n\
               01/05/2026,011103093,1234,DEBIT,COFFEE SHOP,4.50,,,995.50\n\
               01/06/2026,011103093,1234,CREDIT,PAYROLL DEPOSIT,,100.00,,1095.50\n";
    assert_eq!(read("TD Bank", csv), expected());
}

#[test]
fn sofi_usaa_and_chime() {
    for (name, csv) in [
        ("SoFi", "Date,Description,Type,Amount,Current balance,Status\n2026-01-05,COFFEE SHOP,Debit Card,-4.50,995.50,Posted\n2026-01-06,PAYROLL DEPOSIT,Direct Deposit,100.00,1095.50,Posted\n"),
        ("USAA", "Date,Description,Original Description,Category,Amount,Status\n2026-01-05,Coffee Shop,COFFEE SHOP 123,Restaurants,-4.50,Posted\n2026-01-06,Payroll,PAYROLL DEPOSIT,Paycheck,100.00,Posted\n"),
        ("Chime", "Transaction Date,Description,Type,Amount,Net Amount,Settlement Date\n01/05/2026,COFFEE SHOP,Purchase,-4.50,-4.50,01/05/2026\n01/06/2026,PAYROLL DEPOSIT,Direct Deposit,100.00,100.00,01/06/2026\n"),
    ] {
        assert_eq!(read(name, csv), expected(), "{name}");
    }
}

#[test]
fn venmo_with_title_rows_and_signed_dollar_amounts() {
    let csv = "Account Statement - (@sam-rivera) ,,,,,,,,,,,,,,,,,,,,\n\
               Account Activity,,,,,,,,,,,,,,,,,,,,\n\
               ,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer\n\
               ,,,,,,,,,,,,,,,,$0.00,,,,,\n\
               ,4001,2026-01-05T18:20:11,Payment,Complete,coffee,Sam Rivera,Jordan Lee,- $4.50,,,,0,,Venmo balance,,,,,Venmo,,\n\
               ,4002,2026-01-06T09:00:00,Payment,Complete,rent share,Jordan Lee,Sam Rivera,+ $100.00,,,,0,,,Venmo balance,,,,Venmo,,\n";
    assert_eq!(read("Venmo", csv), expected());
}

#[test]
fn paypal_counts_the_net_amount() {
    let csv = "\"Date\",\"Time\",\"TimeZone\",\"Name\",\"Type\",\"Status\",\"Currency\",\"Gross\",\"Fee\",\"Net\",\"From Email Address\",\"To Email Address\",\"Transaction ID\"\n\
               \"01/05/2026\",\"08:15:00\",\"PST\",\"Coffee Shop\",\"Express Checkout Payment\",\"Completed\",\"USD\",\"-4.50\",\"0.00\",\"-4.50\",\"\",\"\",\"1AB\"\n\
               \"01/06/2026\",\"09:00:00\",\"PST\",\"Sam Rivera\",\"General Payment\",\"Completed\",\"USD\",\"103.20\",\"-3.20\",\"100.00\",\"\",\"\",\"2CD\"\n";
    assert_eq!(read("PayPal", csv), expected());
}

#[test]
fn revolut_with_date_and_time() {
    let csv = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n\
               CARD_PAYMENT,Current,2026-01-05 08:15:00,2026-01-05 09:00:00,Coffee Shop,-4.50,0.00,USD,COMPLETED,995.50\n\
               TOPUP,Current,2026-01-06 09:00:00,2026-01-06 09:01:00,Top-Up by *1234,100.00,0.00,USD,COMPLETED,1095.50\n";
    assert_eq!(read("Revolut", csv), expected());
}

#[test]
fn day_first_dates_from_uk_and_european_banks() {
    // Monzo and Wise write day/month/year; a day above 12 in the file gives it away.
    let monzo = "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency\n\
                 tx_1,05/01/2026,08:15:00,Card payment,Coffee Shop,,Eating out,-4.50,GBP\n\
                 tx_2,06/01/2026,09:00:00,Faster payment,Sam Rivera,,Income,100.00,GBP\n\
                 tx_3,13/01/2026,09:00:00,Card payment,Bakery,,Eating out,-2.00,GBP\n";
    let rows = read("Monzo", monzo);
    assert_eq!(rows[..2], expected()[..]);
    assert_eq!(rows[2], (d("2026-01-13"), -200));
    let wise = "\"TransferWise ID\",Date,Amount,Currency,Description,\"Payment Reference\",\"Running Balance\"\n\
                TRANSFER-1,05-01-2026,-4.50,EUR,\"Card transaction of 4.50 EUR issued by Coffee Shop\",,995.50\n\
                TRANSFER-2,06-01-2026,100.00,EUR,\"Received money from Sam Rivera\",,1095.50\n\
                TRANSFER-3,20-01-2026,-1.00,EUR,\"Card transaction\",,1094.50\n";
    let rows = read("Wise", wise);
    assert_eq!(rows[..2], expected()[..]);
}
