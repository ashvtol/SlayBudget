use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::categorize::learning;
use slaybudget_core::categorize::recategorize::{self, Target};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, InsertOutcome, NewTransaction, SplitPart, TransactionPatch,
};

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

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_by_legacy_name(conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

impl Db {
    fn add(&self, day: u32, description: &str, cents: i64, category: Option<i64>) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: NaiveDate::from_ymd_opt(2026, 5, day).unwrap(),
            description: description.into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: category,
            import_id: None,
        };
        match transactions::insert(&self.conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }
    fn other(&self) -> i64 {
        cat(&self.conn, "Other")
    }
}

fn ids(matches: &[recategorize::Match]) -> Vec<i64> {
    matches.iter().map(|m| m.transaction.id).collect()
}

#[test]
fn exact_target_lists_same_merchant_newest_first() {
    let db = setup();
    let other = db.other();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    let a = db.add(1, "WSDOT-GOODTOGO 1111", -425, Some(other));
    let b = db.add(9, "WSDOT GOODTOGO 2222", -425, Some(other));
    db.add(5, "SAFEWAY 12", -900, Some(other));
    let m =
        recategorize::preview(&db.conn, &Target::Merchant("wsdot goodtogo".into()), tolls).unwrap();
    assert_eq!(ids(&m), vec![b, a]);
    assert!(m.iter().all(|x| !x.similar && !x.locked));
}

#[test]
fn similar_merchants_are_flagged() {
    let db = setup();
    let subs = cat(&db.conn, "Subscriptions");
    let exact = db.add(1, "NETFLIX", -1599, Some(db.other()));
    let near = db.add(2, "NETFLEX", -1599, Some(db.other()));
    db.add(3, "SPOTIFY", -999, Some(db.other()));
    let m = recategorize::preview(&db.conn, &Target::Merchant("netflix".into()), subs).unwrap();
    assert_eq!(m.len(), 2);
    assert!(
        !m.iter()
            .find(|x| x.transaction.id == exact)
            .unwrap()
            .similar
    );
    assert!(m.iter().find(|x| x.transaction.id == near).unwrap().similar);
}

#[test]
fn platform_target_previews_nothing() {
    let db = setup();
    let rent = cat(&db.conn, "Housing & Utilities");
    db.add(1, "VENMO PAYMENT 1234567", -50000, Some(db.other()));
    db.add(2, "VENMO PAYMENT 7654321", -50000, Some(db.other()));
    let m =
        recategorize::preview(&db.conn, &Target::Merchant("venmo 1234567".into()), rent).unwrap();
    assert!(m.is_empty());
}

#[test]
fn short_contains_matches_nothing() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    db.add(1, "WS TOLL", -425, Some(db.other()));
    assert!(
        recategorize::preview(&db.conn, &Target::Contains("ws".into()), tolls)
            .unwrap()
            .is_empty()
    );
    assert!(
        recategorize::preview(&db.conn, &Target::Contains(" w- ".into()), tolls)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn contains_matches_varying_names() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    let a = db.add(1, "WSDOT-GOODTOGO 1111", -425, Some(db.other()));
    let b = db.add(2, "PAY WSDOT*GOODTOGO#88 SEATTLE", -910, Some(db.other()));
    db.add(3, "WSDOT FERRIES", -1800, Some(db.other()));
    let m =
        recategorize::preview(&db.conn, &Target::Contains("WSDOT Goodtogo".into()), tolls).unwrap();
    assert_eq!(ids(&m), vec![b, a]);
}

#[test]
fn preview_skips_rows_already_in_target() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    db.add(1, "WSDOT GOODTOGO 1", -425, Some(tolls));
    let b = db.add(2, "WSDOT GOODTOGO 2", -425, Some(db.other()));
    let m =
        recategorize::preview(&db.conn, &Target::Merchant("wsdot goodtogo".into()), tolls).unwrap();
    assert_eq!(ids(&m), vec![b]);
}

#[test]
fn preview_ignores_split_children() {
    let db = setup();
    let groceries = cat(&db.conn, "Groceries");
    let parent = db.add(1, "COSTCO WHSE 12", -10000, Some(db.other()));
    transactions::split(
        &db.conn,
        parent,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: None,
                description: None,
            },
            SplitPart {
                amount_cents: -4000,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    let m = recategorize::preview(&db.conn, &Target::Merchant("costco whse".into()), groceries)
        .unwrap();
    assert_eq!(ids(&m), vec![parent]);
    let groups = recategorize::other_groups(&db.conn).unwrap();
    assert_eq!(groups.iter().map(|g| g.count).sum::<i64>(), 1);
}

#[test]
fn locked_rows_are_flagged_and_apply_skips_them() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    let free = db.add(1, "WSDOT GOODTOGO 1", -425, Some(db.other()));
    let locked = db.add(2, "WSDOT GOODTOGO 2", -425, Some(db.other()));
    transactions::update(
        &db.conn,
        locked,
        &TransactionPatch {
            category_locked: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let m =
        recategorize::preview(&db.conn, &Target::Merchant("wsdot goodtogo".into()), tolls).unwrap();
    assert!(
        m.iter()
            .find(|x| x.transaction.id == locked)
            .unwrap()
            .locked
    );
    assert!(!m.iter().find(|x| x.transaction.id == free).unwrap().locked);
    assert_eq!(
        recategorize::apply(&db.conn, &[free, locked], tolls).unwrap(),
        1
    );
    assert_eq!(
        transactions::get(&db.conn, locked).unwrap().category_id,
        Some(db.other())
    );
}

#[test]
fn apply_marks_reviewed_and_counts() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    let a = db.add(1, "WSDOT GOODTOGO 1", -425, Some(db.other()));
    let b = db.add(2, "WSDOT GOODTOGO 2", -425, None);
    assert_eq!(recategorize::apply(&db.conn, &[a, b], tolls).unwrap(), 2);
    for id in [a, b] {
        let t = transactions::get(&db.conn, id).unwrap();
        assert_eq!(t.category_id, Some(tolls));
        assert!(t.reviewed);
    }
}

#[test]
fn set_one_learns_merchant() {
    let db = setup();
    let tolls = cat(&db.conn, "Transportation - Tolls");
    let rent = cat(&db.conn, "Housing & Utilities");
    let a = db.add(1, "WSDOT GOODTOGO 1", -425, Some(db.other()));
    let v = db.add(2, "VENMO PAYMENT 1234567", -50000, Some(db.other()));
    recategorize::set_one(&db.conn, a, tolls).unwrap();
    recategorize::set_one(&db.conn, v, rent).unwrap();
    let t = transactions::get(&db.conn, a).unwrap();
    assert_eq!((t.category_id, t.reviewed), (Some(tolls), true));
    assert_eq!(
        transactions::get(&db.conn, v).unwrap().category_id,
        Some(rent)
    );
    let learned = learning::list(&db.conn).unwrap();
    assert_eq!(learned.len(), 1);
    assert_eq!(
        (learned[0].merchant.as_str(), learned[0].category_id),
        ("wsdot goodtogo", tolls)
    );
}

#[test]
fn other_groups_counts_other_and_uncategorized() {
    let db = setup();
    let groceries = cat(&db.conn, "Groceries");
    db.add(1, "WSDOT GOODTOGO 1", -425, Some(db.other()));
    db.add(2, "WSDOT GOODTOGO 2", -500, None);
    db.add(3, "GEICO AUTO", -12000, Some(db.other()));
    db.add(4, "VENMO PAYMENT 1234567", -100, Some(db.other()));
    db.add(5, "SAFEWAY 1", -900, Some(groceries));
    let g = recategorize::other_groups(&db.conn).unwrap();
    assert_eq!(g[0].merchant, "wsdot goodtogo");
    assert_eq!((g[0].count, g[0].total_cents), (2, 925));
    assert_eq!(g.len(), 3);
    assert!(
        g.iter()
            .find(|x| x.merchant.starts_with("venmo"))
            .unwrap()
            .platform
    );
    assert!(!g[0].platform);
    assert_eq!(recategorize::other_count(&db.conn).unwrap(), 4);
}

#[test]
fn contains_skips_payment_platforms() {
    let db = setup();
    let rent = cat(&db.conn, "Housing & Utilities");
    db.add(1, "VENMO PAYMENT 1234567", -50000, Some(db.other()));
    let shop = db.add(2, "VENMO SHOP LLC", -900, Some(db.other()));
    let m = recategorize::preview(&db.conn, &Target::Contains("venmo".into()), rent).unwrap();
    // "venmo shop llc" is itself a platform key too: nothing platform-like is offered.
    assert!(m.iter().all(|x| x.transaction.id != shop
        || !slaybudget_core::categorize::is_payment_platform(&x.transaction.merchant)));
    assert!(m.is_empty());
}
