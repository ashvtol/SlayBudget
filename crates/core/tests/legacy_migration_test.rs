use slaybudget_core::categories;
use slaybudget_core::categorize::learning;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::legacy::{migrate_legacy, LegacyInput};
use slaybudget_core::profiles;
use slaybudget_core::transactions::{self, TransactionFilter};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn input() -> LegacyInput {
    LegacyInput {
        transactions_json: fixture("legacy-transactions.json"),
        model_json: Some(fixture("legacy-ai-model.json")),
    }
}

fn legacy(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::find_by_legacy_name(conn, name)
        .unwrap()
        .unwrap()
        .id
}

#[test]
fn migrates_transactions_with_categories_signs_sources_and_locks() {
    let conn = open_in_memory().unwrap();
    let report = migrate_legacy(&conn, &input()).unwrap();
    assert_eq!(report.transactions_inserted, 20);
    assert_eq!(report.transactions_duplicate, 0);
    assert_eq!(report.profiles_created, 1);
    assert_eq!(report.sources_created, 3);
    assert_eq!(
        report.categories_created, 7,
        "custom categories land as two-tier categories"
    );

    let alex = profiles::list(&conn)
        .unwrap()
        .into_iter()
        .find(|p| p.name == "Alex")
        .unwrap();
    let all = transactions::list(&conn, &TransactionFilter::for_profile(alex.id)).unwrap();
    assert_eq!(all.len(), 20);
    let by_desc = |d: &str| all.iter().find(|t| t.description == d).unwrap();

    assert_eq!(
        by_desc("UBER").amount_cents,
        -331,
        "expenses become money out"
    );
    assert_eq!(
        by_desc("AUTOPAY PAYMENT - THANK YOU").amount_cents,
        125_000,
        "credits become money in"
    );
    assert_eq!(
        by_desc("ACH Electronic Credit ACME PAYROLL").amount_cents,
        325_000
    );
    assert_eq!(by_desc("UBER").posted_on.to_string(), "2026-06-27");
    assert_eq!(
        by_desc("UBER").category_id,
        Some(legacy(&conn, "Transportation - Cab/Rideshare"))
    );
    assert_eq!(
        by_desc("RENT PAYMENT").category_id,
        Some(legacy(&conn, "Housing & Utilities - Rent"))
    );
    assert_eq!(
        by_desc("WEDDING VENUE DEPOSIT").category_id,
        Some(legacy(&conn, "Wedding"))
    );
    assert!(by_desc("STARBUCKS 4412").category_locked);
    assert!(!by_desc("UBER").category_locked);
    assert!(
        all.iter().all(|t| t.reviewed),
        "legacy data was already reviewed by hand"
    );

    let netflix: Vec<_> = all
        .iter()
        .filter(|t| t.description == "NETFLIX.COM")
        .collect();
    assert_eq!(netflix.len(), 2, "identical legacy rows survive");

    let sources = profiles::list_sources(&conn, alex.id).unwrap();
    let names: Vec<_> = sources.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"Amex") && names.contains(&"Citi Costco") && names.contains(&"Citi"));

    let rent = categories::get(&conn, legacy(&conn, "Housing & Utilities - Rent")).unwrap();
    assert_eq!(rent.name, "Rent");
    let group = categories::list_groups(&conn)
        .unwrap()
        .into_iter()
        .find(|g| g.id == rent.group_id)
        .unwrap();
    assert_eq!(group.name, "Housing & Utilities");

    let zara_credit = by_desc("ZARA 1");
    let _ = zara_credit;
    assert!(
        all.iter().any(|t| t.refund_of.is_some()),
        "refund matching ran"
    );
}

#[test]
fn migrates_learned_merchants_and_skips_platforms() {
    let conn = open_in_memory().unwrap();
    let report = migrate_legacy(&conn, &input()).unwrap();
    assert_eq!(report.merchants_learned, 6);
    assert_eq!(
        report.merchants_skipped, 2,
        "venmo and shell oil are platforms"
    );
    let rules = learning::list(&conn).unwrap();
    assert!(rules
        .iter()
        .any(|r| r.merchant == "starbucks" && r.category_id == legacy(&conn, "Coffee Shop")));
    assert!(
        rules.iter().all(|r| r.profile_id.is_none()),
        "legacy model was shared across users"
    );
}

#[test]
fn running_twice_changes_nothing() {
    let conn = open_in_memory().unwrap();
    migrate_legacy(&conn, &input()).unwrap();
    let second = migrate_legacy(&conn, &input()).unwrap();
    assert_eq!(second.transactions_inserted, 0);
    assert_eq!(second.transactions_duplicate, 20);
    assert_eq!(second.profiles_created, 0);
    assert_eq!(second.sources_created, 0);
    assert_eq!(second.categories_created, 0);
    assert_eq!(categories::list(&conn).unwrap().len(), 31 + 7);
    assert_eq!(learning::list(&conn).unwrap().len(), 6);
}

#[test]
fn works_without_a_model_file_and_rejects_bad_json() {
    let conn = open_in_memory().unwrap();
    let report = migrate_legacy(
        &conn,
        &LegacyInput {
            transactions_json: fixture("legacy-transactions.json"),
            model_json: None,
        },
    )
    .unwrap();
    assert_eq!(report.transactions_inserted, 20);
    assert_eq!(report.merchants_learned, 0);
    assert!(migrate_legacy(
        &conn,
        &LegacyInput {
            transactions_json: "{".into(),
            model_json: None
        }
    )
    .is_err());
}
