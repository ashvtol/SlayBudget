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
