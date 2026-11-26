//! A credit that pays a charge back (a card's statement credit for a bill, or a refund matched to its purchase) counts
//! in the charge's category, so spending nets out everywhere.

use chrono::NaiveDate;
use slaybudget_core::analytics::recurring::Cadence;
use slaybudget_core::categories;
use slaybudget_core::credits;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::recurrings::{self, MatchKind, NewRecurring};
use slaybudget_core::transactions::{self, CategorySource, InsertOutcome, NewTransaction, TxType};

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
    fn cat(&self, name: &str) -> i64 {
        categories::list(&self.conn)
            .unwrap()
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
            .id
    }
    /// A transaction filed automatically (by keyword) in `category`.
    fn add(&self, date: &str, description: &str, cents: i64, category: &str) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            description: description.into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: None,
            import_id: None,
        };
        let InsertOutcome::Inserted(id) = transactions::insert(&self.conn, &tx).unwrap() else {
            panic!("duplicate")
        };
        self.conn
            .execute(
                "UPDATE transactions SET category_id = ?1, type = 'regular', category_source = 'keyword' WHERE id = ?2",
                [self.cat(category), id],
            )
            .unwrap();
        id
    }
    fn bill(&self, name: &str, pattern: &str, cents: i64, day: u32, credits: &[&str]) -> i64 {
        recurrings::create(
            &self.conn,
            &NewRecurring {
                name: name.into(),
                category_id: Some(self.cat("Subscriptions")),
                match_kind: MatchKind::Contains,
                pattern: pattern.into(),
                min_cents: cents - 200,
                max_cents: cents + 200,
                frequency: Cadence::Monthly,
                day_of_month: Some(day),
                also_matches: Vec::new(),
                paid_back_by: Some(credits.iter().map(|c| c.to_string()).collect()),
            },
        )
        .unwrap()
    }
    fn get(&self, id: i64) -> transactions::Transaction {
        transactions::get(&self.conn, id).unwrap()
    }
}

#[test]
fn a_bill_credit_moves_to_the_bill_charges_category_and_says_why() {
    let db = setup();
    db.add(
        "2026-10-13",
        "GOOGLE *YOUTUBEPREMIUM",
        -899,
        "Subscriptions",
    );
    db.add(
        "2026-11-13",
        "GOOGLE *YOUTUBEPREMIUM",
        -899,
        "Subscriptions",
    );
    db.add("2026-11-09", "PEACOCK NEW", -1989, "Subscriptions");
    db.bill(
        "YouTube Premium",
        "youtubepremium",
        899,
        13,
        &["platinum digital"],
    );
    db.bill("Peacock", "peacock", 1989, 9, &["platinum digital"]);
    let oct = db.add(
        "2026-10-14",
        "PLATINUM DIGITAL ENTERTAINMENT CREDIT",
        899,
        "Credits & Refunds",
    );
    let nov = db.add(
        "2026-11-13",
        "PLATINUM DIGITAL ENTERTAINMENT CREDIT",
        899,
        "Credits & Refunds",
    );
    // Nothing it could pay back within 10 days: stays where it is.
    let lone = db.add(
        "2026-06-30",
        "PLATINUM DIGITAL ENTERTAINMENT CREDIT",
        500,
        "Credits & Refunds",
    );

    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 2);
    for id in [oct, nov] {
        let t = db.get(id);
        assert_eq!(t.category_id, Some(db.cat("Subscriptions")));
        assert_eq!(t.tx_type, TxType::Regular);
        assert_eq!(t.category_source, CategorySource::Credit);
    }
    assert_eq!(
        db.get(nov).category_reason.as_deref(),
        Some("Pays back YouTube Premium (Nov 13)")
    );
    assert_eq!(db.get(lone).category_id, Some(db.cat("Credits & Refunds")));
    assert_eq!(
        credits::follow_charges(&db.conn).unwrap(),
        0,
        "nothing left to move"
    );
}

#[test]
fn a_credit_you_filed_yourself_stays_put() {
    let db = setup();
    db.add("2026-11-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.bill("Walmart+", "walmart+", 1428, 22, &["platinum walmart+"]);
    let credit = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    transactions::update(
        &db.conn,
        credit,
        &transactions::TransactionPatch {
            category_id: Some(Some(db.cat("Gifts & Donations"))),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    assert_eq!(
        db.get(credit).category_id,
        Some(db.cat("Gifts & Donations"))
    );
}

#[test]
fn a_refund_matched_to_its_purchase_follows_the_purchase() {
    let db = setup();
    db.add("2025-09-01", "UBER ONE help.uber.com", -9600, "Rideshare");
    let refund = db.add(
        "2025-09-20",
        "UBER ONE help.uber.com",
        9600,
        "Credits & Refunds",
    );
    slaybudget_core::analytics::refunds::rematch(&db.conn, Some(db.p)).unwrap();
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(refund).category_id, Some(db.cat("Rideshare")));
}

#[test]
fn when_the_charge_changes_category_its_credit_follows_again() {
    let db = setup();
    let charge = db.add("2026-11-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.bill("Walmart+", "walmart+", 1428, 22, &["platinum walmart+"]);
    let credit = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    credits::follow_charges(&db.conn).unwrap();
    transactions::update(
        &db.conn,
        charge,
        &transactions::TransactionPatch {
            category_id: Some(Some(db.cat("Groceries"))),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(credit).category_id, Some(db.cat("Groceries")));
}

// ----- edge cases -----

fn walmart(db: &Db) -> i64 {
    db.add("2026-11-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.bill("Walmart+", "walmart+", 1428, 22, &["platinum walmart+"])
}

#[test]
fn a_credit_bigger_than_the_charge_or_more_than_10_days_away_is_not_paired() {
    let db = setup();
    walmart(&db);
    let too_big = db.add(
        "2026-11-23",
        "PLATINUM WALMART+ CREDIT",
        1500,
        "Credits & Refunds",
    );
    let too_far = db.add(
        "2026-12-03",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    ); // 11 days
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    for id in [too_big, too_far] {
        assert_eq!(db.get(id).category_id, Some(db.cat("Credits & Refunds")));
    }
}

#[test]
fn exactly_10_days_away_still_pairs() {
    let db = setup();
    walmart(&db);
    let credit = db.add(
        "2026-12-02",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(credit).category_id, Some(db.cat("Subscriptions")));
}

#[test]
fn a_partial_credit_moves_too() {
    let db = setup();
    db.add("2026-11-14", "LULULEMON ATHLETICA", -9839, "Clothing");
    db.bill("Lululemon", "lululemon", 9839, 14, &["platinum lululemon"]);
    let credit = db.add(
        "2026-11-14",
        "PLATINUM LULULEMON CREDIT",
        7500,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(credit).category_id, Some(db.cat("Clothing")));
}

#[test]
fn a_credit_two_bills_could_claim_goes_to_the_nearest_charge_only() {
    let db = setup();
    db.add(
        "2026-11-13",
        "GOOGLE *YOUTUBEPREMIUM",
        -899,
        "Subscriptions",
    );
    db.add("2026-11-09", "PEACOCK NEW", -1989, "Entertainment");
    db.bill(
        "YouTube Premium",
        "youtubepremium",
        899,
        13,
        &["platinum digital"],
    );
    db.bill("Peacock", "peacock", 1989, 9, &["platinum digital"]);
    // One day from Peacock, three from YouTube.
    let credit = db.add(
        "2026-11-10",
        "PLATINUM DIGITAL ENTERTAINMENT CREDIT",
        899,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(credit).category_id, Some(db.cat("Entertainment")));
    assert_eq!(
        db.get(credit).category_reason.as_deref(),
        Some("Pays back Peacock (Nov 9)")
    );
}

#[test]
fn two_credits_for_one_charge_pair_only_the_nearest() {
    let db = setup();
    walmart(&db);
    let near = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    let second = db.add(
        "2026-11-25",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 1);
    assert_eq!(db.get(near).category_id, Some(db.cat("Subscriptions")));
    assert_eq!(
        db.get(second).category_id,
        Some(db.cat("Credits & Refunds"))
    );
}

#[test]
fn a_locked_credit_or_one_your_rule_filed_stays_put() {
    let db = setup();
    db.add("2026-10-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    walmart(&db);
    let locked = db.add(
        "2026-10-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    let ruled = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    db.conn
        .execute(
            "UPDATE transactions SET category_locked = 1 WHERE id = ?1",
            [locked],
        )
        .unwrap();
    db.conn
        .execute(
            "UPDATE transactions SET category_source = 'rule' WHERE id = ?1",
            [ruled],
        )
        .unwrap();
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    for id in [locked, ruled] {
        assert_eq!(db.get(id).category_id, Some(db.cat("Credits & Refunds")));
    }
}

#[test]
fn a_charge_with_no_category_leaves_its_credit_alone() {
    let db = setup();
    let charge = db.add("2026-11-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.conn
        .execute(
            "UPDATE transactions SET category_id = NULL WHERE id = ?1",
            [charge],
        )
        .unwrap();
    db.bill("Walmart+", "walmart+", 1428, 22, &["platinum walmart+"]);
    let credit = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    assert_eq!(
        db.get(credit).category_id,
        Some(db.cat("Credits & Refunds"))
    );
}

#[test]
fn a_bill_marked_not_paid_back_pairs_nothing() {
    let db = setup();
    db.add("2026-11-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.bill("Walmart+", "walmart+", 1428, 22, &[]);
    let credit = db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    assert_eq!(
        db.get(credit).category_id,
        Some(db.cat("Credits & Refunds"))
    );
}

#[test]
fn a_credit_in_another_profile_is_not_paired() {
    let db = setup();
    walmart(&db);
    let other = profiles::create(&db.conn, "Sam", None).unwrap();
    let source = profiles::find_or_create_source(&db.conn, other, "Amex", SourceKind::Csv).unwrap();
    let tx = NewTransaction {
        profile_id: other,
        source_id: source,
        posted_on: NaiveDate::from_ymd_opt(2026, 11, 22).unwrap(),
        description: "PLATINUM WALMART+ CREDIT".into(),
        amount_cents: 1428,
        currency: "USD".into(),
        occurrence: 0,
        category_id: Some(db.cat("Credits & Refunds")),
        import_id: None,
    };
    let InsertOutcome::Inserted(id) = transactions::insert(&db.conn, &tx).unwrap() else {
        panic!()
    };
    assert_eq!(credits::follow_charges(&db.conn).unwrap(), 0);
    assert_eq!(db.get(id).category_id, Some(db.cat("Credits & Refunds")));
}

#[test]
fn after_the_move_a_fully_credited_bill_adds_nothing_to_its_category() {
    use slaybudget_core::analytics::aggregate::{category_totals, DateRange};
    let db = setup();
    walmart(&db);
    db.add(
        "2026-11-22",
        "PLATINUM WALMART+ CREDIT",
        1428,
        "Credits & Refunds",
    );
    let subscriptions = db.cat("Subscriptions");
    let spent = |db: &Db| {
        category_totals(
            &db.conn,
            Some(db.p),
            DateRange {
                from: None,
                to: None,
            },
        )
        .unwrap()
        .into_iter()
        .find(|t| t.category_id == Some(subscriptions))
        .map(|t| t.total_cents)
        .unwrap_or(0)
    };
    assert_eq!(spent(&db), 1428, "before: the credit counts nowhere");
    credits::follow_charges(&db.conn).unwrap();
    assert_eq!(spent(&db), 0);
}

#[test]
fn updating_backs_up_the_database_then_moves_the_credits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("slaybudget.db");
    {
        // As the previous version (schema 18) left it: the credit filed in Credits & Refunds.
        let conn = slaybudget_core::db::open_at_version(&path, 18).unwrap();
        conn.execute_batch(
            "INSERT INTO profiles (id, name) VALUES (1, 'Alex');
             INSERT INTO sources (id, profile_id, name, kind) VALUES (1, 1, 'Amex', 'csv');
             INSERT INTO category_groups (id, name, color, sort_order) VALUES (1, 'Entertainment', '#af52de', 0);
             INSERT INTO categories (id, group_id, name, kind, excluded, sort_order) VALUES
               (1, 1, 'Subscriptions', 'expense', 0, 0), (2, 1, 'Credits & Refunds', 'expense', 1, 1);
             INSERT INTO recurrings (id, name, category_id, match_kind, pattern, min_cents, max_cents, frequency, day_of_month, status, credit_names)
               VALUES (1, 'Walmart+', 1, 'contains', 'walmart+', 1200, 1600, 'monthly', 22, 'active', 'platinum walmart+');
             INSERT INTO transactions (profile_id, source_id, posted_on, description, merchant, amount_cents, currency, dedupe_hash, category_id, recurring_id)
               VALUES (1, 1, '2026-11-22', 'WALMART+ MEMBERSHIP', 'walmart+ membership', -1428, 'USD', 'a', 1, 1),
                      (1, 1, '2026-11-22', 'PLATINUM WALMART+ CREDIT', 'platinum walmart+ credit', 1428, 'USD', 'b', 2, NULL);",
        )
        .unwrap();
    }
    let conn = slaybudget_core::db::open_db(&path).unwrap();
    let category: i64 = conn
        .query_row(
            "SELECT category_id FROM transactions WHERE dedupe_hash = 'b'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        category, 1,
        "the credit follows its charge into Subscriptions"
    );
    let backups: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with("slaybudget.before-credits-follow-charges-"))
        .collect();
    assert_eq!(backups.len(), 1, "{backups:?}");
    // The backup still has the credit where it was.
    let old = rusqlite::Connection::open(dir.path().join(&backups[0])).unwrap();
    let before: i64 = old
        .query_row(
            "SELECT category_id FROM transactions WHERE dedupe_hash = 'b'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, 2);
}

#[test]
fn an_imported_credit_lands_in_its_charge_category() {
    let db = setup();
    db.add("2026-10-22", "WALMART+ MEMBERSHIP", -1428, "Subscriptions");
    db.bill("Walmart+", "walmart+", 1428, 22, &["platinum walmart+"]);
    let csv = "Date,Description,Amount\n11/22/2026,WALMART+ MEMBERSHIP,-14.28\n11/22/2026,PLATINUM WALMART+ CREDIT,14.28\n";
    slaybudget_core::import::pipeline::import_csv(&db.conn, db.p, "Checking/activity.csv", csv)
        .unwrap();
    let rows = transactions::list(
        &db.conn,
        &transactions::TransactionFilter {
            profile_id: Some(db.p),
            ..Default::default()
        },
    )
    .unwrap();
    let charge = rows
        .iter()
        .find(|t| t.amount_cents == -1428 && t.posted_on.to_string() == "2026-11-22")
        .unwrap();
    let credit = rows.iter().find(|t| t.amount_cents == 1428).unwrap();
    assert!(charge.category_id.is_some());
    assert_eq!(credit.category_id, charge.category_id);
    assert_eq!(credit.category_source, CategorySource::Credit);
}
