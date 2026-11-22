use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::categorize::learning;
use slaybudget_core::db::{backup_to, open_db, open_in_memory};
use slaybudget_core::import::ft_model::{self, FtChoice, FtTarget};
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, TransactionPatch};

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_by_legacy_name(conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

fn add(conn: &rusqlite::Connection, day: u32, description: &str, category: Option<i64>) -> i64 {
    let p = profiles::list(conn).unwrap()[0].id;
    let s = profiles::find_or_create_source(conn, p, "Amex", SourceKind::Csv).unwrap();
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: NaiveDate::from_ymd_opt(2026, 5, day).unwrap(),
        description: description.into(),
        amount_cents: -1000,
        currency: "USD".into(),
        occurrence: 0,
        category_id: category,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!("duplicate"),
    }
}

const MODEL: &str = r#"{
  "version": "3",
  "timestamp": "2026-06-28T00:00:00.000Z",
  "learningModel": {
    "din tai": "Food & Dining",
    "heytea us": "Coffee Shop",
    "the knot": "Wedding",
    "venmo": "Transfer",
    "geico auto": "Insurance"
  },
  "customCategories": ["Wedding", "Coffee Shop"]
}"#;

fn proposal<'a>(p: &'a [ft_model::FtProposal], merchant: &str) -> &'a ft_model::FtProposal {
    p.iter().find(|x| x.merchant == merchant).unwrap()
}

#[test]
fn preview_maps_ft_categories_by_legacy_name() {
    let conn = open_in_memory().unwrap();
    let p = ft_model::preview(&conn, MODEL).unwrap();
    assert_eq!(
        proposal(&p, "din tai").target,
        FtTarget::Existing(cat(&conn, "Food & Dining"))
    );
    assert_eq!(proposal(&p, "din tai").ft_category, "Food & Dining");
}

#[test]
fn unknown_ft_category_reuses_normalized_match() {
    let conn = open_in_memory().unwrap();
    let coffee = categories::find_or_create_by_legacy_name(&conn, "Coffee").unwrap();
    let p = ft_model::preview(&conn, MODEL).unwrap();
    assert_eq!(proposal(&p, "heytea us").target, FtTarget::Existing(coffee));
}

#[test]
fn unknown_ft_category_proposes_new() {
    let conn = open_in_memory().unwrap();
    let p = ft_model::preview(&conn, MODEL).unwrap();
    assert_eq!(
        proposal(&p, "the knot").target,
        FtTarget::New("Wedding".into())
    );
}

#[test]
fn preview_counts_only_unlocked_other_rows() {
    let conn = open_in_memory().unwrap();
    let other = cat(&conn, "Other");
    let insurance = cat(&conn, "Insurance");
    add(&conn, 1, "GEICO AUTO 1", Some(other));
    add(&conn, 2, "GEICO AUTO 2", None);
    add(&conn, 3, "GEICO AUTO 3", Some(insurance));
    let locked = add(&conn, 4, "GEICO AUTO 4", Some(other));
    transactions::update(
        &conn,
        locked,
        &TransactionPatch {
            category_locked: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let p = ft_model::preview(&conn, MODEL).unwrap();
    assert_eq!(proposal(&p, "geico auto").moves, 2);
    assert_eq!(proposal(&p, "din tai").moves, 0);
}

#[test]
fn preview_skips_payment_platforms() {
    let conn = open_in_memory().unwrap();
    let p = ft_model::preview(&conn, MODEL).unwrap();
    assert!(p.iter().all(|x| x.merchant != "venmo"));
    assert_eq!(p.len(), 4);
}

#[test]
fn apply_learns_moves_and_creates() {
    let conn = open_in_memory().unwrap();
    let other = cat(&conn, "Other");
    let a = add(&conn, 1, "GEICO AUTO 1", Some(other));
    let b = add(&conn, 2, "THE KNOT 99", Some(other));
    let report = ft_model::apply(
        &conn,
        &[
            FtChoice {
                merchant: "geico auto".into(),
                target: FtTarget::Existing(cat(&conn, "Insurance")),
            },
            FtChoice {
                merchant: "the knot".into(),
                target: FtTarget::New("Wedding".into()),
            },
        ],
    )
    .unwrap();
    assert_eq!((report.learned, report.moved, report.created), (2, 2, 1));
    assert_eq!(
        transactions::get(&conn, a).unwrap().category_id,
        Some(cat(&conn, "Insurance"))
    );
    let wedding = cat(&conn, "Wedding");
    assert_eq!(
        transactions::get(&conn, b).unwrap().category_id,
        Some(wedding)
    );
    assert!(transactions::get(&conn, b).unwrap().reviewed);
    assert_eq!(learning::list(&conn).unwrap().len(), 2);
}

#[test]
fn apply_leaves_filed_and_locked_rows() {
    let conn = open_in_memory().unwrap();
    let other = cat(&conn, "Other");
    let travel = cat(&conn, "Travel");
    let filed = add(&conn, 1, "GEICO AUTO 1", Some(travel));
    let locked = add(&conn, 2, "GEICO AUTO 2", Some(other));
    transactions::update(
        &conn,
        locked,
        &TransactionPatch {
            category_locked: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let r = ft_model::apply(
        &conn,
        &[FtChoice {
            merchant: "geico auto".into(),
            target: FtTarget::Existing(cat(&conn, "Insurance")),
        }],
    )
    .unwrap();
    assert_eq!(r.moved, 0);
    assert_eq!(
        transactions::get(&conn, filed).unwrap().category_id,
        Some(travel)
    );
    assert_eq!(
        transactions::get(&conn, locked).unwrap().category_id,
        Some(other)
    );
}

#[test]
fn backup_to_writes_a_copy() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_db(&dir.path().join("live.db")).unwrap();
    add(&conn, 1, "GEICO AUTO 1", None);
    let copy = dir.path().join("copy.db");
    backup_to(&conn, &copy).unwrap();
    let back = open_db(&copy).unwrap();
    assert_eq!(transactions::count(&back, &Default::default()).unwrap(), 1);
}

#[test]
fn apply_does_not_duplicate_new_names() {
    let conn = open_in_memory().unwrap();
    let r = ft_model::apply(
        &conn,
        &[
            FtChoice {
                merchant: "the knot".into(),
                target: FtTarget::New("Wedding - Venue".into()),
            },
            FtChoice {
                merchant: "party city".into(),
                target: FtTarget::New("Party - Venue".into()),
            },
            FtChoice {
                merchant: "foo bar".into(),
                target: FtTarget::New("Groceries".into()),
            },
        ],
    )
    .unwrap();
    let venues = categories::list(&conn)
        .unwrap()
        .into_iter()
        .filter(|c| c.name == "Venue")
        .count();
    assert_eq!(venues, 1);
    assert_eq!(
        categories::list(&conn)
            .unwrap()
            .into_iter()
            .filter(|c| c.name == "Groceries")
            .count(),
        1
    );
    assert_eq!(r.created, 1);
}
