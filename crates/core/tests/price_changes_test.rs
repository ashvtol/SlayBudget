use chrono::NaiveDate;
use slaybudget_core::analytics::recurring::Cadence;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::notifications::{config::Config, producers, Kind};
use slaybudget_core::price_changes::{self, Answer, Direction, PriceChange};
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::recurrings::{self, MatchKind, NewRecurring};
use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction};
use slaybudget_core::undo::UndoStack;

const CLAUDE: &str = "ANTHROPIC* CLAUDE SUSAN FRANCISCO CA";

pub struct Db {
    pub conn: rusqlite::Connection,
    p: i64,
    s: i64,
}

impl Db {
    pub fn setup() -> Db {
        let conn = open_in_memory().unwrap();
        let p = profiles::create(&conn, "Alex", None).unwrap();
        let s = profiles::find_or_create_source(&conn, p, "Visa", SourceKind::Csv).unwrap();
        // Recurrings are saved by hand in these tests, not seeded from history.
        slaybudget_core::settings::set(&conn, "recurrings_seeded", "1").unwrap();
        Db { conn, p, s }
    }
    pub fn charge(&self, date: &str, description: &str, cents: i64) -> i64 {
        let tx = NewTransaction {
            profile_id: self.p,
            source_id: self.s,
            posted_on: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            description: description.into(),
            amount_cents: -cents,
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
    /// Anthropic Claude at $22.11 on the 5th, June to November, saved as a monthly bill (range $14.41 to $29.81).
    pub fn anthropic(&self) -> i64 {
        for m in 6..=11 {
            self.charge(&format!("2026-{m:02}-05"), CLAUDE, 2211);
        }
        recurrings::create(
            &self.conn,
            &NewRecurring {
                name: "Anthropic Claude".into(),
                category_id: None,
                match_kind: MatchKind::Merchant,
                pattern: "anthropic claude".into(),
                min_cents: 1441,
                max_cents: 2981,
                frequency: Cadence::Monthly,
                day_of_month: Some(5),
                also_matches: Vec::new(),
                paid_back_by: None,
            },
        )
        .unwrap()
    }
    pub fn import_done(&self) {
        recurrings::after_import(&self.conn).unwrap();
    }
    /// The second "Anthropic Claude" bill made for the upgrade: contains "anthropic claude", $20 to $120.22, any day.
    pub fn second_anthropic(&self) -> (i64, i64) {
        let upgrade = self.charge("2026-11-21", CLAUDE, 10018);
        let id = recurrings::create(
            &self.conn,
            &NewRecurring {
                name: "Anthropic Claude".into(),
                category_id: None,
                match_kind: MatchKind::Contains,
                pattern: "anthropic claude".into(),
                min_cents: 2000,
                max_cents: 12022,
                frequency: Cadence::Monthly,
                day_of_month: None,
                also_matches: Vec::new(),
                paid_back_by: None,
            },
        )
        .unwrap();
        (id, upgrade)
    }
    pub fn open(&self) -> Vec<price_changes::PriceCheck> {
        price_changes::open_checks(&self.conn).unwrap()
    }
    pub fn count(&self, bill: i64) -> i64 {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM transactions WHERE recurring_id = ?1",
                [bill],
                |r| r.get(0),
            )
            .unwrap()
    }
    pub fn linked(&self, tx: i64) -> Option<i64> {
        transactions::get(&self.conn, tx).unwrap().recurring_id
    }
}

#[test]
fn an_increase_beyond_the_range_is_asked_about_and_marked_to_review() {
    let db = Db::setup();
    let bill = db.anthropic();
    let upgrade = db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    let checks = price_changes::open_checks(&db.conn).unwrap();
    assert_eq!(checks.len(), 1);
    let c = &checks[0];
    assert_eq!(
        (
            c.tx_id,
            c.recurring_id,
            c.old_cents,
            c.new_cents,
            c.direction
        ),
        (upgrade, bill, 2211, 10018, Direction::Up)
    );
    assert_eq!(db.linked(upgrade), None, "not linked until you say so");
    assert!(!transactions::get(&db.conn, upgrade).unwrap().reviewed);
    assert_eq!(
        price_changes::for_transaction(&db.conn, upgrade)
            .unwrap()
            .map(|c| c.id),
        Some(c.id)
    );
}

#[test]
fn a_drop_is_asked_about_too() {
    let db = Db::setup();
    db.anthropic();
    let down = db.charge("2026-12-05", CLAUDE, 500);
    db.import_done();
    let checks = price_changes::open_checks(&db.conn).unwrap();
    assert_eq!(
        (checks.len(), checks[0].tx_id, checks[0].direction),
        (1, down, Direction::Down)
    );
}

#[test]
fn charges_that_fit_other_merchants_and_old_ones_are_not_asked() {
    let db = Db::setup();
    let bill = db.anthropic();
    let fits = db.charge("2026-12-05", CLAUDE, 2400);
    db.charge("2026-12-06", "NETFLIX.COM 866", 9999);
    db.charge("2026-01-09", CLAUDE, 5000); // before the bill's charges
    db.import_done();
    assert_eq!(
        db.linked(fits),
        Some(bill),
        "inside the range: just matched"
    );
    assert!(price_changes::open_checks(&db.conn).unwrap().is_empty());
}

#[test]
fn each_charge_is_asked_about_once() {
    let db = Db::setup();
    db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    db.import_done();
    assert_eq!(price_changes::open_checks(&db.conn).unwrap().len(), 1);
}

#[test]
fn yes_new_price_moves_the_range_and_due_day_and_keeps_the_history() {
    let db = Db::setup();
    let bill = db.anthropic();
    let upgrade = db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    let check = db.open()[0].id;
    assert_eq!(
        price_changes::answer(&db.conn, check, Answer::NewPrice).unwrap(),
        None
    );
    assert_eq!(db.linked(upgrade), Some(bill));
    let s = recurrings::get(&db.conn, bill).unwrap();
    assert_eq!(
        (s.min_cents, s.max_cents, s.day_of_month),
        (6518, 13518, Some(21))
    );
    assert_eq!(
        price_changes::history(&db.conn, bill).unwrap(),
        vec![PriceChange {
            changed_on: "2026-11-21".into(),
            from_cents: 2211,
            to_cents: 10018
        }]
    );
    assert_eq!(db.count(bill), 7, "the old charges stay with the bill");
    assert!(db.open().is_empty());
    let view = recurrings::views(&db.conn, None)
        .unwrap()
        .into_iter()
        .find(|v| v.saved.as_ref().map(|s| s.id) == Some(bill))
        .unwrap();
    assert_eq!(
        view.typical_amount_cents, 10018,
        "the bill shows its new price"
    );
    // The next month's charge just matches.
    let next = db.charge("2026-12-21", CLAUDE, 10018);
    db.import_done();
    assert_eq!((db.linked(next), db.open().len()), (Some(bill), 0));
}

#[test]
fn editing_a_bill_after_a_price_change_keeps_its_older_charges() {
    let db = Db::setup();
    let bill = db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    price_changes::answer(&db.conn, db.open()[0].id, Answer::NewPrice).unwrap();
    let s = recurrings::get(&db.conn, bill).unwrap();
    let mut edit = NewRecurring {
        name: "Claude".into(),
        category_id: None,
        match_kind: s.match_kind,
        pattern: s.pattern.clone(),
        min_cents: s.min_cents,
        max_cents: s.max_cents,
        frequency: s.frequency,
        day_of_month: s.day_of_month,
        also_matches: Vec::new(),
        paid_back_by: None,
    };
    recurrings::update(&db.conn, bill, &edit).unwrap();
    assert_eq!(db.count(bill), 7);
    edit.pattern = "netflix.com".into();
    recurrings::update(&db.conn, bill, &edit).unwrap();
    assert_eq!(
        db.count(bill),
        0,
        "a charge whose name no longer fits still leaves"
    );
}

#[test]
fn a_one_off_stays_unlinked_and_is_not_asked_again() {
    let db = Db::setup();
    let bill = db.anthropic();
    let extra = db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    assert_eq!(
        price_changes::answer(&db.conn, db.open()[0].id, Answer::OneOff).unwrap(),
        None
    );
    db.import_done();
    assert_eq!((db.linked(extra), db.open().len()), (None, 0));
    let s = recurrings::get(&db.conn, bill).unwrap();
    assert_eq!(
        (s.min_cents, s.max_cents),
        (1441, 2981),
        "the bill is unchanged"
    );
    assert!(price_changes::history(&db.conn, bill).unwrap().is_empty());
}

#[test]
fn a_separate_subscription_gets_a_draft_for_its_own_bill() {
    let db = Db::setup();
    db.anthropic();
    let other = db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    let draft = price_changes::answer(&db.conn, db.open()[0].id, Answer::Separate)
        .unwrap()
        .unwrap();
    assert_eq!(
        (draft.pattern.as_str(), draft.day_of_month),
        ("anthropic claude", Some(21))
    );
    assert!(draft.min_cents <= 10018 && draft.max_cents >= 10018);
    assert_eq!((db.linked(other), db.open().len()), (None, 0));
}

#[test]
fn a_check_is_answered_once() {
    let db = Db::setup();
    db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    let id = db.open()[0].id;
    price_changes::answer(&db.conn, id, Answer::OneOff).unwrap();
    assert!(price_changes::answer(&db.conn, id, Answer::NewPrice).is_err());
}

#[test]
fn answering_yes_also_settles_other_charges_at_that_price() {
    let db = Db::setup();
    let bill = db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    let dec = db.charge("2026-12-21", CLAUDE, 10018);
    db.import_done();
    assert_eq!(db.open().len(), 2);
    let nov = db.open().into_iter().find(|c| c.tx_id != dec).unwrap().id;
    price_changes::answer(&db.conn, nov, Answer::NewPrice).unwrap();
    assert_eq!((db.linked(dec), db.open().len()), (Some(bill), 0));
}

#[test]
fn bills_that_share_a_name_are_suggested_for_merging() {
    let db = Db::setup();
    let first = db.anthropic();
    let (second, _) = db.second_anthropic();
    recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "Netflix".into(),
            category_id: None,
            match_kind: MatchKind::Merchant,
            pattern: "netflix.com".into(),
            min_cents: 1000,
            max_cents: 2000,
            frequency: Cadence::Monthly,
            day_of_month: None,
            also_matches: Vec::new(),
            paid_back_by: None,
        },
    )
    .unwrap();
    assert_eq!(
        price_changes::look_alikes(&db.conn).unwrap(),
        vec![(first, second)]
    );
    price_changes::keep_apart(&db.conn, first, second).unwrap();
    assert!(
        price_changes::look_alikes(&db.conn).unwrap().is_empty(),
        "not suggested again"
    );
}

#[test]
fn merging_keeps_the_older_bill_with_every_charge_and_the_newest_price() {
    let db = Db::setup();
    let first = db.anthropic();
    let (second, upgrade) = db.second_anthropic();
    assert_eq!(db.linked(upgrade), Some(second));
    price_changes::merge(&db.conn, second, first).unwrap();
    assert!(recurrings::get(&db.conn, second).is_err(), "one bill left");
    assert_eq!((db.count(first), db.linked(upgrade)), (7, Some(first)));
    let s = recurrings::get(&db.conn, first).unwrap();
    assert_eq!(
        (s.match_kind, s.min_cents, s.max_cents, s.day_of_month),
        (MatchKind::Merchant, 2000, 12022, None),
        "the older bill's rule with the newer one's price and day"
    );
    assert_eq!(
        price_changes::history(&db.conn, first).unwrap(),
        vec![PriceChange {
            changed_on: "2026-11-21".into(),
            from_cents: 2211,
            to_cents: 10018
        }]
    );
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}

#[test]
fn undo_brings_both_bills_back() {
    let db = Db::setup();
    let first = db.anthropic();
    let (second, upgrade) = db.second_anthropic();
    let mut undo = UndoStack::new();
    undo.record(&db.conn, "Merge bills", |c| {
        price_changes::merge(c, first, second)
    })
    .unwrap();
    undo.undo(&db.conn).unwrap();
    assert_eq!(
        (db.count(first), db.count(second), db.linked(upgrade)),
        (6, 1, Some(second))
    );
    assert!(price_changes::history(&db.conn, first).unwrap().is_empty());
}

#[test]
fn your_anthropic_bills_become_one_that_follows_the_200_plan() {
    let db = Db::setup();
    let first = db.anthropic();
    let (second, _) = db.second_anthropic();
    price_changes::merge(&db.conn, first, second).unwrap();
    // The first full $221 month is asked once (it's well past the prorated $100.18); after yes, it just matches.
    let dec = db.charge("2026-12-21", CLAUDE, 22100);
    db.import_done();
    let open = db.open();
    assert_eq!(
        (open.len(), open[0].tx_id, open[0].old_cents),
        (1, dec, 10018)
    );
    price_changes::answer(&db.conn, open[0].id, Answer::NewPrice).unwrap();
    let jan = db.charge("2027-01-21", CLAUDE, 22100);
    db.import_done();
    assert_eq!((db.linked(jan), db.open().len()), (Some(first), 0));
    assert_eq!(price_changes::history(&db.conn, first).unwrap().len(), 2);
}

fn bell(db: &Db, today: &str) -> Vec<(Kind, String, String)> {
    producers::candidates(
        &db.conn,
        &Config::default(),
        NaiveDate::parse_from_str(today, "%Y-%m-%d").unwrap(),
    )
    .unwrap()
    .into_iter()
    .filter(|n| n.kind == Kind::PriceUp)
    .map(|n| (n.kind, n.title, n.body))
    .collect()
}

#[test]
fn the_bell_asks_about_a_possible_new_price() {
    let db = Db::setup();
    db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    assert_eq!(
        bell(&db, "2026-11-22"),
        vec![(
            Kind::PriceUp,
            "Anthropic Claude may have a new price".into(),
            "$100.18 (was $22.11)".into()
        )]
    );
}

#[test]
fn a_confirmed_drop_says_went_down() {
    let db = Db::setup();
    db.anthropic();
    db.charge("2026-12-05", CLAUDE, 1000);
    db.import_done();
    price_changes::answer(&db.conn, db.open()[0].id, Answer::NewPrice).unwrap();
    assert_eq!(
        bell(&db, "2026-12-06"),
        vec![(
            Kind::PriceUp,
            "Anthropic Claude went down".into(),
            "From $22.11 to $10.00 (-55%)".into()
        )]
    );
}

#[test]
fn each_bills_latest_change_for_the_recurrings_page() {
    let db = Db::setup();
    let first = db.anthropic();
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    price_changes::answer(&db.conn, db.open()[0].id, Answer::NewPrice).unwrap();
    db.charge("2026-12-21", CLAUDE, 22100);
    db.import_done();
    price_changes::answer(&db.conn, db.open()[0].id, Answer::NewPrice).unwrap();
    assert_eq!(
        price_changes::latest_changes(&db.conn).unwrap(),
        vec![(
            first,
            PriceChange {
                changed_on: "2026-12-21".into(),
                from_cents: 10018,
                to_cents: 22100
            }
        )]
    );
}

#[test]
fn a_charge_that_joins_a_bill_another_way_is_no_longer_asked() {
    let db = Db::setup();
    db.anthropic();
    let upgrade = db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    assert_eq!(db.open().len(), 1);
    let draft = recurrings::draft_from_transaction(&db.conn, upgrade).unwrap();
    let other = recurrings::create(&db.conn, &draft).unwrap();
    assert_eq!(db.linked(upgrade), Some(other));
    assert!(db.open().is_empty());
    assert_eq!(
        price_changes::for_transaction(&db.conn, upgrade).unwrap(),
        None
    );
}

fn monthly(db: &Db, name: &str, pattern: &str, cents: i64, day: Option<u32>) -> i64 {
    recurrings::create(
        &db.conn,
        &NewRecurring {
            name: name.into(),
            category_id: None,
            match_kind: MatchKind::Merchant,
            pattern: pattern.into(),
            min_cents: cents - 300,
            max_cents: cents + 300,
            frequency: Cadence::Monthly,
            day_of_month: day,
            also_matches: Vec::new(),
            paid_back_by: None,
        },
    )
    .unwrap()
}

#[test]
fn a_subscription_whose_statement_name_changed_is_suggested_for_merging() {
    let db = Db::setup();
    // Walmart+ renamed on the statement: the same price on the same day, one name after the other.
    for m in 1..=5 {
        db.charge(&format!("2025-{m:02}-22"), "WMT PLUS", 1427);
    }
    for m in 6..=10 {
        db.charge(&format!("2025-{m:02}-22"), "WALMART+ MEMBER", 1428);
    }
    let wmt = monthly(&db, "Wmt Plus", "wmt plus", 1427, Some(22));
    let member = monthly(&db, "Walmart+ Member", "walmart+ member", 1428, Some(22));
    // YouTube renamed with a new price: the names share a word.
    for m in 1..=6 {
        db.charge(&format!("2026-{m:02}-08"), "GOOGLE YOUTUBEPREMI", 1399);
    }
    for m in 7..=11 {
        db.charge(&format!("2026-{m:02}-13"), "GOOGLE YOUTUBE", 899);
    }
    let old_yt = monthly(
        &db,
        "Google Youtubepremi",
        "google youtubepremi",
        1399,
        Some(8),
    );
    let new_yt = monthly(&db, "YouTube Premium", "google youtube", 899, Some(13));
    assert_eq!(
        price_changes::look_alikes(&db.conn).unwrap(),
        vec![(wmt, member), (old_yt, new_yt)]
    );
}

#[test]
fn different_subscriptions_one_after_another_are_not_suggested() {
    let db = Db::setup();
    // Hulu stopped and Paramount started: different names, prices and days.
    for m in 1..=5 {
        db.charge(&format!("2026-{m:02}-09"), "HULU", 1199);
    }
    for m in 6..=10 {
        db.charge(&format!("2026-{m:02}-20"), "PARAMOUNT PLUS", 799);
    }
    monthly(&db, "Hulu", "hulu", 1199, Some(9));
    monthly(&db, "Paramount", "paramount plus", 799, Some(20));
    // Same price and day, but both running at once: two subscriptions.
    for m in 1..=10 {
        db.charge(&format!("2026-{m:02}-15"), "NETFLIX", 1799);
        db.charge(&format!("2026-{m:02}-15"), "MAX STREAMING", 1799);
    }
    monthly(&db, "Netflix", "netflix", 1799, Some(15));
    monthly(&db, "Max", "max streaming", 1799, Some(15));
    // Same price and day, one after the other, but a year apart: not a rename.
    for m in 1..=3 {
        db.charge(&format!("2024-{m:02}-03"), "OLD GYM", 4000);
        db.charge(&format!("2026-{m:02}-03"), "NEW GYM CLUB", 4000);
    }
    monthly(&db, "Old Gym", "old gym", 4000, Some(3));
    monthly(&db, "Club", "new gym club", 4000, Some(3));
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}

#[test]
fn merging_a_renamed_bill_records_no_price_change_where_the_name_changed() {
    let db = Db::setup();
    for m in 1..=5 {
        db.charge(&format!("2026-{m:02}-05"), "CLAUDE.AI SUBSCRIPTISAN", 2207);
    }
    let old = monthly(&db, "Claude.ai", "claude.ai subscriptisan", 2207, Some(5));
    let new = db.anthropic(); // $22.11 from June, then $100.18 on Nov 21 (answered: new price)
    db.charge("2026-11-21", CLAUDE, 10018);
    db.import_done();
    let check = db.open()[0].id;
    price_changes::answer(&db.conn, check, Answer::NewPrice).unwrap();
    price_changes::merge(&db.conn, old, new).unwrap();
    assert_eq!(
        price_changes::history(&db.conn, old).unwrap(),
        vec![PriceChange {
            changed_on: "2026-11-21".into(),
            from_cents: 2211,
            to_cents: 10018
        }],
        "only the real change; $22.07 to $22.11 in June is the same price"
    );
}

#[test]
fn a_payment_app_charge_to_someone_else_is_not_asked_about_as_a_new_price() {
    let db = Db::setup();
    for m in 8..=10 {
        db.charge(
            &format!("2026-{m:02}-28"),
            "VENMO *SAM RIVERA 8555550100 NY",
            4768,
        );
    }
    let id = recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "Venmo".into(),
            category_id: None,
            match_kind: MatchKind::Contains,
            pattern: "venmo".into(),
            min_cents: 3800,
            max_cents: 5700,
            frequency: Cadence::Monthly,
            day_of_month: Some(28),
            also_matches: Vec::new(),
            paid_back_by: None,
        },
    )
    .unwrap();
    assert_eq!(db.count(id), 3);
    db.charge("2026-11-18", "VENMO *JORDAN LEE 8555550100 NY", 10000);
    db.import_done();
    assert!(
        db.open().is_empty(),
        "a payment to anyone: no price question"
    );
}

#[test]
fn renamed_bills_with_different_frequencies_are_not_suggested() {
    let db = Db::setup();
    for m in 1..=5 {
        db.charge(&format!("2026-{m:02}-08"), "GOOGLE YOUTUBEPREMI", 1399);
    }
    db.charge("2026-07-13", "GOOGLE YOUTUBE", 8999);
    monthly(
        &db,
        "Google Youtubepremi",
        "google youtubepremi",
        1399,
        Some(8),
    );
    recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "YouTube yearly".into(),
            category_id: None,
            match_kind: MatchKind::Merchant,
            pattern: "google youtube".into(),
            min_cents: 8000,
            max_cents: 10000,
            frequency: Cadence::Yearly,
            day_of_month: Some(13),
            also_matches: Vec::new(),
            paid_back_by: None,
        },
    )
    .unwrap();
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}

#[test]
fn a_big_payment_to_the_person_a_bill_names_is_asked_about() {
    let db = Db::setup();
    for m in 8..=10 {
        db.charge(
            &format!("2026-{m:02}-28"),
            "VENMO *SAM RIVERA 8555550100 NY",
            4768,
        );
    }
    recurrings::create(
        &db.conn,
        &NewRecurring {
            name: "Sam".into(),
            category_id: None,
            match_kind: MatchKind::Contains,
            pattern: "sam rivera".into(),
            min_cents: 3800,
            max_cents: 5700,
            frequency: Cadence::Monthly,
            day_of_month: Some(28),
            also_matches: Vec::new(),
            paid_back_by: None,
        },
    )
    .unwrap();
    db.charge("2026-11-28", "VENMO *SAM RIVERA 8555550100 NY", 9500);
    db.import_done();
    assert_eq!(
        db.open().len(),
        1,
        "the person the bill names: a new price is a fair question"
    );
}

#[test]
fn a_subscription_whose_statement_name_changed_for_a_few_months_and_back_is_suggested() {
    let db = Db::setup();
    // Hulu billed as "HULU SANTA" most months, as "HLU*HULUPLUS" in Aug and Sep, then back: the bills take turns.
    for m in [1, 2, 3, 4, 5, 6, 7, 10] {
        db.charge(&format!("2026-{m:02}-13"), "HULU SANTA MONICA CA", 2763);
    }
    for m in [8, 9] {
        db.charge(&format!("2026-{m:02}-13"), "HLU*HULUPLUS", 2427);
    }
    let hulu = monthly(&db, "Hulu Santa", "hulu santa", 2763, Some(13));
    let plus = monthly(&db, "Hlu Huluplus", "hlu huluplus", 2427, Some(13));
    assert_eq!(
        price_changes::look_alikes(&db.conn).unwrap(),
        vec![(hulu, plus)]
    );
}

#[test]
fn bills_taking_turns_with_unrelated_names_prices_and_days_are_not_suggested() {
    let db = Db::setup();
    for m in [1, 3, 5, 7, 9] {
        db.charge(&format!("2026-{m:02}-03"), "CITY GYM", 4000);
    }
    for m in [2, 4, 6, 8, 10] {
        db.charge(&format!("2026-{m:02}-20"), "SPOTIFY USA", 1199);
    }
    monthly(&db, "City Gym", "city gym", 4000, Some(3));
    monthly(&db, "Spotify", "spotify usa", 1199, Some(20));
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}

#[test]
fn related_names_charged_in_the_same_month_are_two_subscriptions() {
    let db = Db::setup();
    // Hulu and Hulu + Live TV, both every month.
    for m in 1..=6 {
        db.charge(&format!("2026-{m:02}-13"), "HULU SANTA MONICA CA", 2763);
        db.charge(&format!("2026-{m:02}-15"), "HLU*HULUPLUS LIVE", 8299);
    }
    monthly(&db, "Hulu", "hulu santa", 2763, Some(13));
    monthly(&db, "Hulu Live", "hlu huluplus live", 8299, Some(15));
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}

#[test]
fn a_three_letter_word_alone_does_not_make_names_related() {
    let db = Db::setup();
    // "max" inside "maxwell": too short to say anything; different prices and days.
    for m in [1, 2, 3] {
        db.charge(&format!("2026-{m:02}-05"), "MAX STREAMING", 1699);
    }
    for m in [4, 5, 6] {
        db.charge(&format!("2026-{m:02}-25"), "MAXWELL HOUSE CLUB", 900);
    }
    monthly(&db, "Max", "max streaming", 1699, Some(5));
    monthly(&db, "Maxwell", "maxwell house club", 900, Some(25));
    assert!(price_changes::look_alikes(&db.conn).unwrap().is_empty());
}
