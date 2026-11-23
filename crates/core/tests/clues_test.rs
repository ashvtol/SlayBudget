use slaybudget_core::import::clues::{self, Clues};

const AMEX: &str =
    "Date,Description,Card Member,Account #,Amount\n11/03/2026,TRADER JOES,ASH,-21004,62.10\n";
const CHASE: &str = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/03/2026,11/04/2026,UBER TRIP,Travel,Sale,-12.00,\n";
const CHASE_REORDERED: &str = "Description,Transaction Date,Amount,Post Date,Type,Category,Memo\nUBER TRIP,11/03/2026,-12.00,11/04/2026,Sale,Travel,\n";
const WITH_PREAMBLE: &str = "Account Name: Rewards Visa\nAccount Number: XXXX XXXX XXXX 4417\n\nDate,Description,Amount\n2026-11-03,COFFEE,-4.50\n";

#[test]
fn an_amex_csv_gives_the_bank_the_last_4_and_its_layout() {
    let c = clues::from_csv("activity.csv", AMEX);
    assert_eq!(c.bank.as_deref(), Some("American Express"));
    assert_eq!(c.last4.as_deref(), Some("1004"));
    assert!(c.layout.as_deref().unwrap().starts_with("csv:"));
    assert_eq!(c.folder, None, "a bare file name has no folder");
}

#[test]
fn the_layout_ignores_column_order_and_case() {
    assert_eq!(
        clues::from_csv("a.csv", CHASE).layout,
        clues::from_csv("b.csv", CHASE_REORDERED).layout
    );
    assert_ne!(
        clues::from_csv("a.csv", CHASE).layout,
        clues::from_csv("a.csv", AMEX).layout
    );
}

#[test]
fn last_4_from_a_preamble_or_the_file_name() {
    assert_eq!(
        clues::from_csv("export.csv", WITH_PREAMBLE)
            .last4
            .as_deref(),
        Some("4417")
    );
    assert_eq!(
        clues::from_csv("Chase1004_Activity_20261101.CSV", CHASE)
            .last4
            .as_deref(),
        Some("1004")
    );
    // Years and dates in a file name are not account digits.
    assert_eq!(clues::from_csv("Amex-Gold-2026-11.csv", CHASE).last4, None);
    assert_eq!(clues::from_csv("activity_2026.csv", CHASE).last4, None);
}

#[test]
fn the_folder_counts_unless_it_is_a_generic_place() {
    assert_eq!(
        clues::from_csv("Statements/Amex Gold/nov.csv", CHASE)
            .folder
            .as_deref(),
        Some("Amex Gold")
    );
    assert_eq!(
        clues::from_csv("Downloads/activity.csv", CHASE).folder,
        None
    );
    assert_eq!(
        clues::from_csv("/Users/me/Desktop/activity.csv", CHASE).folder,
        None
    );
}

#[test]
fn a_pdf_gives_the_bank_and_the_account_ending() {
    let text = "Citi Costco Anywhere Visa Card\nMember Since 2019 Account number ending in: 7781\nBilling Period: 10/15/26-11/13/26\n";
    let c = clues::from_pdf("statement.pdf", text);
    assert_eq!(
        (c.bank.as_deref(), c.last4.as_deref()),
        (Some("Citi"), Some("7781"))
    );
    let chase = "JPMorgan Chase Bank\nAccount Number: xxxxxxxxxxxx3321\n";
    assert_eq!(
        clues::from_pdf("x.pdf", chase).last4.as_deref(),
        Some("3321")
    );
    assert_eq!(
        clues::from_pdf("x.pdf", chase).bank.as_deref(),
        Some("Chase")
    );
    assert_eq!(
        clues::from_pdf("x.pdf", "Some letter with no account\n"),
        Clues::default()
    );
}

#[test]
fn an_ofx_gives_the_account_id_and_the_bank() {
    let ofx = "<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>AMEX</ORG><FID>3101</FID></FI></SONRS></SIGNONMSGSRSV1><CCSTMTRS><CCACCTFROM><ACCTID>379999990061004</ACCTID></CCACCTFROM></CCSTMTRS></OFX>";
    let c = clues::from_ofx("a.qfx", ofx);
    assert_eq!(
        (c.bank.as_deref(), c.last4.as_deref()),
        (Some("American Express"), Some("1004"))
    );
    assert_eq!(c.layout.as_deref(), Some("ofx"));
}

#[test]
fn a_file_with_no_clues_has_only_its_layout() {
    let c = clues::from_csv(
        "export.csv",
        "Date,Description,Amount\n2026-11-03,COFFEE,-4.50\n",
    );
    assert_eq!((c.bank, c.last4, c.folder), (None, None, None));
    assert!(c.layout.is_some());
}

#[test]
fn the_sample_statements() {
    let fx = |f: &str| {
        std::fs::read_to_string(format!("{}/tests/fixtures/{f}", env!("CARGO_MANIFEST_DIR")))
            .unwrap()
    };
    for f in ["amex.csv", "citi-costco-2026.csv", "generic.csv"] {
        eprintln!("{f}: {:?}", clues::from_csv(f, &fx(f)));
    }
    eprintln!(
        "sample.qfx: {:?}",
        clues::from_ofx("sample.qfx", &fx("sample.qfx"))
    );
    assert_eq!(
        clues::from_csv("amex.csv", &fx("amex.csv")).bank.as_deref(),
        Some("American Express")
    );
}

#[test]
fn the_bank_can_come_from_the_file_name() {
    assert_eq!(
        clues::from_csv("Chase1004_Activity_20261101.CSV", CHASE)
            .bank
            .as_deref(),
        Some("Chase")
    );
    assert_eq!(
        clues::from_csv("capital-one-nov.csv", CHASE)
            .bank
            .as_deref(),
        Some("Capital One")
    );
    assert_eq!(clues::from_csv("activity.csv", CHASE).bank, None);
}
