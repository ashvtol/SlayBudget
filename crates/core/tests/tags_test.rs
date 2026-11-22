use chrono::NaiveDate;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::tags::{self, TagPatch, NEW_TAG_ORDER, PALETTE};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, TransactionFilter};
use slaybudget_core::CoreError;

struct Db {
    conn: rusqlite::Connection,
    p: i64,
    s: i64,
}

fn setup() -> Db {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    Db { conn, p, s }
}

impl Db {
    fn add(&self, day: u32, description: &str, cents: i64) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: NaiveDate::from_ymd_opt(2026, 5, day).unwrap(),
            description: description.into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: None,
            import_id: None,
        };
        match transactions::insert(&self.conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }
    fn tag_ids(&self, id: i64) -> Vec<i64> {
        transactions::get(&self.conn, id).unwrap().tag_ids
    }
}

#[test]
fn create_trims_and_rotates_colors() {
    let db = setup();
    let a = tags::create(&db.conn, "  Vacation 2026 ", None).unwrap();
    let b = tags::create(&db.conn, "Work", None).unwrap();
    let c = tags::create(&db.conn, "Gift", Some("#123456")).unwrap();
    let all = tags::list(&db.conn).unwrap();
    assert_eq!(
        all.iter()
            .map(|t| (t.id, t.name.as_str()))
            .collect::<Vec<_>>(),
        vec![(a, "Vacation 2026"), (b, "Work"), (c, "Gift")]
    );
    // New tags take spread-out colors (red, then green), not palette neighbours.
    assert_eq!(all[0].color, PALETTE[NEW_TAG_ORDER[0]]);
    assert_eq!(all[1].color, PALETTE[NEW_TAG_ORDER[1]]);
    assert_eq!(all[1].color, "#5cb85c");
    assert_eq!(all[2].color, "#123456");
    assert_eq!(all[0].count, 0);
}

#[test]
fn create_rejects_empty_long_and_duplicate_names() {
    let db = setup();
    tags::create(&db.conn, "Work", None).unwrap();
    assert!(matches!(
        tags::create(&db.conn, "  ", None),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        tags::create(&db.conn, &"x".repeat(41), None),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        tags::create(&db.conn, " work ", None),
        Err(CoreError::Invalid(_))
    ));
}

#[test]
fn update_renames_and_recolors_but_not_onto_another_name() {
    let db = setup();
    let a = tags::create(&db.conn, "Work", None).unwrap();
    tags::create(&db.conn, "Trip", None).unwrap();
    tags::update(
        &db.conn,
        a,
        &TagPatch {
            name: Some("Office".into()),
            color: Some("#00ff00".into()),
        },
    )
    .unwrap();
    let t = &tags::list(&db.conn).unwrap()[0];
    assert_eq!((t.name.as_str(), t.color.as_str()), ("Office", "#00ff00"));
    // Changing only the case of its own name is fine.
    tags::update(
        &db.conn,
        a,
        &TagPatch {
            name: Some("OFFICE".into()),
            color: None,
        },
    )
    .unwrap();
    assert!(matches!(
        tags::update(
            &db.conn,
            a,
            &TagPatch {
                name: Some("trip".into()),
                color: None
            }
        ),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        tags::update(
            &db.conn,
            999,
            &TagPatch {
                name: Some("Nope".into()),
                color: None
            }
        ),
        Err(CoreError::NotFound(_))
    ));
}

#[test]
fn add_and_remove_are_idempotent_and_show_on_rows() {
    let db = setup();
    let t1 = db.add(1, "UBER", -1000);
    let t2 = db.add(2, "HOTEL", -20000);
    let work = tags::create(&db.conn, "Work", None).unwrap();
    let trip = tags::create(&db.conn, "Trip", None).unwrap();
    assert_eq!(tags::add(&db.conn, &[t1, t2], &[trip, work]).unwrap(), 4);
    assert_eq!(tags::add(&db.conn, &[t1], &[work]).unwrap(), 0);
    assert_eq!(db.tag_ids(t1), vec![work, trip]);
    assert_eq!(tags::remove(&db.conn, &[t1], &[work]).unwrap(), 1);
    assert_eq!(tags::remove(&db.conn, &[t1], &[work]).unwrap(), 0);
    assert_eq!(db.tag_ids(t1), vec![trip]);
    let listed = transactions::list(&db.conn, &TransactionFilter::combined()).unwrap();
    let row2 = listed.iter().find(|t| t.id == t2).unwrap();
    assert_eq!(row2.tag_ids, vec![work, trip]);
    let counts: Vec<(String, i64)> = tags::list(&db.conn)
        .unwrap()
        .into_iter()
        .map(|t| (t.name, t.count))
        .collect();
    assert_eq!(counts, vec![("Work".into(), 1), ("Trip".into(), 2)]);
}

#[test]
fn tagging_changes_nothing_else() {
    let db = setup();
    let t1 = db.add(1, "UBER", -1000);
    let before = transactions::get(&db.conn, t1).unwrap();
    let work = tags::create(&db.conn, "Work", None).unwrap();
    tags::add(&db.conn, &[t1], &[work]).unwrap();
    let after = transactions::get(&db.conn, t1).unwrap();
    assert_eq!(
        (after.reviewed, after.category_id, after.tx_type),
        (before.reviewed, before.category_id, before.tx_type)
    );
}

#[test]
fn delete_removes_the_tag_from_rows_only() {
    let db = setup();
    let t1 = db.add(1, "UBER", -1000);
    let work = tags::create(&db.conn, "Work", None).unwrap();
    tags::add(&db.conn, &[t1], &[work]).unwrap();
    tags::delete(&db.conn, work).unwrap();
    assert!(tags::list(&db.conn).unwrap().is_empty());
    assert_eq!(db.tag_ids(t1), Vec::<i64>::new());
    assert_eq!(transactions::get(&db.conn, t1).unwrap().description, "UBER");
}

#[test]
fn filter_matches_any_tag_and_combines_with_other_filters() {
    let db = setup();
    let t1 = db.add(1, "UBER", -1000);
    let t2 = db.add(2, "HOTEL", -20000);
    let t3 = db.add(3, "COFFEE", -500);
    let work = tags::create(&db.conn, "Work", None).unwrap();
    let trip = tags::create(&db.conn, "Trip", None).unwrap();
    tags::add(&db.conn, &[t1], &[work]).unwrap();
    tags::add(&db.conn, &[t2], &[trip]).unwrap();
    let ids = |f: TransactionFilter| -> Vec<i64> {
        transactions::list(&db.conn, &f)
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect()
    };
    let mut f = TransactionFilter::combined();
    f.tag_ids = vec![work, trip];
    assert_eq!(ids(f.clone()), vec![t2, t1]);
    assert_eq!(transactions::count(&db.conn, &f).unwrap(), 2);
    f.text = Some("hotel".into());
    assert_eq!(ids(f), vec![t2]);
    let mut none = TransactionFilter::combined();
    none.tag_ids = vec![work];
    assert!(!ids(none).contains(&t3));
}
