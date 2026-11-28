use chrono::NaiveDate;
use slaybudget_core::analytics::recurring::Cadence;
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::recurrings::{self, MatchKind, NewRecurring, Status};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, TxType};

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

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

impl Db {
    fn add(&self, date: &str, description: &str, cents: i64) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: d(date),
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
    fn link(&self, id: i64) -> Option<i64> {
        transactions::get(&self.conn, id).unwrap().recurring_id
    }
    fn netflix_history(&self) -> Vec<i64> {
        [
            "2026-02-05",
            "2026-03-05",
            "2026-04-06",
            "2026-05-05",
            "2026-06-05",
        ]
        .iter()
        .map(|day| self.add(day, "NETFLIX.COM 866", -1799))
        .collect()
    }
}

fn netflix() -> NewRecurring {
    NewRecurring {
        name: "Netflix".into(),
        category_id: None,
        match_kind: MatchKind::Merchant,
        pattern: "netflix.com".into(),
        min_cents: 1500,
        max_cents: 2200,
        frequency: Cadence::Monthly,
        day_of_month: Some(5),
        also_matches: Vec::new(),
        paid_back_by: None,
    }
}

#[test]
fn creating_links_past_charges_that_fit_the_rules() {
    let db = setup();
    let charges = db.netflix_history();
    let other_amount = db.add("2026-05-20", "NETFLIX.COM 866", -9999); // outside the amount range
    let wrong_day = db.add("2026-05-20", "NETFLIX.COM 866", -1799); // 15 days off
    assert_eq!(recurrings::preview_count(&db.conn, &netflix()).unwrap(), 5);
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    for c in &charges {
        assert_eq!(db.link(*c), Some(id));
    }
    assert_eq!(db.link(other_amount), None);
    assert_eq!(db.link(wrong_day), None);
}

#[test]
fn contains_rules_and_any_day() {
    let db = setup();
    let a = db.add("2026-05-01", "UBER *TRIP 1", -1500);
    let b = db.add("2026-05-17", "UBER *TRIP 2", -1700);
    let r = NewRecurring {
        match_kind: MatchKind::Contains,
        pattern: "uber trip".into(),
        day_of_month: None,
        ..netflix()
    };
    let id = recurrings::create(&db.conn, &r).unwrap();
    assert_eq!((db.link(a), db.link(b)), (Some(id), Some(id)));
}

#[test]
fn only_regular_charges_match() {
    let db = setup();
    let refund = db.add("2026-05-05", "NETFLIX.COM 866", 1799);
    let moved = db.add("2026-06-05", "NETFLIX.COM 866", -1799);
    transactions::set_type(&db.conn, &[moved], TxType::Transfer).unwrap();
    recurrings::create(&db.conn, &netflix()).unwrap();
    assert_eq!((db.link(refund), db.link(moved)), (None, None));
}

#[test]
fn editing_rematches_and_reports_changes() {
    let db = setup();
    let charges = db.netflix_history();
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    let narrower = NewRecurring {
        min_cents: 1800,
        ..netflix()
    };
    let report = recurrings::update(&db.conn, id, &narrower).unwrap();
    assert_eq!((report.added, report.removed), (0, 5));
    assert_eq!(db.link(charges[0]), None);
}

#[test]
fn not_recurring_unlinks_and_stays_out() {
    let db = setup();
    let charges = db.netflix_history();
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    recurrings::unlink(&db.conn, charges[0]).unwrap();
    assert_eq!(db.link(charges[0]), None);
    recurrings::rematch(&db.conn, id).unwrap();
    assert_eq!(db.link(charges[0]), None);
}

#[test]
fn status_changes_and_delete_keep_transactions() {
    let db = setup();
    let charges = db.netflix_history();
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    recurrings::set_status(&db.conn, id, Status::Paused).unwrap();
    assert_eq!(
        recurrings::get(&db.conn, id).unwrap().status,
        Status::Paused
    );
    recurrings::set_status(&db.conn, id, Status::Archived).unwrap();
    recurrings::delete(&db.conn, id).unwrap();
    assert!(recurrings::list(&db.conn).unwrap().is_empty());
    let t = transactions::get(&db.conn, charges[0]).unwrap();
    assert_eq!((t.recurring_id, t.amount_cents), (None, -1799));
}

#[test]
fn a_new_charge_links_on_import_and_reactivates_a_paused_bill() {
    let db = setup();
    db.netflix_history();
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    recurrings::set_status(&db.conn, id, Status::Paused).unwrap();
    let row = slaybudget_core::import::ParsedRow {
        posted_on: d("2026-07-05"),
        description: "NETFLIX.COM 866".into(),
        amount_cents: -1799,
        occurrence: 0,
        pending: false,
        raw_category: None,
        details: Vec::new(),
    };
    pipeline::import_rows(
        &db.conn,
        db.p,
        db.s,
        "july.csv",
        "hash-july",
        pipeline::StatementKind::Card,
        vec![row],
    )
    .unwrap();
    let new_id: i64 = db
        .conn
        .query_row(
            "SELECT id FROM transactions WHERE posted_on = '2026-07-05'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(db.link(new_id), Some(id));
    assert_eq!(
        recurrings::get(&db.conn, id).unwrap().status,
        Status::Active
    );
}

#[test]
fn seeding_saves_detected_bills_once() {
    let db = setup();
    db.netflix_history();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 1);
    let saved = recurrings::list(&db.conn).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].frequency, Cadence::Monthly);
    assert_eq!(saved[0].status, Status::Active);
    // Linked, and seeding never runs again.
    let linked: i64 = db
        .conn
        .query_row(
            "SELECT count(*) FROM transactions WHERE recurring_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(linked, 5);
    recurrings::delete(&db.conn, saved[0].id).unwrap();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 0);
}

#[test]
fn suggestions_are_detected_bills_not_saved_or_dismissed() {
    let db = setup();
    db.netflix_history();
    for day in ["2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"] {
        db.add(day, "GEICO AUTO", -12000);
    }
    recurrings::create(&db.conn, &netflix()).unwrap();
    let s = recurrings::suggestions(&db.conn, None).unwrap();
    assert_eq!(
        s.iter().map(|r| r.merchant.as_str()).collect::<Vec<_>>(),
        vec!["geico auto"]
    );
    recurrings::dismiss(&db.conn, "geico auto").unwrap();
    assert!(recurrings::suggestions(&db.conn, None).unwrap().is_empty());
}

#[test]
fn views_carry_the_saved_rule_and_charges() {
    let db = setup();
    let cat = categories::find_by_legacy_name(&db.conn, "Subscriptions")
        .unwrap()
        .unwrap()
        .id;
    db.netflix_history();
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            category_id: Some(cat),
            ..netflix()
        },
    )
    .unwrap();
    let views = recurrings::views(&db.conn, None).unwrap();
    assert_eq!(views.len(), 1);
    let v = &views[0];
    assert_eq!(v.saved.as_ref().unwrap().id, id);
    assert_eq!(
        (v.occurrences, v.typical_amount_cents, v.category_id),
        (5, 1799, Some(cat))
    );
    assert_eq!(
        (v.last_date, v.next_date),
        (d("2026-06-05"), d("2026-07-05"))
    );
}

#[test]
fn draft_from_a_transaction_prefills_the_form() {
    let db = setup();
    let charges = db.netflix_history();
    let draft = recurrings::draft_from_transaction(&db.conn, charges[4]).unwrap();
    assert_eq!(draft.match_kind, MatchKind::Merchant);
    assert_eq!(draft.pattern, "netflix.com");
    assert_eq!((draft.min_cents, draft.max_cents), (1439, 2159)); // ±20%
    assert_eq!(
        (draft.frequency, draft.day_of_month),
        (Cadence::Monthly, Some(5))
    );
}

#[test]
fn filters_transactions_by_saved_recurring() {
    let db = setup();
    db.netflix_history();
    db.add("2026-05-10", "GEICO AUTO", -12000);
    let id = recurrings::create(&db.conn, &netflix()).unwrap();
    let f = transactions::TransactionFilter {
        recurring_ids: vec![id],
        ..Default::default()
    };
    assert_eq!(transactions::count(&db.conn, &f).unwrap(), 5);
}

#[test]
fn seeding_uses_any_day_when_charges_wander() {
    let db = setup();
    for day in [
        "2026-02-01",
        "2026-03-06",
        "2026-04-04",
        "2026-05-10",
        "2026-06-06",
    ] {
        db.add(day, "ADOBE ADOBE", -1100);
    }
    recurrings::seed_if_needed(&db.conn).unwrap();
    let saved = recurrings::list(&db.conn).unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].day_of_month, None);
    let linked: i64 = db
        .conn
        .query_row(
            "SELECT count(*) FROM transactions WHERE recurring_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(linked, 5);
}

#[test]
fn an_empty_database_seeds_later_once_it_has_transactions() {
    let db = setup();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 0);
    db.netflix_history();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 1);
}

#[test]
fn the_day_window_knows_month_lengths() {
    let db = setup();
    let feb = db.add("2026-02-28", "NETFLIX.COM 866", -1799); // 1 day before Mar 1
    let apr = db.add("2026-04-30", "NETFLIX.COM 866", -1799); // 1 day before May 1
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            day_of_month: Some(1),
            ..netflix()
        },
    )
    .unwrap();
    assert_eq!((db.link(feb), db.link(apr)), (Some(id), Some(id)));
    let late = db.add("2026-02-26", "NETFLIX.COM 866", -1799); // 2 days before day 28... of a 30th bill
    let id30 = recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "B".into(),
            day_of_month: Some(30),
            ..netflix()
        },
    )
    .unwrap();
    // Feb has no 30th: due on the 28th, so the 26th is 2 days early.
    assert_eq!(db.link(late), Some(id30));
}

#[test]
fn changing_a_charge_to_a_transfer_unlinks_it() {
    let db = setup();
    let charges = db.netflix_history();
    recurrings::create(&db.conn, &netflix()).unwrap();
    transactions::set_type(&db.conn, &[charges[0]], TxType::Transfer).unwrap();
    assert_eq!(db.link(charges[0]), None);
}

#[test]
fn a_profile_only_sees_bills_with_its_charges() {
    let db = setup();
    db.netflix_history();
    recurrings::create(&db.conn, &netflix()).unwrap();
    let other = profiles::create(&db.conn, "Sam", None).unwrap();
    assert!(recurrings::views(&db.conn, Some(other)).unwrap().is_empty());
    assert_eq!(recurrings::views(&db.conn, Some(db.p)).unwrap().len(), 1);
}

#[test]
fn the_first_import_into_an_empty_database_saves_its_bills() {
    let db = setup();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 0);
    let rows: Vec<_> = ["2026-02-05", "2026-03-05", "2026-04-06", "2026-05-05"]
        .iter()
        .map(|day| slaybudget_core::import::ParsedRow {
            posted_on: d(day),
            description: "NETFLIX.COM 866".into(),
            amount_cents: -1799,
            occurrence: 0,
            pending: false,
            raw_category: None,
            details: Vec::new(),
        })
        .collect();
    pipeline::import_rows(
        &db.conn,
        db.p,
        db.s,
        "jan-may.csv",
        "hash-1",
        pipeline::StatementKind::Card,
        rows,
    )
    .unwrap();
    assert_eq!(recurrings::list(&db.conn).unwrap().len(), 1);
}

#[test]
fn a_bill_paid_a_few_days_early_is_not_due_again_that_month() {
    let db = setup();
    // Due on the 1st; October's charge, then November's paid two days early, on Oct 30.
    db.add("2026-10-01", "NETFLIX.COM 866", -1799);
    db.add("2026-10-30", "NETFLIX.COM 866", -1799);
    recurrings::create(
        &db.conn,
        &NewRecurring {
            day_of_month: Some(1),
            ..netflix()
        },
    )
    .unwrap();
    let view = recurrings::views(&db.conn, Some(db.p))
        .unwrap()
        .into_iter()
        .find(|r| r.saved.is_some())
        .unwrap();
    assert_eq!(view.last_date, d("2026-10-30"));
    assert_eq!(
        view.next_date,
        d("2026-12-01"),
        "Oct 30 paid November's bill"
    );
}

#[test]
fn a_bill_paid_on_time_or_late_is_next_due_on_its_day() {
    let db = setup();
    db.add("2026-10-07", "NETFLIX.COM 866", -1799);
    recurrings::create(&db.conn, &netflix()).unwrap();
    let view = recurrings::views(&db.conn, Some(db.p))
        .unwrap()
        .into_iter()
        .find(|r| r.saved.is_some())
        .unwrap();
    assert_eq!(view.next_date, d("2026-11-05"));
}

#[test]
fn seeding_is_all_or_nothing() {
    let db = setup();
    db.netflix_history();
    // Make the last step (remembering that seeding ran) fail.
    db.conn
        .execute_batch(
            "CREATE TRIGGER fail_seed BEFORE INSERT ON settings WHEN NEW.key = 'recurrings_seeded'
             BEGIN SELECT RAISE(ABORT, 'disk full'); END;",
        )
        .unwrap();
    assert!(recurrings::seed_if_needed(&db.conn).is_err());
    let bills: i64 = db
        .conn
        .query_row("SELECT count(*) FROM recurrings", [], |r| r.get(0))
        .unwrap();
    let linked: i64 = db
        .conn
        .query_row(
            "SELECT count(*) FROM transactions WHERE recurring_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        (bills, linked),
        (0, 0),
        "a failed seeding leaves nothing half done"
    );

    // Once it can finish, it seeds as normal.
    db.conn.execute_batch("DROP TRIGGER fail_seed;").unwrap();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 1);
}

#[test]
fn seeding_works_inside_a_caller_transaction() {
    let db = setup();
    db.netflix_history();
    db.conn.execute_batch("BEGIN").unwrap();
    assert_eq!(recurrings::seed_if_needed(&db.conn).unwrap(), 1);
    db.conn.execute_batch("COMMIT").unwrap();
}

#[test]
fn a_bill_paid_every_few_years_is_next_due_that_many_years_on() {
    let db = setup();
    db.add("2025-03-18", "NORDVPN SUBSCRIPTION", -10430);
    for (frequency, years, next) in [
        (Cadence::Biennial, 2, "2027-03-18"),
        (Cadence::Triennial, 3, "2028-03-18"),
        (Cadence::Quadrennial, 4, "2029-03-18"),
    ] {
        let rule = NewRecurring {
            name: "NordVPN".into(),
            category_id: None,
            match_kind: MatchKind::Contains,
            pattern: "nordvpn".into(),
            min_cents: 8344,
            max_cents: 12516,
            frequency,
            day_of_month: Some(18),
            also_matches: Vec::new(),
            paid_back_by: None,
        };
        let id = recurrings::create(&db.conn, &rule).unwrap();
        assert_eq!(recurrings::get(&db.conn, id).unwrap().frequency, frequency);
        // Stored as yearly with a count of years, so older versions' checks still hold.
        let stored: (String, i64) = db
            .conn
            .query_row(
                "SELECT frequency, every_years FROM recurrings WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(stored, ("yearly".to_string(), years));
        let view = recurrings::views(&db.conn, Some(db.p))
            .unwrap()
            .into_iter()
            .find(|r| r.saved.as_ref().is_some_and(|s| s.id == id))
            .unwrap();
        assert_eq!(view.next_date, d(next));
        recurrings::delete(&db.conn, id).unwrap();
    }
}

fn walmart(pattern: &str) -> NewRecurring {
    NewRecurring {
        name: "Walmart+".into(),
        category_id: None,
        match_kind: MatchKind::Merchant,
        pattern: pattern.into(),
        min_cents: 900,
        max_cents: 1900,
        frequency: Cadence::Monthly,
        day_of_month: Some(22),
        also_matches: Vec::new(),
        paid_back_by: None,
    }
}

#[test]
fn a_bill_also_matches_its_other_names_and_keeps_them_when_edited() {
    let db = setup();
    let old = db.add("2025-07-22", "WMT PLUS Jul 2025", -1427);
    let new = db.add("2026-07-22", "WALMART+ MEMBER 07/2", -1428);
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            also_matches: vec!["WMT Plus".into()],
            ..walmart("walmart+ member")
        },
    )
    .unwrap();
    assert_eq!(db.link(old), Some(id));
    assert_eq!(db.link(new), Some(id));
    let saved = recurrings::get(&db.conn, id).unwrap();
    assert_eq!(saved.also_matches, vec!["wmt plus".to_string()]);
    recurrings::update(
        &db.conn,
        id,
        &NewRecurring {
            max_cents: 2000,
            ..walmart("walmart+ member")
        },
    )
    .unwrap();
    assert_eq!(
        db.link(old),
        None,
        "an edit that drops the other name drops its charges"
    );
    recurrings::update(
        &db.conn,
        id,
        &NewRecurring {
            also_matches: vec!["wmt plus".into()],
            ..walmart("walmart+ member")
        },
    )
    .unwrap();
    assert_eq!(db.link(old), Some(id));
}

#[test]
fn paid_back_by_is_kept_and_can_be_set_alone() {
    let db = setup();
    let charge = db.add("2026-07-22", "WALMART+ MEMBER 07/2", -1428);
    let id = recurrings::create(&db.conn, &walmart("walmart+ member")).unwrap();
    assert_eq!(
        recurrings::get(&db.conn, id).unwrap().paid_back_by,
        None,
        "never decided"
    );
    recurrings::set_paid_back_by(&db.conn, id, Some(vec!["Platinum Walmart+".into()])).unwrap();
    let saved = recurrings::get(&db.conn, id).unwrap();
    assert_eq!(
        saved.paid_back_by,
        Some(vec!["platinum walmart+".to_string()])
    );
    assert_eq!(
        db.link(charge),
        Some(id),
        "setting credits leaves the charges alone"
    );
    recurrings::set_paid_back_by(&db.conn, id, Some(Vec::new())).unwrap();
    assert_eq!(
        recurrings::get(&db.conn, id).unwrap().paid_back_by,
        Some(Vec::new()),
        "declined"
    );
}

#[test]
fn merging_bills_keeps_every_name_and_the_credits() {
    let db = setup();
    let old = db.add("2025-07-22", "WMT PLUS Jul 2025", -1427);
    let new = db.add("2026-07-22", "WALMART+ MEMBER 07/2", -1428);
    let a = recurrings::create(&db.conn, &walmart("wmt plus")).unwrap();
    let b = recurrings::create(
        &db.conn,
        &NewRecurring {
            paid_back_by: Some(vec!["platinum walmart+".into()]),
            ..walmart("walmart+ member")
        },
    )
    .unwrap();
    let kept = slaybudget_core::price_changes::merge(&db.conn, a, b).unwrap();
    assert_eq!(kept, a);
    let saved = recurrings::get(&db.conn, kept).unwrap();
    assert_eq!(saved.also_matches, vec!["walmart+ member".to_string()]);
    assert_eq!(
        saved.paid_back_by,
        Some(vec!["platinum walmart+".to_string()])
    );
    recurrings::update(&db.conn, kept, &recurrings_rule(&saved)).unwrap();
    assert_eq!(
        (db.link(old), db.link(new)),
        (Some(a), Some(a)),
        "editing the merged bill keeps both names' charges"
    );
}

fn recurrings_rule(s: &recurrings::SavedRecurring) -> NewRecurring {
    NewRecurring {
        name: s.name.clone(),
        category_id: s.category_id,
        match_kind: s.match_kind,
        pattern: s.pattern.clone(),
        min_cents: s.min_cents,
        max_cents: s.max_cents,
        frequency: s.frequency,
        day_of_month: s.day_of_month,
        also_matches: s.also_matches.clone(),
        paid_back_by: s.paid_back_by.clone(),
    }
}

#[test]
fn a_bill_follows_when_you_recategorize_its_charges() {
    use slaybudget_core::categorize::recategorize;
    let db = setup();
    let cat = |n: &str| {
        categories::find_by_legacy_name(&db.conn, n)
            .unwrap()
            .unwrap()
            .id
    };
    let (fuel, fun) = (cat("Groceries"), cat("Restaurants"));
    let charges: Vec<i64> = ["2026-08-04", "2026-08-11", "2026-08-18"]
        .iter()
        .map(|d| db.add(d, "SHELL OIL 123", -1680))
        .collect();
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            category_id: Some(fuel),
            day_of_month: None,
            ..walmart("shell oil 123")
        },
    )
    .unwrap();
    let bill_category = || recurrings::get(&db.conn, id).unwrap().category_id;
    recategorize::set_only(&db.conn, charges[0], fun).unwrap();
    assert_eq!(
        bill_category(),
        Some(fuel),
        "an older charge alone doesn't move the bill"
    );
    recategorize::apply(&db.conn, &charges, fun).unwrap();
    assert_eq!(
        bill_category(),
        Some(fun),
        "the latest charge's category is the bill's"
    );
    recategorize::change_category(&db.conn, charges[2], fuel).unwrap();
    assert_eq!(bill_category(), Some(fuel));
}

fn nespresso() -> NewRecurring {
    NewRecurring {
        name: "Nespresso".into(),
        category_id: None,
        match_kind: MatchKind::Contains,
        pattern: "nespresso".into(),
        min_cents: 4665,
        max_cents: 9635,
        frequency: Cadence::Monthly,
        day_of_month: Some(8),
        also_matches: Vec::new(),
        paid_back_by: None,
    }
}

#[test]
fn a_charge_off_its_usual_day_links_when_the_bill_has_none_that_month() {
    let db = setup();
    let ids: Vec<i64> = ["2026-07-02", "2026-08-01", "2026-09-01", "2026-10-08"]
        .iter()
        .map(|d| db.add(d, "NESPRESSO 888", -7150))
        .collect();
    let extra = db.add("2026-10-20", "NESPRESSO 888", -7150);
    let id = recurrings::create(&db.conn, &nespresso()).unwrap();
    for t in &ids {
        assert_eq!(
            db.link(*t),
            Some(id),
            "each month's one charge belongs to the bill"
        );
    }
    assert_eq!(
        db.link(extra),
        None,
        "October already has its charge on the usual day"
    );
    // A new statement: November's charge comes on the 23rd.
    let nov = db.add("2026-11-23", "NESPRESSO 888", -7140);
    recurrings::after_import(&db.conn).unwrap();
    assert_eq!(db.link(nov), Some(id));
}

#[test]
fn opening_the_app_links_charges_the_old_rules_skipped() {
    let db = setup();
    let id = recurrings::create(&db.conn, &nespresso()).unwrap();
    let skipped = db.add("2026-09-01", "NESPRESSO 888", -7560);
    db.conn
        .execute(
            "UPDATE transactions SET recurring_id = NULL WHERE id = ?1",
            [skipped],
        )
        .unwrap();
    recurrings::link_unlinked(&db.conn).unwrap();
    assert_eq!(db.link(skipped), Some(id));
}

#[test]
fn a_payment_app_charge_off_the_usual_day_is_not_taken_for_the_bill() {
    let db = setup();
    let on_day = db.add("2026-10-28", "VENMO 8555550100", -4768);
    let other_payment = db.add("2026-12-22", "VENMO 8555550100", -4250);
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "Venmo".into(),
            match_kind: MatchKind::Contains,
            pattern: "venmo".into(),
            min_cents: 3000,
            max_cents: 6500,
            day_of_month: Some(28),
            ..nespresso()
        },
    )
    .unwrap();
    assert_eq!(db.link(on_day), Some(id));
    assert_eq!(
        db.link(other_payment),
        None,
        "a payment to anyone: only the due day says it's the bill"
    );
}

#[test]
fn make_recurring_on_a_payment_app_charge_matches_the_person() {
    let db = setup();
    let sam = db.add(
        "2026-10-28",
        "Debit Card Purchase 10/26 02:15p #1234 VENMO *SAM RIVERA 8555550100 NY 26300",
        -4768,
    );
    let draft = recurrings::draft_from_transaction(&db.conn, sam).unwrap();
    assert_eq!(
        (
            draft.match_kind,
            draft.pattern.as_str(),
            draft.name.as_str()
        ),
        (MatchKind::Contains, "sam rivera", "Sam Rivera")
    );
    let netflix = db.add("2026-10-05", "NETFLIX.COM 866", -1799);
    assert_eq!(
        recurrings::draft_from_transaction(&db.conn, netflix)
            .unwrap()
            .match_kind,
        MatchKind::Merchant
    );
    let shell = db.add("2026-10-19", "SHELL OIL 12345678901 ANYTOWN WA", -1628);
    assert_eq!(
        recurrings::draft_from_transaction(&db.conn, shell)
            .unwrap()
            .match_kind,
        MatchKind::Merchant
    );
}

#[test]
fn a_quarterly_bill_charged_off_its_day_links_once_a_quarter() {
    let db = setup();
    let ids: Vec<i64> = ["2026-01-10", "2026-04-02", "2026-07-25"]
        .iter()
        .map(|d| db.add(d, "NESPRESSO 888", -7150))
        .collect();
    let extra = db.add("2026-07-28", "NESPRESSO 888", -7150);
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            frequency: Cadence::Quarterly,
            day_of_month: Some(10),
            ..nespresso()
        },
    )
    .unwrap();
    for t in &ids {
        assert_eq!(db.link(*t), Some(id));
    }
    assert_eq!(
        db.link(extra),
        None,
        "July's quarter already has its charge"
    );
}

#[test]
fn opening_the_app_links_nothing_to_an_archived_bill() {
    let db = setup();
    let id = recurrings::create(&db.conn, &nespresso()).unwrap();
    recurrings::set_status(&db.conn, id, Status::Archived).unwrap();
    let charge = db.add("2026-09-08", "NESPRESSO 888", -7150);
    recurrings::link_unlinked(&db.conn).unwrap();
    assert_eq!(db.link(charge), None);
}

#[test]
fn a_bill_that_names_the_person_takes_their_payment_app_charges_off_its_day() {
    let db = setup();
    let sam = db.add("2026-10-03", "VENMO *SAM RIVERA 8555550100 NY", -4156);
    let someone_else = db.add("2026-11-16", "VENMO *JORDAN LEE 8555550100 NY", -4200);
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "Sam".into(),
            pattern: "sam rivera".into(),
            min_cents: 3800,
            max_cents: 5700,
            day_of_month: Some(28),
            ..nespresso()
        },
    )
    .unwrap();
    assert_eq!(db.link(sam), Some(id));
    assert_eq!(db.link(someone_else), None);
}

#[test]
fn make_recurring_reads_the_person_from_a_zelle_payment() {
    let db = setup();
    let t = db.add("2026-10-01", "ZELLE PAYMENT TO JANE DOE 1234567890", -50000);
    let draft = recurrings::draft_from_transaction(&db.conn, t).unwrap();
    assert_eq!(
        (draft.match_kind, draft.pattern.as_str()),
        (MatchKind::Contains, "jane doe")
    );
}

#[test]
fn merging_two_paid_back_bills_keeps_both_credit_names() {
    let db = setup();
    db.add("2025-07-22", "WMT PLUS Jul 2025", -1427);
    db.add("2026-07-22", "WALMART+ MEMBER 07/2", -1428);
    let a = recurrings::create(
        &db.conn,
        &NewRecurring {
            paid_back_by: Some(vec!["amex walmart".into()]),
            ..walmart("wmt plus")
        },
    )
    .unwrap();
    let b = recurrings::create(
        &db.conn,
        &NewRecurring {
            paid_back_by: Some(vec!["platinum walmart+".into()]),
            ..walmart("walmart+ member")
        },
    )
    .unwrap();
    slaybudget_core::price_changes::merge(&db.conn, a, b).unwrap();
    assert_eq!(
        recurrings::get(&db.conn, a).unwrap().paid_back_by,
        Some(vec![
            "amex walmart".to_string(),
            "platinum walmart+".to_string()
        ])
    );
}

#[test]
fn the_preview_lists_the_charges_a_rule_would_claim() {
    let db = setup();
    let charges = db.netflix_history();
    let other = db.add("2026-05-20", "NETFLIX.COM 866", -9999); // outside the amount range
    let ids = recurrings::preview_matches(&db.conn, &netflix()).unwrap();
    assert_eq!(ids, charges, "oldest first, only what fits");
    assert!(!ids.contains(&other));
    assert_eq!(recurrings::preview_count(&db.conn, &netflix()).unwrap(), 5);
}

#[test]
fn creating_a_bill_can_leave_out_charges_you_untick() {
    let db = setup();
    let charges = db.netflix_history();
    let id = recurrings::create_except(&db.conn, &netflix(), &[charges[1], charges[3]]).unwrap();
    let linked: Vec<i64> = charges
        .iter()
        .copied()
        .filter(|c| db.link(*c) == Some(id))
        .collect();
    assert_eq!(linked, vec![charges[0], charges[2], charges[4]]);
    // Left out for good: rematching the bill doesn't claim them again.
    recurrings::rematch(&db.conn, id).unwrap();
    assert_eq!(db.link(charges[1]), None);
    assert_eq!(db.link(charges[3]), None);
}

#[test]
fn leaving_out_nothing_is_the_same_as_creating() {
    let db = setup();
    let charges = db.netflix_history();
    let id = recurrings::create_except(&db.conn, &netflix(), &[]).unwrap();
    assert!(charges.iter().all(|c| db.link(*c) == Some(id)));
}
