use chrono::NaiveDate;
use slaybudget_core::analytics::budgets::month_status;
use slaybudget_core::budgets::{self, RebalanceScope};
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{self, NewTransaction};
use slaybudget_core::CoreError;

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

fn cat(db: &Db, legacy: &str) -> i64 {
    categories::find_by_legacy_name(&db.conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

fn default_budget(db: &Db, id: i64) -> Option<i64> {
    categories::list(&db.conn)
        .unwrap()
        .into_iter()
        .find(|c| c.id == id)
        .unwrap()
        .budget_cents
}

impl Db {
    fn spend(&self, date: &str, cents: i64, category: i64) {
        transactions::insert(
            &self.conn,
            &NewTransaction {
                profile_id: self.p,
                source_id: self.s,
                posted_on: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
                description: format!("SPEND {date} {cents}"),
                amount_cents: -cents,
                currency: "USD".into(),
                occurrence: 0,
                category_id: Some(category),
                import_id: None,
            },
        )
        .unwrap();
    }
}

#[test]
fn a_month_override_wins_over_the_default_and_same_for_all_clears_overrides() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    budgets::set_budget(&db.conn, food, None, Some(40000)).unwrap();
    budgets::set_budget(&db.conn, food, Some("2026-12"), Some(60000)).unwrap();
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-11").unwrap(),
        Some(40000)
    );
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-12").unwrap(),
        Some(60000)
    );
    let plan = budgets::plan(&db.conn).unwrap();
    assert_eq!(plan.months.len(), 1);
    assert_eq!(
        (
            plan.months[0].category_id,
            plan.months[0].month.as_str(),
            plan.months[0].amount_cents
        ),
        (food, "2026-12", 60000)
    );

    // Clearing a month's override falls back to the default.
    budgets::set_budget(&db.conn, food, Some("2026-12"), None).unwrap();
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-12").unwrap(),
        Some(40000)
    );

    budgets::set_budget(&db.conn, food, Some("2027-01"), Some(1)).unwrap();
    budgets::set_budget(&db.conn, food, None, Some(45000)).unwrap();
    assert!(budgets::plan(&db.conn).unwrap().months.is_empty());
    assert_eq!(default_budget(&db, food), Some(45000));
}

#[test]
fn invalid_budget_changes_are_refused() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    assert!(matches!(
        budgets::set_budget(&db.conn, food, None, Some(-1)),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        budgets::set_budget(&db.conn, food, Some("2026-13"), Some(1)),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        budgets::set_budget(&db.conn, food, Some("Nov"), Some(1)),
        Err(CoreError::Invalid(_))
    ));
    assert!(matches!(
        budgets::set_budget(&db.conn, 99999, None, Some(1)),
        Err(CoreError::NotFound(_))
    ));
    assert!(matches!(
        budgets::set_group_budget(&db.conn, 99999, Some(1)),
        Err(CoreError::NotFound(_))
    ));
    assert!(matches!(
        budgets::set_rollover(&db.conn, food, Some("2026-1")),
        Err(CoreError::Invalid(_))
    ));
}

#[test]
fn group_budgets_and_rollovers_are_stored_in_the_plan() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    let group = categories::list(&db.conn)
        .unwrap()
        .into_iter()
        .find(|c| c.id == food)
        .unwrap()
        .group_id;
    budgets::set_group_budget(&db.conn, group, Some(90000)).unwrap();
    budgets::set_rollover(&db.conn, food, Some("2026-10")).unwrap();
    let plan = budgets::plan(&db.conn).unwrap();
    assert_eq!(
        plan.groups
            .iter()
            .map(|g| (g.group_id, g.amount_cents))
            .collect::<Vec<_>>(),
        vec![(group, 90000)]
    );
    assert_eq!(
        plan.rollovers
            .iter()
            .map(|r| (r.category_id, r.since.as_str()))
            .collect::<Vec<_>>(),
        vec![(food, "2026-10")]
    );
    budgets::set_group_budget(&db.conn, group, None).unwrap();
    budgets::set_rollover(&db.conn, food, None).unwrap();
    let plan = budgets::plan(&db.conn).unwrap();
    assert!(plan.groups.is_empty() && plan.rollovers.is_empty());
}

#[test]
fn month_status_uses_the_months_budget_and_leaves_out_shared_group_members() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    let groceries = cat(&db, "Groceries");
    let fuel = cat(&db, "Fuel");
    budgets::set_budget(&db.conn, food, None, Some(40000)).unwrap();
    budgets::set_budget(&db.conn, food, Some("2026-11"), Some(50000)).unwrap();
    budgets::set_budget(&db.conn, groceries, None, Some(30000)).unwrap();
    budgets::set_budget(&db.conn, fuel, None, Some(10000)).unwrap();
    db.spend("2026-11-02", 1000, food);
    let today = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
    let status = month_status(&db.conn, Some(db.p), today).unwrap();
    assert_eq!(
        status
            .iter()
            .find(|b| b.category_id == food)
            .unwrap()
            .budget_cents,
        50000
    );

    // Groceries shares a group budget: its own budget no longer counts.
    let grocery_group = categories::list(&db.conn)
        .unwrap()
        .into_iter()
        .find(|c| c.id == groceries)
        .unwrap()
        .group_id;
    let members = categories::list(&db.conn)
        .unwrap()
        .into_iter()
        .filter(|c| c.group_id == grocery_group)
        .count();
    assert!(
        members >= 2,
        "fixture: Groceries sits in a group with other categories"
    );
    budgets::set_group_budget(&db.conn, grocery_group, Some(80000)).unwrap();
    let status = month_status(&db.conn, Some(db.p), today).unwrap();
    assert!(status.iter().all(|b| b.category_id != groceries));
    assert!(status.iter().any(|b| b.category_id == fuel));
}

#[test]
fn rebalance_this_month_sets_overrides_and_from_now_on_sets_defaults() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    let fuel = cat(&db, "Fuel");
    budgets::set_budget(&db.conn, food, None, Some(40000)).unwrap();
    budgets::set_budget(&db.conn, fuel, None, Some(10000)).unwrap();
    budgets::set_budget(&db.conn, food, Some("2027-01"), Some(1000)).unwrap();

    budgets::apply_rebalance(
        &db.conn,
        &[(food, 43700), (fuel, 6300)],
        RebalanceScope::ThisMonth,
        "2026-11",
    )
    .unwrap();
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-11").unwrap(),
        Some(43700)
    );
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-12").unwrap(),
        Some(40000)
    );

    budgets::apply_rebalance(
        &db.conn,
        &[(food, 42000), (fuel, 8000)],
        RebalanceScope::FromNowOn,
        "2026-11",
    )
    .unwrap();
    assert_eq!(default_budget(&db, food), Some(42000));
    assert_eq!(default_budget(&db, fuel), Some(8000));
    // Overrides from this month on are replaced by the new defaults.
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-11").unwrap(),
        Some(42000)
    );
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2027-01").unwrap(),
        Some(42000)
    );
}

#[test]
fn rebalance_must_keep_the_total() {
    let db = setup();
    let food = cat(&db, "Restaurants");
    let fuel = cat(&db, "Fuel");
    budgets::set_budget(&db.conn, food, None, Some(40000)).unwrap();
    budgets::set_budget(&db.conn, fuel, None, Some(10000)).unwrap();
    let r = budgets::apply_rebalance(
        &db.conn,
        &[(food, 45000), (fuel, 10000)],
        RebalanceScope::ThisMonth,
        "2026-11",
    );
    assert!(matches!(r, Err(CoreError::Invalid(_))));
    assert_eq!(
        budgets::budget_for(&db.conn, food, "2026-11").unwrap(),
        Some(40000)
    );
}
