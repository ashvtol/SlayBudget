use chrono::NaiveDate;
use slaybudget_core::accounts::{self, AccountType, NewAccount};
use slaybudget_core::categories;
use slaybudget_core::categorize::history;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, CategorySource, InsertOutcome, NewTransaction, Transaction, TransactionPatch,
};

struct Db {
    conn: rusqlite::Connection,
    p: i64,
    card: i64,
}

fn account(conn: &rusqlite::Connection, p: i64, name: &str, t: AccountType) -> i64 {
    accounts::create(
        conn,
        p,
        SourceKind::Csv,
        &NewAccount {
            name: name.into(),
            institution: None,
            account_type: Some(t),
            color: None,
            default_tag_id: None,
        },
    )
    .unwrap()
}

fn setup() -> Db {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let card = account(&conn, p, "Amex", AccountType::Card);
    Db { conn, p, card }
}

impl Db {
    fn cat(&self, legacy: &str) -> i64 {
        categories::find_by_legacy_name(&self.conn, legacy)
            .unwrap()
            .unwrap()
            .id
    }
    fn add(&self, source: i64, day: u32, desc: &str, cents: i64, legacy: &str) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: source,
            posted_on: NaiveDate::from_ymd_opt(2026, 2, day).unwrap(),
            description: desc.into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: Some(self.cat(legacy)),
            import_id: None,
        };
        match transactions::insert(&self.conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }
    fn yours(&self, id: i64, legacy: &str) {
        transactions::update(
            &self.conn,
            id,
            &TransactionPatch {
                category_id: Some(Some(self.cat(legacy))),
                reviewed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    }
    fn get(&self, id: i64) -> Transaction {
        transactions::get(&self.conn, id).unwrap()
    }
}

#[test]
fn the_pass_fixes_learned_merchants_pairs_transfers_and_leaves_the_unknown() {
    let db = setup();
    for d in 1..=10 {
        let id = db.add(
            db.card,
            d,
            &format!("STARBUCKS #{d}"),
            -500 - d as i64,
            "Shopping",
        );
        db.yours(id, "Food & Dining");
    }
    slaybudget_core::categorize::learning::learn(
        &db.conn,
        "starbucks",
        db.cat("Food & Dining"),
        None,
    )
    .unwrap();
    let stale: Vec<i64> = (11..=13)
        .map(|d| {
            db.add(
                db.card,
                d,
                &format!("STARBUCKS #{d}"),
                -500 - d as i64,
                "Shopping",
            )
        })
        .collect();
    let checking = account(&db.conn, db.p, "Checking", AccountType::Checking);
    let savings = account(&db.conn, db.p, "Savings", AccountType::Savings);
    let out = db.add(checking, 3, "ONLINE TRANSFER TO SAV", -90000, "Other");
    let inn = db.add(
        savings,
        4,
        "ONLINE TRANSFER FROM CHK",
        90000,
        "Income - Other",
    );
    let unknown = db.add(db.card, 20, "ZXQV QWRT LLC", -4400, "Other");

    let report = history::run_once(&db.conn).unwrap().expect("first run");
    assert_eq!(report.moved, 3, "{report:?}");
    assert_eq!(report.transfers, 1);
    for id in stale {
        assert_eq!(db.get(id).category_id, Some(db.cat("Food & Dining")));
        assert_eq!(db.get(id).category_source, CategorySource::Learned);
    }
    assert_eq!(db.get(out).category_id, Some(db.cat("Transfer")));
    assert_eq!(db.get(inn).category_id, Some(db.cat("Transfer")));
    assert_eq!(db.get(unknown).category_id, Some(db.cat("Other")));
    assert!(history::run_once(&db.conn).unwrap().is_none(), "runs once");
}

#[test]
fn with_nothing_of_yours_the_starter_list_only_suggests() {
    let db = setup();
    let id = db.add(db.card, 1, "STARBUCKS STORE 991", -650, "Other");
    let report = history::run_once(&db.conn).unwrap().unwrap();
    assert_eq!(report.moved, 0);
    let t = db.get(id);
    assert_eq!(t.category_id, Some(db.cat("Other")));
    assert_eq!(t.suggested_category_id, Some(db.cat("Coffee")), "{t:?}");
    assert_eq!(history::suggestion_count(&db.conn, Some(db.p)).unwrap(), 1);
}

#[test]
fn accepting_one_side_of_a_suggested_transfer_accepts_both() {
    let db = setup();
    let checking = account(&db.conn, db.p, "Checking", AccountType::Checking);
    let savings = account(&db.conn, db.p, "Savings", AccountType::Savings);
    let a = db.add(checking, 3, "JOHN SMITH", -90000, "Other");
    let b = db.add(savings, 4, "DEPOSIT", 90000, "Income - Other");
    history::run_once(&db.conn).unwrap();
    assert_eq!(db.get(a).suggested_category_id, Some(db.cat("Transfer")));
    assert_eq!(history::accept(&db.conn, &[a]).unwrap(), 2);
    for id in [a, b] {
        let t = db.get(id);
        assert_eq!(t.category_id, Some(db.cat("Transfer")));
        assert_eq!(t.category_source, CategorySource::User);
        assert_eq!(t.suggested_category_id, None);
    }
    assert_eq!(db.get(a).transfer_pair_id, Some(b));
}

#[test]
fn rejecting_keeps_the_category_as_yours_and_unlinks_a_pair() {
    let db = setup();
    let checking = account(&db.conn, db.p, "Checking", AccountType::Checking);
    let savings = account(&db.conn, db.p, "Savings", AccountType::Savings);
    let a = db.add(checking, 3, "JOHN SMITH", -90000, "Other");
    let b = db.add(savings, 4, "DEPOSIT", 90000, "Income - Other");
    history::run_once(&db.conn).unwrap();
    assert_eq!(history::reject(&db.conn, &[a]).unwrap(), 2);
    for id in [a, b] {
        let t = db.get(id);
        assert_eq!(t.suggested_category_id, None);
        assert_eq!(t.transfer_pair_id, None);
        assert_eq!(t.category_source, CategorySource::User);
    }
    assert_eq!(db.get(a).category_id, Some(db.cat("Other")));
}

#[test]
fn accepting_a_category_suggestion_teaches_the_model() {
    let db = setup();
    let id = db.add(db.card, 1, "STARBUCKS STORE 991", -650, "Other");
    history::run_once(&db.conn).unwrap();
    let before: f64 = db
        .conn
        .query_row(
            "SELECT docs FROM model_totals WHERE category_id = ?1",
            [db.cat("Coffee")],
            |r| r.get(0),
        )
        .unwrap();
    history::accept(&db.conn, &[id]).unwrap();
    let after: f64 = db
        .conn
        .query_row(
            "SELECT docs FROM model_totals WHERE category_id = ?1",
            [db.cat("Coffee")],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after - before, 3.0);
    assert_eq!(db.get(id).category_id, Some(db.cat("Coffee")));
}

#[test]
fn a_gas_station_or_payment_app_is_only_suggested_never_moved() {
    let db = setup();
    for d in 1..=10 {
        let id = db.add(
            db.card,
            d,
            &format!("SHELL OIL 5741{d} SEATTLE"),
            -900 - d as i64,
            "Other",
        );
        db.yours(id, "Groceries");
    }
    let open = db.add(db.card, 20, "SHELL OIL 574199 SEATTLE", -1500, "Other");
    let report = history::run_once(&db.conn).unwrap().unwrap();
    assert_eq!(report.moved, 0, "{report:?}");
    let t = db.get(open);
    assert_eq!(t.category_id, Some(db.cat("Other")));
    assert_eq!(t.suggested_category_id, Some(db.cat("Groceries")));
}

#[test]
fn a_guess_is_suggested_only_for_rows_in_other() {
    let db = setup();
    for d in 1..=10 {
        let id = db.add(
            db.card,
            d,
            &format!("SHELL OIL 5741{d} SEATTLE"),
            -900 - d as i64,
            "Other",
        );
        db.yours(id, "Groceries");
    }
    let fuel = db.add(
        db.card,
        20,
        "SHELL OIL 574199 SEATTLE",
        -1500,
        "Transportation - Fuel",
    );
    history::run_once(&db.conn).unwrap();
    assert_eq!(db.get(fuel).suggested_category_id, None);
}

#[test]
fn a_zelle_payment_is_not_moved_even_when_its_merchant_key_lost_the_word_zelle() {
    let db = setup();
    for d in 1..=10 {
        let id = db.add(
            db.card,
            d,
            &format!("Zelle Debit PAY ID:CTI{d}AB ORG ID:BAC NAME:ROOMMATE"),
            -90000 - d as i64,
            "Other",
        );
        db.yours(id, "Housing & Utilities");
    }
    let open = db.add(
        db.card,
        20,
        "Zelle Debit PAY ID:CTI99ZZ ORG ID:JPM NAME:SOMEONE ELSE",
        -4000,
        "Other",
    );
    let report = history::run_once(&db.conn).unwrap().unwrap();
    assert_eq!(report.moved, 0, "{report:?}");
    assert_eq!(db.get(open).category_id, Some(db.cat("Other")));
}
