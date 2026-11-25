use chrono::NaiveDate;
use slaybudget_core::accounts::{self, AccountType, NewAccount};
use slaybudget_core::categories;
use slaybudget_core::categorize::transfers;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, CategorySource, InsertOutcome, NewTransaction, TxType};

struct Db {
    conn: rusqlite::Connection,
    p: i64,
    checking: i64,
    savings: i64,
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
    let checking = account(&conn, p, "Chase Checking", AccountType::Checking);
    let savings = account(&conn, p, "Savings", AccountType::Savings);
    let card = account(&conn, p, "Amex", AccountType::Card);
    Db {
        conn,
        p,
        checking,
        savings,
        card,
    }
}

impl Db {
    fn add(&self, source: i64, day: u32, desc: &str, cents: i64) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: source,
            posted_on: NaiveDate::from_ymd_opt(2026, 3, day).unwrap(),
            description: desc.into(),
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
    fn cat(&self, legacy: &str) -> i64 {
        categories::find_by_legacy_name(&self.conn, legacy)
            .unwrap()
            .unwrap()
            .id
    }
    fn run(&self) -> (usize, usize) {
        let pairs = transfers::find_pairs(&self.conn, self.p, None, 4).unwrap();
        transfers::apply_pairs(&self.conn, &pairs).unwrap()
    }
}

#[test]
fn money_moved_to_savings_is_a_transfer_on_both_sides() {
    let db = setup();
    let out = db.add(db.checking, 1, "ONLINE TRANSFER TO SAV 4411", -50000);
    let inn = db.add(db.savings, 3, "ONLINE TRANSFER FROM CHK 9921", 50000);
    assert_eq!(db.run(), (1, 0));
    let (o, i) = (
        transactions::get(&db.conn, out).unwrap(),
        transactions::get(&db.conn, inn).unwrap(),
    );
    let transfer = db.cat("Transfer");
    for t in [&o, &i] {
        assert_eq!(t.category_id, Some(transfer));
        assert_eq!(t.tx_type, TxType::Transfer);
        assert_eq!(t.category_source, CategorySource::Transfer);
    }
    assert_eq!(o.transfer_pair_id, Some(inn));
    assert_eq!(i.transfer_pair_id, Some(out));
    assert_eq!(o.category_reason.as_deref(), Some("Transfer to Savings"));
    assert_eq!(
        i.category_reason.as_deref(),
        Some("Transfer from Chase Checking")
    );
}

#[test]
fn the_same_account_or_too_far_apart_is_not_a_transfer() {
    let db = setup();
    db.add(db.checking, 1, "ONLINE TRANSFER", -50000);
    db.add(db.checking, 2, "ONLINE TRANSFER", 50000);
    db.add(db.savings, 10, "ONLINE TRANSFER", 7000);
    db.add(db.checking, 15, "ONLINE TRANSFER", -7000);
    assert_eq!(db.run(), (0, 0));
}

#[test]
fn paying_the_card_from_checking_is_a_payment() {
    let db = setup();
    let a = db.add(db.checking, 5, "AMEX EPAYMENT ACH PMT", -30000);
    let b = db.add(db.card, 6, "PAYMENT THANK YOU", 30000);
    assert_eq!(db.run(), (1, 0));
    let payment = db.cat("Payment");
    assert_eq!(
        transactions::get(&db.conn, a).unwrap().category_id,
        Some(payment)
    );
    assert_eq!(
        transactions::get(&db.conn, b).unwrap().category_id,
        Some(payment)
    );
}

#[test]
fn a_match_without_transfer_words_is_only_suggested() {
    let db = setup();
    let a = db.add(db.checking, 1, "JOHN SMITH", -50000);
    let b = db.add(db.savings, 3, "DEPOSIT", 50000);
    assert_eq!(db.run(), (0, 1));
    let transfer = db.cat("Transfer");
    let t = transactions::get(&db.conn, a).unwrap();
    assert_eq!(
        t.category_source,
        CategorySource::Keyword,
        "category unchanged"
    );
    assert_eq!(t.suggested_category_id, Some(transfer));
    assert_eq!(
        t.suggested_reason.as_deref(),
        Some("Matches +$500.00 into Savings on Mar 3")
    );
    assert_eq!(t.transfer_pair_id, Some(b));
    assert_eq!(
        transactions::get(&db.conn, b)
            .unwrap()
            .suggested_reason
            .as_deref(),
        Some("Matches −$500.00 from Chase Checking on Mar 1")
    );
    assert_eq!(db.run(), (0, 0), "a pair is suggested once");
}

#[test]
fn the_closest_date_wins_and_each_row_is_used_once() {
    let db = setup();
    let out = db.add(db.checking, 5, "TRANSFER TO SAV", -50000);
    let far = db.add(db.savings, 2, "TRANSFER FROM CHK", 50000);
    let near = db.add(db.savings, 6, "TRANSFER FROM CHK", 50000);
    assert_eq!(db.run(), (1, 0));
    assert_eq!(
        transactions::get(&db.conn, out).unwrap().transfer_pair_id,
        Some(near)
    );
    assert_eq!(
        transactions::get(&db.conn, far).unwrap().transfer_pair_id,
        None
    );
}

#[test]
fn a_category_you_chose_is_never_paired() {
    let db = setup();
    let a = db.add(db.checking, 1, "TRANSFER TO SAV", -50000);
    db.add(db.savings, 2, "TRANSFER FROM CHK", 50000);
    transactions::update(
        &db.conn,
        a,
        &transactions::TransactionPatch {
            category_id: Some(Some(db.cat("Shopping"))),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(db.run(), (0, 0));
}

#[test]
fn among_limits_pairing_to_new_rows() {
    let db = setup();
    db.add(db.checking, 1, "TRANSFER TO SAV", -50000);
    db.add(db.savings, 2, "TRANSFER FROM CHK", 50000);
    let fresh = db.add(db.card, 20, "PAYMENT THANK YOU", 9900);
    let pairs = transfers::find_pairs(&db.conn, db.p, Some(&[fresh]), 4).unwrap();
    assert!(pairs.is_empty());
}

#[test]
fn a_transfer_word_on_one_side_only_is_a_suggestion() {
    let db = setup();
    let a = db.add(db.checking, 2, "ATM WITHDRAWAL 7781", -10000);
    db.add(db.card, 3, "PAYMENT THANK YOU", 10000);
    assert_eq!(db.run(), (0, 1));
    assert_eq!(
        transactions::get(&db.conn, a).unwrap().category_source,
        CategorySource::Keyword
    );
}

#[test]
fn card_to_card_is_never_applied_without_asking() {
    let db = setup();
    let other = account(&db.conn, db.p, "Citi Card", AccountType::Card);
    db.add(db.card, 2, "BALANCE TRANSFER", -10000);
    db.add(other, 3, "BALANCE TRANSFER", 10000);
    assert_eq!(db.run(), (0, 1));
}

#[test]
fn a_worded_partner_beats_a_closer_unworded_one() {
    let db = setup();
    let savings2 = account(&db.conn, db.p, "Savings 2", AccountType::Savings);
    let out = db.add(db.checking, 5, "ONLINE TRANSFER TO SAV", -20000);
    db.add(db.savings, 5, "DEPOSIT", 20000);
    let worded = db.add(savings2, 8, "ONLINE TRANSFER FROM CHK", 20000);
    assert_eq!(db.run(), (1, 0));
    assert_eq!(
        transactions::get(&db.conn, out).unwrap().transfer_pair_id,
        Some(worded)
    );
}
