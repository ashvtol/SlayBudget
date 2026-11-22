use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::csv::parse_csv;
use slaybudget_core::import::pipeline;
use slaybudget_core::profiles;
use slaybudget_core::transactions::{self, TransactionFilter};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn pairs(v: &[(String, String)]) -> Vec<(&str, &str)> {
    v.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect()
}

#[test]
fn csv_keeps_extra_columns_as_details() {
    let amex = parse_csv(&fixture("amex.csv")).unwrap();
    let uber = pairs(&amex.rows[0].details);
    // Sentence-case labels, quotes stripped, the line itself and empties left out.
    assert!(uber.contains(&(
        "Extended details",
        "4P9S3RTV   E7FEOZTS         98121\nUBER\nhelp.uber.com"
    )));
    assert!(uber.contains(&("Address", "1455 MARKET ST")));
    assert!(uber.contains(&("City/state", "SAN FRANCISCO CA")));
    assert!(uber.contains(&("Reference", "320261790000000001")));
    assert!(uber.contains(&("Category", "Transportation-Taxis & Coach")));
    assert!(
        !uber
            .iter()
            .any(|(k, _)| *k == "Appears on your statement as"),
        "same as the line itself"
    );
    assert!(!uber
        .iter()
        .any(|(k, _)| *k == "Date" || *k == "Amount" || *k == "Description"));

    let citi = parse_csv(&fixture("citi-costco-2026.csv")).unwrap();
    let first = pairs(&citi.rows[0].details);
    assert!(first.iter().any(|(k, _)| *k == "Status"));
    assert!(!first.iter().any(|(k, _)| *k == "Debit" || *k == "Credit"));
}

#[test]
fn import_stores_details_and_statement_says_where_from() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    let uber = transactions::list(&conn, &TransactionFilter::for_profile(p))
        .unwrap()
        .into_iter()
        .find(|t| t.description == "UBER")
        .unwrap();
    let info = transactions::statement(&conn, uber.id).unwrap();
    assert_eq!(info.file_name.as_deref(), Some("YTD-2026.csv"));
    assert_eq!(info.source_name, "Amex");
    assert!(info.imported_at.is_some());
    assert!(pairs(&info.fields).contains(&("Address", "1455 MARKET ST")));
}

#[test]
fn a_later_file_fills_details_on_rows_that_have_none() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let basic = "Date,Description,Amount\n06/27/2026,UBER,3.31\n";
    pipeline::import_csv(&conn, p, "Statements/Alex/Amex/basic.csv", basic).unwrap();
    let id = transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap()[0].id;
    assert!(transactions::statement(&conn, id)
        .unwrap()
        .fields
        .is_empty());

    let report = pipeline::import_csv(
        &conn,
        p,
        "Statements/Alex/Amex/YTD-2026.csv",
        &fixture("amex.csv"),
    )
    .unwrap();
    assert_eq!(
        report.duplicates, 1,
        "the basic row is the same transaction"
    );
    let info = transactions::statement(&conn, id).unwrap();
    assert!(pairs(&info.fields).contains(&("Address", "1455 MARKET ST")));
    // The row keeps its original import and everything else.
    assert_eq!(info.file_name.as_deref(), Some("basic.csv"));
    assert_eq!(transactions::get(&conn, id).unwrap().amount_cents, -331);
}

#[test]
fn details_already_there_are_not_replaced() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let one = "Date,Description,Amount,Address\n06/27/2026,UBER,3.31,FIRST ST\n";
    let two = "Date,Description,Amount,Address\n06/27/2026,UBER,3.31,SECOND ST\n";
    pipeline::import_csv(&conn, p, "Statements/Alex/Amex/one.csv", one).unwrap();
    pipeline::import_csv(&conn, p, "Statements/Alex/Amex/two.csv", two).unwrap();
    let id = transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap()[0].id;
    assert_eq!(
        pairs(&transactions::statement(&conn, id).unwrap().fields),
        vec![("Address", "FIRST ST")]
    );
}

#[test]
fn importing_the_same_file_again_fills_details_it_could_not_keep_before() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let path = "Statements/Alex/Amex/YTD-2026.csv";
    pipeline::import_csv(&conn, p, path, &fixture("amex.csv")).unwrap();
    // As if an older version had imported the file without keeping its extra columns.
    conn.execute("UPDATE transactions SET details = NULL", [])
        .unwrap();
    let again = pipeline::import_csv(&conn, p, path, &fixture("amex.csv")).unwrap();
    assert!(again.already_imported);
    assert_eq!(again.inserted, 0);
    let uber = transactions::list(&conn, &TransactionFilter::for_profile(p))
        .unwrap()
        .into_iter()
        .find(|t| t.description == "UBER")
        .unwrap();
    assert!(
        pairs(&transactions::statement(&conn, uber.id).unwrap().fields)
            .contains(&("Address", "1455 MARKET ST"))
    );
}
