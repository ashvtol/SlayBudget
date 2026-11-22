use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::categorize::recategorize;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, InsertOutcome, NewTransaction, TransactionFilter, TransactionPatch, TxType,
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
    fn ty(&self, id: i64) -> TxType {
        transactions::get(&self.conn, id).unwrap().tx_type
    }
}

#[test]
fn backfill_sets_type_from_category_kind() {
    let db = setup();
    let payment = db.add(
        1,
        "PAYMENT THANK YOU",
        50000,
        Some(cat(&db.conn, "Payment")),
    );
    let salary = db.add(
        2,
        "MICROSOFT PAYROLL",
        300000,
        Some(cat(&db.conn, "Income - Salary")),
    );
    let food = db.add(
        3,
        "DIN TAI FUNG",
        -4000,
        Some(cat(&db.conn, "Food & Dining")),
    );
    let none = db.add(4, "MYSTERY", -100, None);
    let refund = db.add(
        5,
        "AMAZON REFUND",
        2500,
        Some(cat(&db.conn, "Credits/Refunds")),
    );
    db.conn
        .execute("UPDATE transactions SET type = 'regular'", [])
        .unwrap();
    db.conn
        .execute_batch(include_str!(
            "../migrations/0006_backfill_transaction_types.sql"
        ))
        .unwrap();
    assert_eq!(db.ty(payment), TxType::Transfer);
    assert_eq!(db.ty(salary), TxType::Income);
    assert_eq!(db.ty(food), TxType::Regular);
    assert_eq!(db.ty(none), TxType::Regular);
    // Refunds are regular (Copilot), still kept out of totals by their excluded category.
    assert_eq!(db.ty(refund), TxType::Regular);
    let refunds = categories::find_by_legacy_name(&db.conn, "Credits/Refunds")
        .unwrap()
        .unwrap();
    assert!(refunds.excluded);
    // No category changed.
    assert_eq!(
        transactions::get(&db.conn, payment).unwrap().category_id,
        Some(cat(&db.conn, "Payment"))
    );
}

#[test]
fn insert_takes_type_from_category() {
    let db = setup();
    assert_eq!(
        db.ty(db.add(
            1,
            "PAYMENT THANK YOU",
            50000,
            Some(cat(&db.conn, "Payment"))
        )),
        TxType::Transfer
    );
    assert_eq!(
        db.ty(db.add(2, "PAYROLL", 300000, Some(cat(&db.conn, "Income - Salary")))),
        TxType::Income
    );
    assert_eq!(
        db.ty(db.add(3, "SAFEWAY", -900, Some(cat(&db.conn, "Groceries")))),
        TxType::Regular
    );
    assert_eq!(db.ty(db.add(4, "X", -1, None)), TxType::Regular);
}

#[test]
fn picking_a_category_switches_the_type_with_it() {
    let db = setup();
    let id = db.add(1, "MICROSOFT PAYROLL", 300000, None);
    let patch = |c: i64| TransactionPatch {
        category_id: Some(Some(c)),
        ..Default::default()
    };
    transactions::update(&db.conn, id, &patch(cat(&db.conn, "Income - Salary"))).unwrap();
    assert_eq!(db.ty(id), TxType::Income);
    recategorize::set_one(&db.conn, id, cat(&db.conn, "Groceries")).unwrap();
    assert_eq!(db.ty(id), TxType::Regular);
    recategorize::apply(&db.conn, &[id], cat(&db.conn, "Payment")).unwrap();
    assert_eq!(db.ty(id), TxType::Transfer);
}

#[test]
fn set_type_clears_categories_that_do_not_fit() {
    let db = setup();
    let food = cat(&db.conn, "Food & Dining");
    let salary = cat(&db.conn, "Income - Salary");
    let a = db.add(1, "DIN TAI FUNG", -4000, Some(food));
    let b = db.add(2, "PAYROLL", 300000, Some(salary));
    let c = db.add(3, "VENMO FROM SAM", 2000, Some(food));

    assert_eq!(
        transactions::set_type(&db.conn, &[a], TxType::Transfer).unwrap(),
        1
    );
    let t = transactions::get(&db.conn, a).unwrap();
    assert_eq!((t.tx_type, t.category_id), (TxType::Transfer, None));

    transactions::set_type(&db.conn, &[b], TxType::Income).unwrap();
    assert_eq!(
        transactions::get(&db.conn, b).unwrap().category_id,
        Some(salary)
    );

    transactions::set_type(&db.conn, &[c], TxType::Income).unwrap();
    let t = transactions::get(&db.conn, c).unwrap();
    assert_eq!((t.tx_type, t.category_id), (TxType::Income, None));

    transactions::set_type(&db.conn, &[b], TxType::Regular).unwrap();
    let t = transactions::get(&db.conn, b).unwrap();
    assert_eq!((t.tx_type, t.category_id), (TxType::Regular, None));
}

#[test]
fn filters_by_any_of_several_types() {
    let db = setup();
    db.add(
        1,
        "PAYMENT THANK YOU",
        50000,
        Some(cat(&db.conn, "Payment")),
    );
    db.add(2, "PAYROLL", 300000, Some(cat(&db.conn, "Income - Salary")));
    db.add(3, "SAFEWAY", -900, Some(cat(&db.conn, "Groceries")));
    let count = |types: Vec<TxType>| {
        transactions::count(
            &db.conn,
            &TransactionFilter {
                types,
                ..Default::default()
            },
        )
        .unwrap()
    };
    assert_eq!(count(vec![TxType::Income]), 1);
    assert_eq!(count(vec![TxType::Income, TxType::Transfer]), 2);
    assert_eq!(count(vec![]), 3);
}

#[test]
fn deleting_a_category_moves_rows_to_other_as_regular() {
    let db = setup();
    let id = db.add(1, "PAYROLL", 300000, Some(cat(&db.conn, "Income - Other")));
    categories::delete(&db.conn, cat(&db.conn, "Income - Other")).unwrap();
    assert_eq!(db.ty(id), TxType::Regular);
}

#[test]
fn split_parts_take_their_category_type_or_the_parents() {
    use slaybudget_core::transactions::SplitPart;
    let db = setup();
    let salary = cat(&db.conn, "Income - Salary");
    let pay = db.add(1, "PAYROLL", 300000, Some(salary));
    let parts = transactions::split(
        &db.conn,
        pay,
        &[
            SplitPart {
                amount_cents: 200000,
                category_id: Some(salary),
                description: None,
            },
            SplitPart {
                amount_cents: 100000,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    assert_eq!(db.ty(parts[0]), TxType::Income);
    assert_eq!(db.ty(parts[1]), TxType::Income);

    let food = db.add(2, "COSTCO", -10000, Some(cat(&db.conn, "Groceries")));
    let kids = transactions::split(
        &db.conn,
        food,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: Some(cat(&db.conn, "Groceries")),
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
    assert_eq!(db.ty(kids[1]), TxType::Regular);
}

#[test]
fn backfill_gives_uncategorized_split_parts_the_parents_type() {
    use slaybudget_core::transactions::SplitPart;
    let db = setup();
    let pay = db.add(1, "PAYROLL", 300000, Some(cat(&db.conn, "Income - Salary")));
    let parts = transactions::split(
        &db.conn,
        pay,
        &[
            SplitPart {
                amount_cents: 200000,
                category_id: None,
                description: None,
            },
            SplitPart {
                amount_cents: 100000,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    db.conn
        .execute("UPDATE transactions SET type = 'regular'", [])
        .unwrap();
    db.conn
        .execute_batch(include_str!(
            "../migrations/0006_backfill_transaction_types.sql"
        ))
        .unwrap();
    assert_eq!(db.ty(parts[0]), TxType::Income);
}

#[test]
fn set_type_carries_to_split_parts() {
    use slaybudget_core::transactions::SplitPart;
    let db = setup();
    let parent = db.add(1, "COSTCO", -10000, Some(cat(&db.conn, "Groceries")));
    let parts = transactions::split(
        &db.conn,
        parent,
        &[
            SplitPart {
                amount_cents: -6000,
                category_id: Some(cat(&db.conn, "Groceries")),
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
    transactions::set_type(&db.conn, &[parent], TxType::Transfer).unwrap();
    for id in parts {
        let t = transactions::get(&db.conn, id).unwrap();
        assert_eq!((t.tx_type, t.category_id), (TxType::Transfer, None));
    }
}
