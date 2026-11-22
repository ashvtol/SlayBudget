use slaybudget_core::categories;
use slaybudget_core::categorize::rules::{self, MatchKind, NewRule, RuleInput};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_by_legacy_name(conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

fn rule(name: &str, kind: MatchKind, pattern: &str, category_id: i64) -> NewRule {
    NewRule {
        name: name.into(),
        match_kind: kind,
        pattern: pattern.into(),
        min_cents: None,
        max_cents: None,
        source_id: None,
        category_id,
        priority: 0,
    }
}

fn input(description: &str, cents: i64) -> RuleInput<'_> {
    RuleInput {
        description,
        merchant: "",
        amount_cents: cents,
        source_id: 1,
    }
}

#[test]
fn contains_is_case_insensitive() {
    let conn = open_in_memory().unwrap();
    let fuel = cat(&conn, "Transportation - Fuel");
    rules::create(
        &conn,
        &rule("Costco gas", MatchKind::Contains, "costco gas", fuel),
    )
    .unwrap();
    assert_eq!(
        rules::apply(&conn, &input("COSTCO GAS #1234 SEATTLE", -5000)).unwrap(),
        Some(fuel)
    );
    assert_eq!(
        rules::apply(&conn, &input("COSTCO WHSE #1234", -5000)).unwrap(),
        None
    );
}

#[test]
fn starts_with_equals_and_regex() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Subscriptions");
    let b = cat(&conn, "Groceries");
    let c = cat(&conn, "Payment");
    rules::create(&conn, &rule("Apple", MatchKind::StartsWith, "apple.com", a)).unwrap();
    rules::create(&conn, &rule("TJ", MatchKind::Equals, "trader joes 123", b)).unwrap();
    rules::create(
        &conn,
        &rule(
            "Autopay",
            MatchKind::Regex,
            r"^(autopay|payment thank you)",
            c,
        ),
    )
    .unwrap();
    assert_eq!(
        rules::apply(&conn, &input("APPLE.COM/BILL", -999)).unwrap(),
        Some(a)
    );
    assert_eq!(
        rules::apply(&conn, &input("TRADER JOES 123", -4000)).unwrap(),
        Some(b)
    );
    assert_eq!(
        rules::apply(&conn, &input("TRADER JOES 1234", -4000)).unwrap(),
        None
    );
    assert_eq!(
        rules::apply(&conn, &input("PAYMENT THANK YOU", 50000)).unwrap(),
        Some(c)
    );
}

#[test]
fn amount_range_and_source_constraints() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let amex = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let citi = profiles::find_or_create_source(&conn, p, "Citi", SourceKind::Csv).unwrap();
    let fuel = cat(&conn, "Transportation - Fuel");
    let groceries = cat(&conn, "Groceries");
    let mut small = rule("Shell small", MatchKind::Contains, "shell", groceries);
    small.max_cents = Some(1500);
    let mut big = rule("Shell big", MatchKind::Contains, "shell", fuel);
    big.min_cents = Some(1501);
    big.source_id = Some(amex);
    rules::create(&conn, &small).unwrap();
    rules::create(&conn, &big).unwrap();
    let shell = |cents: i64, source_id: i64| RuleInput {
        description: "SHELL OIL 1",
        merchant: "",
        amount_cents: cents,
        source_id,
    };
    assert_eq!(
        rules::apply(&conn, &shell(-800, citi)).unwrap(),
        Some(groceries),
        "amount magnitude is compared"
    );
    assert_eq!(
        rules::apply(&conn, &shell(-4800, amex)).unwrap(),
        Some(fuel)
    );
    assert_eq!(
        rules::apply(&conn, &shell(-4800, citi)).unwrap(),
        None,
        "source constraint"
    );
}

#[test]
fn priority_then_creation_order_and_disabled_rules() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Groceries");
    let b = cat(&conn, "Shopping");
    let first = rules::create(&conn, &rule("first", MatchKind::Contains, "amazon", a)).unwrap();
    let mut high = rule("high", MatchKind::Contains, "amazon", b);
    high.priority = 10;
    let high_id = rules::create(&conn, &high).unwrap();
    assert_eq!(
        rules::apply(&conn, &input("AMAZON.COM", -100)).unwrap(),
        Some(b)
    );
    rules::set_enabled(&conn, high_id, false).unwrap();
    assert_eq!(
        rules::apply(&conn, &input("AMAZON.COM", -100)).unwrap(),
        Some(a)
    );
    rules::delete(&conn, first).unwrap();
    assert_eq!(
        rules::apply(&conn, &input("AMAZON.COM", -100)).unwrap(),
        None
    );
    assert_eq!(rules::list(&conn).unwrap().len(), 1);
}

#[test]
fn invalid_regex_is_rejected_at_create() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Groceries");
    assert!(rules::create(&conn, &rule("bad", MatchKind::Regex, "(", a)).is_err());
}

#[test]
fn merchant_rule_matches_merchant_key() {
    let conn = open_in_memory().unwrap();
    let tolls = cat(&conn, "Transportation - Tolls");
    rules::create(
        &conn,
        &rule(
            "wsdot goodtogo",
            MatchKind::Merchant,
            "wsdot goodtogo",
            tolls,
        ),
    )
    .unwrap();
    let hit = RuleInput {
        description: "WSDOT-GOODTOGO 1234",
        merchant: "wsdot goodtogo",
        amount_cents: -425,
        source_id: 1,
    };
    let miss = RuleInput {
        description: "WSDOT FERRIES",
        merchant: "wsdot ferries",
        amount_cents: -425,
        source_id: 1,
    };
    assert_eq!(rules::apply(&conn, &hit).unwrap(), Some(tolls));
    assert_eq!(rules::apply(&conn, &miss).unwrap(), None);
}

#[test]
fn contains_uses_normalized_description() {
    let conn = open_in_memory().unwrap();
    let tolls = cat(&conn, "Transportation - Tolls");
    rules::create(
        &conn,
        &rule("wsdot", MatchKind::Contains, "wsdot goodtogo", tolls),
    )
    .unwrap();
    assert_eq!(
        rules::apply(&conn, &input("WSDOT-GOODTOGO  1234", -425)).unwrap(),
        Some(tolls)
    );
    assert_eq!(
        rules::apply(&conn, &input("WSDOT*GOODTOGO#88", -425)).unwrap(),
        Some(tolls)
    );
    assert_eq!(
        rules::normalize_description("  WSDOT-GOODTOGO * #12  x "),
        "wsdot goodtogo 12 x"
    );
}

#[test]
fn save_or_replace_overwrites_same_pattern() {
    let conn = open_in_memory().unwrap();
    let tolls = cat(&conn, "Transportation - Tolls");
    let parking = cat(&conn, "Transportation - Parking");
    rules::save_or_replace(
        &conn,
        &rule("a", MatchKind::Merchant, "wsdot goodtogo", tolls),
    )
    .unwrap();
    rules::save_or_replace(
        &conn,
        &rule("b", MatchKind::Merchant, "WSDOT Goodtogo", parking),
    )
    .unwrap();
    rules::save_or_replace(
        &conn,
        &rule("c", MatchKind::Contains, "wsdot goodtogo", tolls),
    )
    .unwrap();
    let all = rules::list(&conn).unwrap();
    assert_eq!(all.len(), 2);
    let m = all
        .iter()
        .find(|r| r.match_kind == MatchKind::Merchant)
        .unwrap();
    assert_eq!(m.category_id, parking);
}

#[test]
fn new_rules_run_first() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Transportation - Cab/Rideshare");
    let b = cat(&conn, "Food & Dining");
    rules::save_or_replace(&conn, &rule("uber", MatchKind::Contains, "uber", a)).unwrap();
    rules::save_or_replace(
        &conn,
        &rule("uber eats", MatchKind::Contains, "uber eats", b),
    )
    .unwrap();
    assert_eq!(
        rules::apply(&conn, &input("UBER EATS 1", -900)).unwrap(),
        Some(b)
    );
    assert_eq!(
        rules::apply(&conn, &input("UBER TRIP", -900)).unwrap(),
        Some(a)
    );
}

#[test]
fn rules_never_file_payment_platform_rows() {
    let conn = open_in_memory().unwrap();
    let rent = cat(&conn, "Housing & Utilities");
    rules::create(&conn, &rule("venmo", MatchKind::Contains, "venmo", rent)).unwrap();
    let venmo = RuleInput {
        description: "VENMO PAYMENT 1234567",
        merchant: "venmo 1234567",
        amount_cents: -50000,
        source_id: 1,
    };
    assert_eq!(rules::apply(&conn, &venmo).unwrap(), None);
}
