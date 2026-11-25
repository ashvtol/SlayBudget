use chrono::NaiveDate;
use serde_json::json;
use slaybudget_core::analytics::recurring::Cadence;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::notifications::config::{self, Config};
use slaybudget_core::notifications::{self, producers, Kind};
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::recurrings::{self, MatchKind, NewRecurring, Status};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};

pub struct Db {
    pub conn: rusqlite::Connection,
    pub p: i64,
    pub s: i64,
}

pub fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

impl Db {
    pub fn setup() -> Db {
        let conn = open_in_memory().unwrap();
        let p = profiles::create(&conn, "Alex", None).unwrap();
        let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
        Db { conn, p, s }
    }
    pub fn add(&self, date: &str, description: &str, cents: i64) -> i64 {
        self.add_nth(date, description, cents, 0)
    }
    /// The same charge again on the same day (the importer numbers repeats).
    pub fn add_nth(&self, date: &str, description: &str, cents: i64, occurrence: u32) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: d(date),
            description: description.into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence,
            category_id: None,
            import_id: None,
        };
        match transactions::insert(&self.conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }
    /// Netflix charged on the 5th, Aug to Nov 2026, saved as a monthly bill.
    pub fn netflix(&self, cents: &[i64]) -> i64 {
        for (i, c) in cents.iter().enumerate() {
            self.add(&format!("2026-{:02}-05", 8 + i), "NETFLIX.COM 866", -c);
        }
        recurrings::create(
            &self.conn,
            &NewRecurring {
                name: "Netflix".into(),
                category_id: None,
                match_kind: MatchKind::Merchant,
                pattern: "netflix.com".into(),
                min_cents: 1000,
                max_cents: 3000,
                frequency: Cadence::Monthly,
                day_of_month: Some(5),
                also_matches: Vec::new(),
                paid_back_by: None,
            },
        )
        .unwrap()
    }
    /// One more Netflix charge; returns the bill's id.
    pub fn netflix_more(&self, date: &str, cents: i64) -> i64 {
        let tx = self.add(date, "NETFLIX.COM 866", -cents);
        recurrings::match_new(&self.conn, &[tx]).unwrap();
        recurrings::list(&self.conn).unwrap()[0].id
    }
    pub fn run(&self, today: &str, baseline: bool) -> Vec<notifications::Notification> {
        producers::refresh(
            &self.conn,
            d(today),
            &format!("{today}T12:00:00Z"),
            baseline,
        )
        .unwrap()
    }
    pub fn keys(&self, today: &str) -> Vec<String> {
        self.run(today, false).into_iter().map(|n| n.key).collect()
    }
    pub fn set(&self, f: impl FnOnce(&mut Config)) {
        let mut c = config::load(&self.conn).unwrap();
        f(&mut c);
        config::save(&self.conn, &c).unwrap();
    }
}

mod bills {
    use super::*;

    #[test]
    fn upcoming_bill_n_days_before_and_again_on_the_due_day() {
        let db = Db::setup();
        let id = db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true); // first run: baseline
        assert!(
            db.keys("2026-12-01").is_empty(),
            "4 days before: too early with the default 3"
        );
        let got = db.run("2026-12-02", false);
        assert_eq!(got.len(), 1);
        let n = &got[0];
        assert_eq!(n.kind, Kind::BillUpcoming);
        assert_eq!(n.title, "Netflix is due in 3 days");
        assert!(n.body.contains("$17.99"), "{}", n.body);
        assert_eq!(n.target, json!({ "kind": "recurring", "id": id }));
        assert_eq!(n.profile_id, Some(db.p));
        assert!(db.keys("2026-12-03").is_empty(), "once per due date");
        let due = db.run("2026-12-05", false);
        assert_eq!(
            due.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(),
            ["Netflix is due today"]
        );
    }

    #[test]
    fn lead_time_and_the_due_day_reminder_follow_the_settings() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true);
        db.set(|c| {
            c.bill_lead_days = 10;
            c.bill_due_day = false;
        });
        assert_eq!(
            db.run("2026-11-25", false)[0].title,
            "Netflix is due in 10 days"
        );
        assert!(db.keys("2026-12-05").is_empty());
    }

    #[test]
    fn a_bill_with_no_charge_after_the_grace_period_looks_missed() {
        let db = Db::setup();
        let id = db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true);
        db.run("2026-12-05", false);
        db.add("2026-12-07", "TRADER JOES", -2500); // the account's statement runs past the due date
        assert!(
            db.keys("2026-12-07")
                .iter()
                .all(|k| !k.starts_with("missed:")),
            "2 days late: within the 3-day grace period"
        );
        let missed = db.run("2026-12-08", false);
        assert_eq!(missed.len(), 1);
        assert_eq!(missed[0].kind, Kind::BillMissed);
        assert_eq!(missed[0].title, "Netflix looks missed");
        assert_eq!(missed[0].target, json!({ "kind": "recurring", "id": id }));
    }

    #[test]
    fn a_bill_is_only_missed_when_its_account_has_newer_transactions() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true);
        // No statement past Dec 5 has been imported yet: absence of a charge proves nothing.
        assert!(db
            .keys("2026-12-20")
            .iter()
            .all(|k| !k.starts_with("missed:")));
        // A newer transaction on the same account shows the statement covers the due date.
        db.add("2026-12-12", "TRADER JOES", -2500);
        assert!(db
            .keys("2026-12-20")
            .iter()
            .any(|k| k.starts_with("missed:")));
    }

    #[test]
    fn a_bill_not_seen_for_over_a_month_is_stale_not_missed() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799, 1799]); // next due Dec 5
        db.run("2026-11-20", true);
        db.add("2027-02-10", "TRADER JOES", -2500); // the account has data well past the due date
                                                    // Two months on, it's likely cancelled; Recurrings shows it under "Not seen lately".
        assert!(db
            .keys("2027-02-11")
            .iter()
            .all(|k| !k.starts_with("missed:")));
    }

    #[test]
    fn paused_and_archived_bills_never_notify() {
        let db = Db::setup();
        let id = db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true);
        recurrings::set_status(&db.conn, id, Status::Paused).unwrap();
        assert!(db.keys("2026-12-02").is_empty());
        assert!(db.keys("2026-12-20").is_empty());
    }

    #[test]
    fn the_first_run_stores_what_is_already_true_as_read_and_returns_nothing() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799, 1799]);
        assert!(db.run("2026-12-02", true).is_empty());
        let inbox = notifications::list(&db.conn, None).unwrap();
        assert_eq!(inbox.len(), 1);
        assert!(inbox[0].read);
        assert!(notifications::pending_banners(&db.conn, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_kind_switched_off_for_the_bell_is_not_produced() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799, 1799]);
        db.run("2026-11-20", true);
        db.set(|c| c.kinds.get_mut("billUpcoming").unwrap().bell = false);
        assert!(db.keys("2026-12-02").is_empty());
    }
}

mod money {
    use super::*;
    use slaybudget_core::transactions::TxType;

    #[test]
    fn a_bill_that_went_up_by_enough_is_flagged_once() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799]);
        db.run("2026-10-20", true);
        let id = db.netflix_more("2026-11-05", 1999);
        let up = db.run("2026-11-08", false);
        let up: Vec<_> = up.into_iter().filter(|n| n.kind == Kind::PriceUp).collect();
        assert_eq!(up.len(), 1);
        assert_eq!(up[0].title, "Netflix went up");
        assert_eq!(up[0].body, "From $17.99 to $19.99 (+11%)");
        assert_eq!(up[0].target, json!({ "kind": "recurring", "id": id }));
        assert!(db
            .keys("2026-11-09")
            .iter()
            .all(|k| !k.starts_with("price:")));
    }

    #[test]
    fn bills_that_always_vary_are_not_price_increases() {
        let db = Db::setup();
        db.netflix(&[1799, 1650, 1720]); // never a steady price (a utility, a coffee habit)
        db.run("2026-10-20", true);
        db.netflix_more("2026-11-05", 1999);
        assert!(db
            .keys("2026-11-08")
            .iter()
            .all(|k| !k.starts_with("price:")));
    }

    #[test]
    fn small_increases_and_price_drops_are_not_flagged() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799]);
        db.run("2026-10-20", true);
        db.netflix_more("2026-11-05", 1829); // +1.7%: under 2%
        assert!(db
            .keys("2026-11-08")
            .iter()
            .all(|k| !k.starts_with("price:")));
        db.netflix_more("2026-12-05", 1499); // a drop
        assert!(db
            .keys("2026-12-08")
            .iter()
            .all(|k| !k.starts_with("price:")));
    }

    #[test]
    fn the_same_amount_at_the_same_merchant_within_the_window_is_a_possible_double_charge() {
        let db = Db::setup();
        db.run("2026-11-01", true);
        let a = db.add("2026-11-20", "BLUE BOTTLE COFFEE 12", -450);
        let b = db.add_nth("2026-11-20", "BLUE BOTTLE COFFEE 12", -450, 1);
        db.add("2026-11-20", "BLUE BOTTLE COFFEE 12", -500); // different amount
        let got: Vec<_> = db
            .run("2026-11-21", false)
            .into_iter()
            .filter(|n| n.kind == Kind::DoubleCharge)
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].key, format!("dup:{a}:{b}"));
        assert_eq!(got[0].title, "Possible double charge");
        assert!(got[0].body.contains("$4.50"), "{}", got[0].body);
        assert_eq!(got[0].target["kind"], "transactions");
        assert_eq!(got[0].target["filter"], "search");
        assert_eq!(got[0].profile_id, Some(db.p));
    }

    #[test]
    fn repeat_bill_charges_are_not_double_charges() {
        let db = Db::setup();
        db.netflix(&[1799, 1799, 1799]);
        db.run("2026-11-01", true);
        db.add("2026-11-20", "SPOTIFY USA", -1199);
        db.add("2026-11-23", "SPOTIFY USA", -1199); // 3 days apart: outside the 1-day window
        assert!(db.keys("2026-11-24").iter().all(|k| !k.starts_with("dup:")));
    }

    #[test]
    fn large_transactions_at_or_above_the_threshold() {
        let db = Db::setup();
        db.run("2026-11-01", true);
        let big = db.add("2026-11-19", "APPLE STORE #R123", -60000);
        db.add("2026-11-19", "TRADER JOES", -4999);
        let got: Vec<_> = db
            .run("2026-11-20", false)
            .into_iter()
            .filter(|n| n.kind == Kind::LargeTransaction)
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].body, "$600.00 at Apple Store on Thu, Nov 19");
        assert_eq!(got[0].target, json!({ "kind": "transaction", "id": big }));
        db.set(|c| c.large_cents = 100_000);
        db.add("2026-11-20", "BEST BUY 0042", -70000);
        assert!(db
            .keys("2026-11-21")
            .iter()
            .all(|k| !k.starts_with("large:")));
    }

    #[test]
    fn old_transactions_never_notify() {
        let db = Db::setup();
        db.run("2026-11-01", true);
        db.add("2026-10-01", "APPLE STORE #R123", -60000); // imported late: posted 7+ weeks ago
        assert!(db.keys("2026-11-20").is_empty());
    }

    #[test]
    fn paychecks_and_refunds_arrive_as_money_in() {
        let db = Db::setup();
        db.run("2026-11-01", true);
        let pay = db.add("2026-11-15", "ACME CORP PAYROLL", 395000);
        transactions::set_type(&db.conn, &[pay], TxType::Income).unwrap();
        let charge = db.add("2026-11-10", "AMAZON MKTPLACE", -3240);
        let refund = db.add("2026-11-16", "AMAZON MKTPLACE", 3240);
        db.conn
            .execute(
                "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
                [charge, refund],
            )
            .unwrap();
        let mut got: Vec<_> = db
            .run("2026-11-17", false)
            .into_iter()
            .filter(|n| n.kind == Kind::MoneyIn)
            .collect();
        got.sort_by_key(|n| n.key.clone());
        assert_eq!(
            got.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(),
            ["Paycheck arrived", "Refund received"]
        );
        assert_eq!(got[0].body, "$3,950.00 from Acme Corp");
        assert_eq!(
            got[1].target,
            json!({ "kind": "transaction", "id": refund })
        );
        db.set(|c| c.money_in_refunds = false);
        let r2 = db.add("2026-11-18", "AMAZON MKTPLACE", 1000);
        db.conn
            .execute(
                "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
                [charge, r2],
            )
            .unwrap();
        assert!(db.keys("2026-11-19").iter().all(|k| !k.starts_with("in:")));
    }
}

mod budgets_and_recaps {
    use super::*;
    use slaybudget_core::{budgets, categories};

    fn groceries(db: &Db, budget: i64) -> i64 {
        let cat = categories::find_or_create_by_legacy_name(&db.conn, "Groceries").unwrap();
        budgets::set_budget(&db.conn, cat, None, Some(budget)).unwrap();
        cat
    }
    fn spend(db: &Db, date: &str, what: &str, cents: i64, cat: i64) -> i64 {
        let id = db.add(date, what, -cents);
        db.conn
            .execute(
                "UPDATE transactions SET category_id = ?1 WHERE id = ?2",
                [cat, id],
            )
            .unwrap();
        id
    }

    #[test]
    fn a_category_over_its_budget_this_month() {
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        db.run("2026-11-01", true);
        spend(&db, "2026-11-10", "WHOLE FOODS 101", 30000, cat);
        assert!(
            db.keys("2026-11-10")
                .iter()
                .all(|k| !k.starts_with("over:")),
            "$300 of $450, and not on pace yet"
        );
        spend(&db, "2026-11-20", "WHOLE FOODS 102", 18241, cat);
        let got: Vec<_> = db
            .run("2026-11-21", false)
            .into_iter()
            .filter(|n| n.key.starts_with("over:"))
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].kind, Kind::OverBudget);
        assert_eq!(got[0].title, "Groceries is over budget");
        assert_eq!(got[0].body, "$482.41 of $450.00 spent in November");
        assert_eq!(
            got[0].target,
            json!({ "kind": "category", "id": cat, "month": "2026-11" })
        );
        assert_eq!(got[0].profile_id, None);
    }

    #[test]
    fn exactly_at_budget_is_not_over_and_a_lower_warning_says_how_much_is_used() {
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        db.run("2026-11-01", true);
        spend(&db, "2026-11-25", "WHOLE FOODS 101", 45000, cat);
        assert!(
            db.keys("2026-11-26")
                .iter()
                .all(|k| !k.starts_with("over:")),
            "spent exactly the budget"
        );
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        db.run("2026-11-01", true);
        db.set(|c| {
            c.budget_warn_percent = 90;
            c.budget_on_pace = false;
        });
        spend(&db, "2026-11-25", "WHOLE FOODS 101", 41000, cat);
        let got: Vec<_> = db
            .run("2026-11-26", false)
            .into_iter()
            .filter(|n| n.kind == Kind::OverBudget)
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].key, format!("near:{cat}:2026-11"));
        assert_eq!(got[0].title, "Groceries has used 91% of its budget");
        assert_eq!(got[0].body, "$410.00 of $450.00 spent in November");
    }

    #[test]
    fn on_pace_to_overspend_after_the_first_week_and_only_when_switched_on() {
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        db.run("2026-11-01", true);
        spend(&db, "2026-11-09", "WHOLE FOODS 101", 20000, cat); // $200 by the 10th: pace $600
        let got: Vec<_> = db
            .run("2026-11-10", false)
            .into_iter()
            .filter(|n| n.key.starts_with("pace:"))
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "Groceries is on pace to overspend");
        assert_eq!(got[0].body, "On pace for $600.00 of $450.00 in November");
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        db.run("2026-11-01", true);
        db.set(|c| c.budget_on_pace = false);
        spend(&db, "2026-11-09", "WHOLE FOODS 101", 20000, cat);
        assert!(db
            .keys("2026-11-10")
            .iter()
            .all(|k| !k.starts_with("pace:")));
    }

    #[test]
    fn a_category_paid_by_monthly_bills_is_not_projected_forward() {
        let db = Db::setup();
        let cat = groceries(&db, 2500); // a $25 budget, like Streaming
        db.netflix(&[1799, 1799, 1799]);
        db.conn
            .execute("UPDATE transactions SET category_id = ?1", [cat])
            .unwrap();
        db.run("2026-11-01", true);
        let id = db.add("2026-11-05", "NETFLIX.COM 866", -1799);
        recurrings::match_new(&db.conn, &[id]).unwrap();
        db.conn
            .execute(
                "UPDATE transactions SET category_id = ?1 WHERE id = ?2",
                [cat, id],
            )
            .unwrap();
        // $17.99 by the 10th would project to $53.97 if it were everyday spending; it's the month's one bill.
        assert!(db
            .keys("2026-11-10")
            .iter()
            .all(|k| !k.starts_with("pace:")));
    }

    #[test]
    fn the_monthly_recap_comes_on_days_1_to_3_for_the_previous_month() {
        let db = Db::setup();
        let cat = groceries(&db, 45000);
        spend(&db, "2026-10-12", "WHOLE FOODS 101", 31260, cat);
        db.run("2026-10-31", true);
        assert!(db
            .keys("2026-10-31")
            .iter()
            .all(|k| !k.starts_with("recap:")));
        let got: Vec<_> = db
            .run("2026-11-02", false)
            .into_iter()
            .filter(|n| n.kind == Kind::MonthlyRecap)
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].key, "recap:2026-10");
        assert_eq!(got[0].title, "Your October recap");
        assert_eq!(
            got[0].body,
            "Spent $312.60 of $450.00 budgeted ($137.40 under). Top category: Groceries."
        );
        assert_eq!(
            got[0].target,
            json!({ "kind": "category", "id": null, "month": "2026-10" })
        );
        let late = Db::setup();
        late.run("2026-11-01", true);
        assert!(
            late.keys("2026-11-04")
                .iter()
                .all(|k| !k.starts_with("recap:")),
            "day 4 is too late"
        );
    }

    #[test]
    fn the_review_digest_comes_on_the_chosen_day_when_enough_wait() {
        let db = Db::setup();
        db.run("2026-11-01", true);
        for i in 0..4 {
            db.add("2026-11-20", &format!("SHOP NUMBER {i}"), -100 - i);
        }
        assert!(
            db.keys("2026-11-23")
                .iter()
                .all(|k| !k.starts_with("digest:")),
            "Monday, but only 4 to review"
        );
        db.add("2026-11-21", "ONE MORE SHOP", -200);
        let got: Vec<_> = db
            .run("2026-11-23", false)
            .into_iter()
            .filter(|n| n.kind == Kind::ReviewDigest)
            .collect();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "5 transactions to review");
        assert_eq!(
            got[0].target,
            json!({ "kind": "transactions", "filter": "review" })
        );
        assert!(
            db.keys("2026-11-24")
                .iter()
                .all(|k| !k.starts_with("digest:")),
            "Tuesday"
        );
    }
}

mod in_another_currency {
    use super::*;

    fn show_inr(db: &Db) {
        slaybudget_core::settings::set(&db.conn, "display_currency", "INR").unwrap();
        slaybudget_core::fx::refresh_display(&db.conn).unwrap();
    }

    #[test]
    fn a_steady_bill_is_not_a_price_increase_just_because_the_exchange_rate_moved() {
        let db = Db::setup();
        show_inr(&db);
        db.netflix(&[1799, 1799, 1799]);
        db.run("2026-10-20", true);
        db.netflix_more("2026-11-05", 1799);
        assert!(db
            .run("2026-11-08", false)
            .iter()
            .all(|n| n.kind != Kind::PriceUp));
    }

    #[test]
    fn amounts_and_thresholds_are_in_the_display_currency() {
        let db = Db::setup();
        show_inr(&db);
        db.set(|c| c.large_cents = 5_000_000); // ₹50,000
        db.run("2026-11-01", true);
        db.add("2026-11-19", "APPLE STORE #R123", -60000); // $600: over ₹50,000
        db.add("2026-11-19", "TRADER JOES", -4999); // $49.99: under
        let got: Vec<_> = db
            .run("2026-11-20", false)
            .into_iter()
            .filter(|n| n.kind == Kind::LargeTransaction)
            .collect();
        assert_eq!(got.len(), 1);
        assert!(got[0].body.starts_with('₹'), "{}", got[0].body);
        assert!(
            got[0].body.ends_with("at Apple Store on Thu, Nov 19"),
            "{}",
            got[0].body
        );
    }
}
