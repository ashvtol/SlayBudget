use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, InsertOutcome, NewTransaction, SplitPart, TransactionFilter,
};

fn setup() -> (rusqlite::Connection, i64, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    (conn, p, s)
}

fn add(conn: &rusqlite::Connection, p: i64, s: i64, cents: i64) -> i64 {
    let tx = NewTransaction {
        profile_id: p,
        source_id: s,
        posted_on: NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
        description: "COSTCO".into(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: None,
        import_id: None,
    };
    match transactions::insert(conn, &tx).unwrap() {
        InsertOutcome::Inserted(id) => id,
        _ => panic!(),
    }
}

fn cat(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::find_by_legacy_name(conn, name)
        .unwrap()
        .unwrap()
        .id
}

#[test]
fn split_creates_children_that_sum_to_the_parent_and_are_hidden() {
    let (conn, p, s) = setup();
    let id = add(&conn, p, s, -10000);
    let groceries = cat(&conn, "Groceries");
    let shopping = cat(&conn, "Shopping");
    let kids = transactions::split(
        &conn,
        id,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: Some(groceries),
                description: None,
            },
            SplitPart {
                amount_cents: -4000,
                category_id: Some(shopping),
                description: Some("Household".into()),
            },
        ],
    )
    .unwrap();
    assert_eq!(kids.len(), 2);
    // parent still in the main list, children hidden
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        1
    );
    assert!(transactions::get(&conn, id).unwrap().reviewed);
    let children = transactions::children(&conn, id).unwrap();
    assert_eq!(children.iter().map(|c| c.amount_cents).sum::<i64>(), -10000);
    assert_eq!(children[0].category_id, Some(groceries));
    assert_eq!(children[1].description, "Household");
}

#[test]
fn split_rejects_a_wrong_sum_or_too_few_parts() {
    let (conn, p, s) = setup();
    let id = add(&conn, p, s, -10000);
    assert!(transactions::split(
        &conn,
        id,
        &[SplitPart {
            amount_cents: -6000,
            category_id: None,
            description: None
        }]
    )
    .is_err());
    assert!(transactions::split(
        &conn,
        id,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: None,
                description: None
            },
            SplitPart {
                amount_cents: -3000,
                category_id: None,
                description: None
            },
        ]
    )
    .is_err());
}

#[test]
fn resplitting_replaces_the_previous_children_and_unsplit_clears_them() {
    let (conn, p, s) = setup();
    let id = add(&conn, p, s, -10000);
    transactions::split(
        &conn,
        id,
        &[
            SplitPart {
                amount_cents: -5000,
                category_id: None,
                description: None,
            },
            SplitPart {
                amount_cents: -5000,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    transactions::split(
        &conn,
        id,
        &[
            SplitPart {
                amount_cents: -7000,
                category_id: None,
                description: None,
            },
            SplitPart {
                amount_cents: -3000,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    assert_eq!(transactions::children(&conn, id).unwrap().len(), 2);
    assert_eq!(
        transactions::children(&conn, id).unwrap()[0].amount_cents,
        -7000
    );
    transactions::unsplit(&conn, id).unwrap();
    assert!(transactions::children(&conn, id).unwrap().is_empty());
}
