use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::categorize::recategorize;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, CategorySource, InsertOutcome, NewTransaction, Transaction, TransactionPatch,
};
use slaybudget_core::undo::UndoStack;

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
    fn add(&self, day: u32, desc: &str) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: NaiveDate::from_ymd_opt(2026, 1, day).unwrap(),
            description: desc.into(),
            amount_cents: -500 - day as i64,
            currency: "USD".into(),
            occurrence: 0,
            category_id: Some(self.cat("Shopping")),
            import_id: None,
        };
        match transactions::insert(&self.conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }
    fn cat(&self, legacy: &str) -> i64 {
        categories::find_by_legacy_name(&self.conn, legacy)
            .unwrap()
            .unwrap()
            .id
    }
    fn yours_in(&self, id: i64, legacy: &str) {
        transactions::update(
            &self.conn,
            id,
            &TransactionPatch {
                category_id: Some(Some(self.cat(legacy))),
                ..Default::default()
            },
        )
        .unwrap();
    }
    fn get(&self, id: i64) -> Transaction {
        transactions::get(&self.conn, id).unwrap()
    }
    fn count(&self, table: &str) -> i64 {
        self.conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }
    /// 15 Starbucks rows: the first is yours (in Shopping), the second locked.
    fn starbucks(&self) -> Vec<i64> {
        let ids: Vec<i64> = (1..=15)
            .map(|d| self.add(d, &format!("STARBUCKS #{d}")))
            .collect();
        transactions::update(
            &self.conn,
            ids[0],
            &TransactionPatch {
                category_id: Some(Some(self.cat("Shopping"))),
                ..Default::default()
            },
        )
        .unwrap();
        transactions::update(
            &self.conn,
            ids[1],
            &TransactionPatch {
                category_locked: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        ids
    }
}

#[test]
fn changing_one_moves_the_other_rows_from_that_merchant_but_not_yours_or_locked_ones() {
    let db = setup();
    let ids = db.starbucks();
    let dining = db.cat("Food & Dining");
    let change = recategorize::change_category(&db.conn, ids[14], dining).unwrap();
    assert_eq!(change.moved, 12);
    assert_eq!(change.merchant, "starbucks");
    assert_eq!(db.get(ids[14]).category_source, CategorySource::User);
    let moved = db.get(ids[5]);
    assert_eq!(moved.category_id, Some(dining));
    assert_eq!(moved.category_source, CategorySource::Learned);
    assert_eq!(
        moved.category_reason.as_deref(),
        Some("Moved with your change to Starbucks")
    );
    assert_eq!(
        db.get(ids[0]).category_id,
        Some(db.cat("Shopping")),
        "yours stays"
    );
    assert_eq!(
        db.get(ids[1]).category_id,
        Some(db.cat("Shopping")),
        "locked stays"
    );
}

#[test]
fn a_similar_merchant_gets_a_suggestion_not_a_move() {
    let db = setup();
    let a = db.add(1, "STARBUCKS #1");
    let b = db.add(2, "STARBUCKS COFFEE CO");
    let dining = db.cat("Food & Dining");
    let change = recategorize::change_category(&db.conn, a, dining).unwrap();
    assert_eq!((change.moved, change.suggested), (0, 1));
    let t = db.get(b);
    assert_eq!(t.category_id, Some(db.cat("Shopping")));
    assert_eq!(t.suggested_category_id, Some(dining));
    assert!(t.suggested_reason.unwrap().contains("Starbucks"));
}

#[test]
fn undo_takes_back_every_row_the_merchant_and_what_the_model_learned() {
    let db = setup();
    let ids = db.starbucks();
    let before: Vec<Transaction> = ids.iter().map(|&i| db.get(i)).collect();
    let (rules, counts) = (db.count("merchant_rules"), db.count("model_counts"));
    let mut stack = UndoStack::new();
    stack
        .record(&db.conn, "Change Category", |c| {
            recategorize::change_category(c, ids[14], db.cat("Food & Dining"))
        })
        .unwrap();
    assert!(db.count("model_counts") > counts);
    stack.undo(&db.conn).unwrap();
    let after: Vec<Transaction> = ids.iter().map(|&i| db.get(i)).collect();
    assert_eq!(after, before);
    assert_eq!(
        (db.count("merchant_rules"), db.count("model_counts")),
        (rules, counts)
    );
}

#[test]
fn only_this_one_changes_one_row_and_saves_no_merchant_but_still_teaches_the_model() {
    let db = setup();
    let ids = db.starbucks();
    recategorize::set_only(&db.conn, ids[14], db.cat("Food & Dining")).unwrap();
    assert_eq!(db.get(ids[14]).category_id, Some(db.cat("Food & Dining")));
    assert_eq!(db.get(ids[14]).category_source, CategorySource::User);
    assert_eq!(db.get(ids[5]).category_id, Some(db.cat("Shopping")));
    assert_eq!(db.count("merchant_rules"), 0);
    assert!(db.count("model_counts") > 0);
}

#[test]
fn a_payment_app_is_never_moved_in_history() {
    let db = setup();
    let a = db.add(1, "VENMO 1234567890");
    let b = db.add(2, "VENMO 1234567891");
    let change = recategorize::change_category(&db.conn, a, db.cat("Food & Dining")).unwrap();
    assert_eq!((change.moved, change.suggested), (0, 0));
    assert_eq!(db.get(b).category_id, Some(db.cat("Shopping")));
}

#[test]
fn a_zelle_payment_is_not_learned_or_moved_even_when_its_merchant_key_lost_the_word() {
    let db = setup();
    let a = db.add(1, "ZELLE PAYMENT TO JOHN SMITH CONF# ab123");
    let b = db.add(2, "ZELLE PAYMENT TO JOHN SMITH CONF# cd456");
    assert!(
        !db.get(a).merchant.contains("zelle"),
        "{}",
        db.get(a).merchant
    );
    let change = recategorize::change_category(&db.conn, a, db.cat("Food & Dining")).unwrap();
    assert_eq!((change.moved, change.suggested), (0, 0));
    assert_eq!(db.get(b).category_id, Some(db.cat("Shopping")));
    assert_eq!(db.count("merchant_rules"), 0);
}

#[test]
fn a_category_change_leaves_paired_transfers_alone() {
    let db = setup();
    let a = db.add(1, "STARBUCKS #1");
    let paired = db.add(2, "STARBUCKS #2");
    let similar = db.add(3, "STARBUCKS COFFEE CO");
    db.conn
        .execute(
            "UPDATE transactions SET transfer_pair_id = ?1 WHERE id IN (?1, ?2)",
            [paired, similar],
        )
        .unwrap();
    let change = recategorize::change_category(&db.conn, a, db.cat("Food & Dining")).unwrap();
    assert_eq!((change.moved, change.suggested), (0, 0));
    assert_eq!(db.get(paired).category_id, Some(db.cat("Shopping")));
    assert_eq!(db.get(similar).suggested_category_id, None);
}

#[test]
fn setting_several_at_once_makes_each_yours_and_moves_nothing_else() {
    let db = setup();
    let a = db.add(1, "WISE INC WISE FAMILY 1");
    let b = db.add(2, "WISE INC WISE FAMILY 2");
    let other = db.add(3, "WISE INC WISE FAMILY 3");
    db.conn
        .execute(
            "UPDATE transactions SET suggested_category_id = ?1 WHERE id = ?2",
            [db.cat("Transfer"), a],
        )
        .unwrap();
    let gifts = db.cat("Gifts & Donations");
    assert_eq!(recategorize::set_many(&db.conn, &[a, b], gifts).unwrap(), 2);
    for id in [a, b] {
        let t = db.get(id);
        assert_eq!(t.category_id, Some(gifts));
        assert_eq!(t.category_source, CategorySource::User);
        assert_eq!(t.suggested_category_id, None);
    }
    assert_eq!(db.get(other).category_id, Some(db.cat("Shopping")));
    assert!(db.count("model_counts") > 0, "the classifier learns each");
}

#[test]
fn a_payment_app_change_says_so_and_lists_the_same_name_to_ask_about() {
    let db = setup();
    let a = db.add(1, "WISE INC WISE FAMILY 1");
    let b = db.add(2, "WISE INC WISE FAMILY 2");
    let yours = db.add(3, "WISE INC WISE FAMILY 3");
    let locked = db.add(4, "WISE INC WISE FAMILY 4");
    let other = db.add(5, "VENMO 1234567890");
    db.yours_in(yours, "Transfer");
    db.conn
        .execute(
            "UPDATE transactions SET category_locked = 1 WHERE id = ?1",
            [locked],
        )
        .unwrap();
    let gifts = db.cat("Gifts & Donations");
    let change = recategorize::change_category(&db.conn, a, gifts).unwrap();
    assert!(change.platform);
    assert_eq!(change.moved, 0);
    let ask = recategorize::same_merchant(&db.conn, a, gifts).unwrap();
    let ids: Vec<i64> = ask.iter().map(|m| m.transaction.id).collect();
    assert_eq!(ids.len(), 3, "{ids:?}");
    assert!(ids.contains(&b) && ids.contains(&yours) && ids.contains(&locked));
    assert!(!ids.contains(&other));
    assert!(
        ask.iter()
            .find(|m| m.transaction.id == locked)
            .unwrap()
            .locked
    );
    let starbucks = db.add(6, "STARBUCKS #1");
    assert!(
        !recategorize::change_category(&db.conn, starbucks, gifts)
            .unwrap()
            .platform
    );
}
