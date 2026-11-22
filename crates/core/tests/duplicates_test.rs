use slaybudget_core::db::open_in_memory;
use slaybudget_core::duplicates::{self, Confidence, Resolution};
use slaybudget_core::import::pipeline::{self, ImportReport};
use slaybudget_core::imports;
use slaybudget_core::profiles;
use slaybudget_core::tags;
use slaybudget_core::transactions::{self, TransactionFilter};

const HEAD: &str = "Transaction Date,Posted Date,Memo,Amount\n";

fn setup() -> (rusqlite::Connection, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    (conn, p)
}
fn csv(rows: &[(&str, &str, &str)]) -> String {
    let mut s = HEAD.to_string();
    for (d, memo, amt) in rows {
        s.push_str(&format!("{d},{d},{memo},{amt}\n"));
    }
    s
}
fn import(
    conn: &rusqlite::Connection,
    p: i64,
    path: &str,
    rows: &[(&str, &str, &str)],
) -> ImportReport {
    pipeline::import_csv(conn, p, path, &csv(rows)).unwrap()
}
fn find(conn: &rusqlite::Connection, desc: &str, cents: i64) -> transactions::Transaction {
    transactions::list(conn, &TransactionFilter::default())
        .unwrap()
        .into_iter()
        .find(|t| t.description == desc && t.amount_cents == cents)
        .unwrap_or_else(|| panic!("no {desc} {cents}"))
}
fn tag_id(conn: &rusqlite::Connection) -> Option<i64> {
    tags::list(conn)
        .unwrap()
        .into_iter()
        .find(|t| t.name == "Possible duplicate")
        .map(|t| t.id)
}

#[test]
fn the_same_charge_worded_differently_is_near_certain_tagged_and_marked_to_review() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "Statements/Visa/nov-csv.csv",
        &[("2026-11-12", "COSTCO WHSE 0123", "-142.18")],
    );
    let old = find(&conn, "COSTCO WHSE 0123", -14218);
    transactions::bulk_update(
        &conn,
        &[old.id],
        &transactions::TransactionPatch {
            reviewed: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let report = import(
        &conn,
        p,
        "Statements/Visa/nov-pdf.csv",
        &[
            ("2026-11-10", "UBER TRIP", "-12.00"),
            ("2026-11-12", "COSTCO WHSE #0123 SEATTLE WA", "-142.18"),
        ],
    );
    assert_eq!(report.flags.len(), 1, "{:?}", report.flags);
    let f = &report.flags[0];
    let new = find(&conn, "COSTCO WHSE #0123 SEATTLE WA", -14218);
    assert_eq!((f.tx_id, f.other_id), (Some(new.id), Some(old.id)));
    assert_eq!(f.confidence, Confidence::Certain);
    assert!(
        f.reason
            .starts_with("Same day and amount as COSTCO WHSE 0123 ($142.18, Visa, imported "),
        "{}",
        f.reason
    );
    assert!(f.reason.ends_with("worded differently."), "{}", f.reason);

    let tag = tag_id(&conn).expect("the tag is made on first use");
    let t = tags::list(&conn)
        .unwrap()
        .into_iter()
        .find(|t| t.id == tag)
        .unwrap();
    assert_eq!(t.color, "#ddb24a");
    assert_eq!(new.tag_ids, vec![tag]);
    assert!(!new.reviewed);
    assert_eq!(
        duplicates::for_transaction(&conn, new.id)
            .unwrap()
            .unwrap()
            .id,
        f.id
    );
    assert_eq!(
        duplicates::for_transaction(&conn, old.id)
            .unwrap()
            .unwrap()
            .id,
        f.id,
        "either row of the pair finds it"
    );
}

#[test]
fn a_tip_a_card_hold_and_a_moved_date_are_likely() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "Statements/Visa/mid.csv",
        &[
            ("2026-11-09", "SHELL OIL 57444", "-1.00"),
            ("2026-11-10", "NETFLIX.COM", "-54.22"),
            ("2026-11-17", "SHAKE SHACK 123", "-30.31"),
        ],
    );
    let report = import(
        &conn,
        p,
        "Statements/Visa/full.csv",
        &[
            ("2026-11-08", "TRADER JOES 55", "-20.00"),
            ("2026-11-11", "SHELL OIL 57444", "-48.27"),
            ("2026-11-14", "NETFLIX.COM", "-54.22"),
            ("2026-11-18", "SHAKE SHACK 123", "-36.31"),
        ],
    );
    let reason = |desc: &str, cents: i64| {
        let id = find(&conn, desc, cents).id;
        let f = report
            .flags
            .iter()
            .find(|f| f.tx_id == Some(id))
            .unwrap_or_else(|| panic!("{desc} not flagged: {:?}", report.flags));
        assert_eq!(f.confidence, Confidence::Likely);
        f.reason.clone()
    };
    assert_eq!(report.flags.len(), 3);
    assert_eq!(
        reason("SHAKE SHACK 123", -3631),
        "Same place a day apart as SHAKE SHACK 123 on Nov 17 ($30.31); the amount changed by $6.00 (a tip?)."
    );
    assert_eq!(
        reason("SHELL OIL 57444", -4827),
        "Same place 2 days apart as a $1.00 card hold at SHELL OIL 57444 on Nov 9; a hold is usually replaced by the final charge."
    );
    assert_eq!(
        reason("NETFLIX.COM", -5422),
        "Same place and amount ($54.22) as NETFLIX.COM on Nov 10, 4 days earlier; a pending charge that posted later?"
    );
}

#[test]
fn habits_and_repeats_are_not_flagged() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "Statements/Visa/a.csv",
        &[
            ("2026-11-01", "BLUE BOTTLE 9", "-7.02"),
            ("2026-11-03", "SHELL OIL 57444", "-40.00"),
            ("2026-11-08", "SHELL OIL 57444", "-45.00"),
        ],
    );
    // Last week's coffee and both fill-ups are repeated exactly: they're accounted for.
    let report = import(
        &conn,
        p,
        "Statements/Visa/b.csv",
        &[
            ("2026-11-01", "BLUE BOTTLE 9", "-7.02"),
            ("2026-11-03", "SHELL OIL 57444", "-40.00"),
            ("2026-11-08", "BLUE BOTTLE 9", "-7.02"),
            ("2026-11-08", "SHELL OIL 57444", "-45.00"),
            ("2026-11-12", "SHELL OIL 57444", "-42.00"),
        ],
    );
    assert_eq!(report.inserted, 2);
    assert!(report.flags.is_empty(), "{:?}", report.flags);

    // A file that starts after an earlier coffee can't repeat it, so that coffee isn't a candidate.
    let report = import(
        &conn,
        p,
        "Statements/Visa/c.csv",
        &[
            ("2026-11-14", "BLUE BOTTLE 9", "-7.02"),
            ("2026-11-15", "UBER TRIP", "-9.00"),
        ],
    );
    assert!(report.flags.is_empty(), "{:?}", report.flags);

    // Identical rows are skipped as before and never flagged.
    let report = import(
        &conn,
        p,
        "Statements/Visa/d.csv",
        &[
            ("2026-11-12", "SHELL OIL 57444", "-42.00"),
            ("2026-11-14", "BLUE BOTTLE 9", "-7.02"),
        ],
    );
    assert_eq!((report.inserted, report.duplicates), (0, 2));
    assert!(report.flags.is_empty());
    assert_eq!(tag_id(&conn), None, "no flag, no tag");
}

#[test]
fn different_accounts_are_never_compared() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "Statements/Visa/nov.csv",
        &[("2026-11-12", "COSTCO WHSE 0123", "-142.18")],
    );
    let report = import(
        &conn,
        p,
        "Statements/Debit/nov.csv",
        &[("2026-11-12", "COSTCO WHSE #0123 SEATTLE WA", "-142.18")],
    );
    assert!(report.flags.is_empty());
}

fn tip_pair(conn: &rusqlite::Connection, p: i64) -> (ImportReport, i64, i64) {
    import(
        conn,
        p,
        "Statements/Visa/mid.csv",
        &[
            ("2026-11-17", "SHAKE SHACK 123", "-30.31"),
            ("2026-11-17", "BLUE BOTTLE 9", "-5.00"),
        ],
    );
    let report = import(
        conn,
        p,
        "Statements/Visa/full.csv",
        &[
            ("2026-11-17", "BLUE BOTTLE 9 SF", "-5.00"),
            ("2026-11-18", "SHAKE SHACK 123", "-36.31"),
        ],
    );
    assert_eq!(report.flags.len(), 2, "{:?}", report.flags);
    let shack = report
        .flags
        .iter()
        .find(|f| f.tx_id == Some(find(conn, "SHAKE SHACK 123", -3631).id))
        .unwrap()
        .id;
    let coffee = report.flags.iter().find(|f| f.id != shack).unwrap().id;
    (report, shack, coffee)
}

#[test]
fn not_a_duplicate_clears_the_tag_for_good_even_after_reimporting() {
    let (conn, p) = setup();
    let (report, shack, _) = tip_pair(&conn, p);
    let tag = tag_id(&conn).unwrap();
    duplicates::resolve(&conn, shack, Resolution::Kept).unwrap();
    let new = find(&conn, "SHAKE SHACK 123", -3631);
    assert!(new.tag_ids.is_empty(), "the tag comes off");
    assert!(
        find(&conn, "BLUE BOTTLE 9 SF", -500).tag_ids.contains(&tag),
        "the other open flag keeps its tag"
    );
    assert_eq!(duplicates::for_transaction(&conn, new.id).unwrap(), None);

    // Undo and import the same file again: the dismissed pair isn't flagged again.
    imports::undo(&conn, report.import_id.unwrap()).unwrap();
    let again = import(
        &conn,
        p,
        "Statements/Visa/full.csv",
        &[
            ("2026-11-17", "BLUE BOTTLE 9 SF", "-5.00"),
            ("2026-11-18", "SHAKE SHACK 123", "-36.31"),
        ],
    );
    assert_eq!(
        again.flags.len(),
        1,
        "only the coffee comes back: {:?}",
        again.flags
    );
    assert!(again.flags[0].reason.contains("BLUE BOTTLE"));
}

#[test]
fn deleting_either_row_resolves_the_flag_and_tidies_the_tag() {
    let (conn, p) = setup();
    let (_, shack, coffee) = tip_pair(&conn, p);
    let old = find(&conn, "SHAKE SHACK 123", -3031).id;
    let new = find(&conn, "SHAKE SHACK 123", -3631).id;

    duplicates::resolve(&conn, shack, Resolution::OtherDeleted).unwrap();
    assert!(
        transactions::get(&conn, old).is_err(),
        "the other one is gone"
    );
    let kept = transactions::get(&conn, new).unwrap();
    assert!(kept.tag_ids.is_empty());
    let f = duplicates::get(&conn, shack).unwrap();
    assert_eq!(f.resolution, Some(Resolution::OtherDeleted));
    assert!(f.resolved_at.is_some());

    // Deleting the flagged row itself (from anywhere) resolves its flag as deleted.
    let coffee_tx = duplicates::get(&conn, coffee).unwrap().tx_id.unwrap();
    transactions::delete_many(&conn, &[coffee_tx]).unwrap();
    assert_eq!(
        duplicates::get(&conn, coffee).unwrap().resolution,
        Some(Resolution::Deleted)
    );
}

#[test]
fn delete_this_one_removes_the_flagged_row() {
    let (conn, p) = setup();
    let (_, shack, _) = tip_pair(&conn, p);
    let new = find(&conn, "SHAKE SHACK 123", -3631).id;
    duplicates::resolve(&conn, shack, Resolution::Deleted).unwrap();
    assert!(transactions::get(&conn, new).is_err());
    assert_eq!(
        duplicates::get(&conn, shack).unwrap().resolution,
        Some(Resolution::Deleted)
    );
    assert!(find(&conn, "SHAKE SHACK 123", -3031).tag_ids.is_empty());
}

#[test]
fn the_bell_gets_one_item_per_import_with_open_flags() {
    use slaybudget_core::notifications::{config::Config, producers, Kind};
    let (conn, p) = setup();
    let (report, shack, coffee) = tip_pair(&conn, p);
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 22).unwrap();
    let items = |conn: &rusqlite::Connection| {
        producers::candidates(conn, &Config::default(), today)
            .unwrap()
            .into_iter()
            .filter(|n| n.kind == Kind::PossibleDuplicates)
            .collect::<Vec<_>>()
    };
    let found = items(&conn);
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].key,
        format!("duplicates:{}", report.import_id.unwrap())
    );
    assert_eq!(found[0].title, "2 possible duplicates from full.csv");
    assert_eq!(
        found[0].body,
        "They look like transactions you already had, and are tagged Possible duplicate to review."
    );
    assert_eq!(
        found[0].target,
        serde_json::json!({ "kind": "transactions", "filter": "duplicates" })
    );
    assert_eq!(found[0].profile_id, Some(p));

    duplicates::resolve(&conn, shack, Resolution::Kept).unwrap();
    assert_eq!(items(&conn)[0].title, "1 possible duplicate from full.csv");
    duplicates::resolve(&conn, coffee, Resolution::Kept).unwrap();
    assert!(items(&conn).is_empty());
}
