use chrono::NaiveDate;
use slaybudget_core::accounts::{self, AccountType, NewAccount};
use slaybudget_core::categories;
use slaybudget_core::categorize::rules::{self, MatchKind, NewRule};
use slaybudget_core::categorize::{extract_merchant, learning, model};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline::{self, StatementKind};
use slaybudget_core::import::ParsedRow;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::settings;
use slaybudget_core::transactions::{self, CategorySource, Transaction, TransactionFilter};

struct Db {
    conn: rusqlite::Connection,
    p: i64,
    card: i64,
}

fn setup() -> Db {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let card = account(&conn, p, "Amex", AccountType::Card);
    Db { conn, p, card }
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

fn row(day: u32, desc: &str, cents: i64) -> ParsedRow {
    ParsedRow {
        posted_on: NaiveDate::from_ymd_opt(2026, 4, day).unwrap(),
        description: desc.into(),
        amount_cents: cents,
        occurrence: 0,
        pending: false,
        raw_category: None,
        details: Vec::new(),
    }
}

impl Db {
    fn cat(&self, legacy: &str) -> i64 {
        categories::find_by_legacy_name(&self.conn, legacy)
            .unwrap()
            .unwrap()
            .id
    }
    fn teach(&self, desc: &str, legacy: &str) {
        let f = model::features(
            desc,
            &extract_merchant(desc),
            -1000,
            Some(AccountType::Card),
        );
        model::train(&self.conn, &f, self.cat(legacy), 3.0).unwrap();
    }
    fn import(&self, source: i64, file: &str, kind: StatementKind, rows: Vec<ParsedRow>) {
        pipeline::import_rows(&self.conn, self.p, source, file, file, kind, rows).unwrap();
    }
    fn get(&self, desc: &str) -> Transaction {
        transactions::list(&self.conn, &TransactionFilter::for_profile(self.p))
            .unwrap()
            .into_iter()
            .find(|t| t.description == desc)
            .unwrap()
    }
}

#[test]
fn a_confident_model_guess_is_used_and_says_why() {
    let db = setup();
    for _ in 0..2 {
        db.teach("QUILLFEATHER INKWORKS 11", "Shopping");
        db.teach("SAFEWAY 991", "Groceries");
    }
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "QUILLFEATHER INKWORKS 22", -650)],
    );
    let t = db.get("QUILLFEATHER INKWORKS 22");
    assert_eq!(t.category_id, Some(db.cat("Shopping")));
    assert_eq!(t.category_source, CategorySource::Model);
    assert!(t.category_reason.is_some());
    assert_eq!(t.suggested_category_id, None);
}

#[test]
fn with_automatic_categorizing_off_the_guess_is_only_suggested() {
    let db = setup();
    settings::set(&db.conn, "auto_categorize", "0").unwrap();
    for _ in 0..2 {
        db.teach("QUILLFEATHER INKWORKS 11", "Shopping");
        db.teach("SAFEWAY 991", "Groceries");
    }
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "QUILLFEATHER INKWORKS 22", -650)],
    );
    let t = db.get("QUILLFEATHER INKWORKS 22");
    assert_ne!(t.category_id, Some(db.cat("Shopping")));
    assert_eq!(t.category_source, CategorySource::Keyword);
    assert_eq!(t.suggested_category_id, Some(db.cat("Shopping")));
    assert!(t.suggested_reason.is_some());
}

#[test]
fn a_rule_still_beats_the_model() {
    let db = setup();
    db.teach("QUILLFEATHER INKWORKS 11", "Shopping");
    db.teach("SAFEWAY 991", "Groceries");
    let fuel = db.cat("Transportation - Fuel");
    rules::create(
        &db.conn,
        &NewRule {
            name: "bb".into(),
            match_kind: MatchKind::Contains,
            pattern: "quillfeather".into(),
            min_cents: None,
            max_cents: None,
            source_id: None,
            category_id: fuel,
            priority: 0,
        },
    )
    .unwrap();
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "QUILLFEATHER INKWORKS 22", -650)],
    );
    let t = db.get("QUILLFEATHER INKWORKS 22");
    assert_eq!(t.category_id, Some(fuel));
    assert_eq!(t.category_source, CategorySource::Rule);
}

#[test]
fn an_exact_learned_merchant_is_used_and_a_fuzzy_one_only_suggested() {
    let db = setup();
    let shopping = db.cat("Shopping");
    learning::learn(&db.conn, &extract_merchant("ACME WIDGETS"), shopping, None).unwrap();
    learning::learn(&db.conn, "acme widgetz", db.cat("Education"), None).unwrap();
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "ACME WIDGETS", -100)],
    );
    let t = db.get("ACME WIDGETS");
    assert_eq!(t.category_id, Some(shopping));
    assert_eq!(t.category_source, CategorySource::Learned);
    assert!(t.category_reason.unwrap().contains("Shopping"));

    learning::forget(&db.conn, &extract_merchant("ACME WIDGETS"), None).unwrap();
    db.import(
        db.card,
        "b.csv",
        StatementKind::Card,
        vec![row(2, "ACME WIDGETS", -200)],
    );
    let t = transactions::list(&db.conn, &TransactionFilter::for_profile(db.p))
        .unwrap()
        .into_iter()
        .find(|t| t.amount_cents == -200)
        .unwrap();
    assert_ne!(t.category_source, CategorySource::Learned);
    assert_eq!(t.suggested_category_id, Some(db.cat("Education")));
}

#[test]
fn the_banks_category_beats_keywords() {
    let db = setup();
    let mut r = row(1, "XQZ HOLDINGS 991", -2500);
    r.raw_category = Some("Restaurant-Restaurant".into());
    db.import(db.card, "a.csv", StatementKind::Card, vec![r]);
    let t = db.get("XQZ HOLDINGS 991");
    assert_eq!(t.category_id, Some(db.cat("Food & Dining")));
    assert_eq!(t.category_source, CategorySource::Bank);
}

#[test]
fn importing_both_sides_of_a_transfer_pairs_them() {
    let db = setup();
    let checking = account(&db.conn, db.p, "Checking", AccountType::Checking);
    let savings = account(&db.conn, db.p, "Savings", AccountType::Savings);
    db.import(
        checking,
        "c.csv",
        StatementKind::Checking,
        vec![row(3, "ONLINE TRANSFER TO SAV 1", -40000)],
    );
    db.import(
        savings,
        "s.csv",
        StatementKind::Checking,
        vec![row(4, "ONLINE TRANSFER FROM CHK 2", 40000)],
    );
    let transfer = db.cat("Transfer");
    let a = db.get("ONLINE TRANSFER TO SAV 1");
    let b = db.get("ONLINE TRANSFER FROM CHK 2");
    assert_eq!(
        (a.category_id, b.category_id),
        (Some(transfer), Some(transfer))
    );
    assert_eq!(a.transfer_pair_id, Some(b.id));
}

#[test]
fn explain_names_your_examples_or_the_known_merchant() {
    let db = setup();
    let shopping = db.cat("Shopping");
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![
            row(1, "BLUE BOTTLE COFFEE 1", -100),
            row(2, "BLUE BOTTLE COFFEE 2", -200),
            row(3, "PHILZ BLUE", -300),
        ],
    );
    for d in ["BLUE BOTTLE COFFEE 1", "BLUE BOTTLE COFFEE 2", "PHILZ BLUE"] {
        let id = db.get(d).id;
        transactions::update(
            &db.conn,
            id,
            &transactions::TransactionPatch {
                category_id: Some(Some(shopping)),
                ..Default::default()
            },
        )
        .unwrap();
    }
    let why = model::explain(
        &db.conn,
        &extract_merchant("BLUE BOTTLE COFFEE 9"),
        shopping,
    )
    .unwrap();
    assert!(
        why.starts_with("Like 3 others you put in Shopping ("),
        "{why}"
    );
    let known = model::explain(&db.conn, "starbucks", db.cat("Food & Dining")).unwrap();
    assert_eq!(known, "Known merchant: Starbucks");
}

#[test]
fn a_gas_station_is_never_categorized_by_the_model_at_import() {
    let db = setup();
    for _ in 0..3 {
        db.teach("SHELL OIL 574101 SEATTLE", "Groceries");
        db.teach("SAFEWAY 991", "Shopping");
    }
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "SHELL OIL 574199 SEATTLE", -1500)],
    );
    let t = db.get("SHELL OIL 574199 SEATTLE");
    assert_ne!(t.category_source, CategorySource::Model);
}

#[test]
fn a_learned_merchant_never_categorizes_a_zelle_payment() {
    let db = setup();
    let key = extract_merchant("ZELLE PAYMENT TO JOHN SMITH CONF# ab123");
    learning::learn(&db.conn, &key, db.cat("Shopping"), None).unwrap();
    db.import(
        db.card,
        "a.csv",
        StatementKind::Card,
        vec![row(1, "ZELLE PAYMENT TO JOHN SMITH CONF# cd456", -2000)],
    );
    let t = db.get("ZELLE PAYMENT TO JOHN SMITH CONF# cd456");
    assert_ne!(t.category_source, CategorySource::Learned);
    assert_ne!(t.suggested_category_id, Some(db.cat("Shopping")));
}
