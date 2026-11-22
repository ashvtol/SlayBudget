use slaybudget_core::categories;
use slaybudget_core::categorize::learning::{self, Suggestion};
use slaybudget_core::db::open_in_memory;

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_by_legacy_name(conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

#[test]
fn learned_merchant_is_suggested_exactly_and_fuzzily() {
    let conn = open_in_memory().unwrap();
    let groceries = cat(&conn, "Groceries");
    learning::learn(&conn, "whole foods", groceries, None).unwrap();
    assert_eq!(
        learning::suggest(&conn, "whole foods", None).unwrap(),
        Some(Suggestion {
            category_id: groceries,
            matched: "whole foods".into(),
            score: 1.0
        })
    );
    let fuzzy = learning::suggest(&conn, "whole foods mkt", None)
        .unwrap()
        .unwrap();
    assert_eq!(fuzzy.category_id, groceries);
    assert!(fuzzy.score >= 0.8);
    assert_eq!(learning::suggest(&conn, "trader joes", None).unwrap(), None);
}

#[test]
fn relearning_overwrites_and_counts_hits() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Groceries");
    let b = cat(&conn, "Food & Dining");
    learning::learn(&conn, "costco", a, None).unwrap();
    learning::learn(&conn, "costco", b, None).unwrap();
    let rules = learning::list(&conn).unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].category_id, b);
    assert_eq!(rules[0].hits, 2);
}

#[test]
fn payment_platforms_are_never_learned_or_matched() {
    let conn = open_in_memory().unwrap();
    let transfer = cat(&conn, "Transfer");
    assert!(!learning::learn(&conn, "venmo 1032551688", transfer, None).unwrap());
    assert_eq!(
        learning::suggest(&conn, "venmo 1032551688", None).unwrap(),
        None
    );
    assert!(learning::list(&conn).unwrap().is_empty());
}

#[test]
fn profile_scoped_rule_beats_global() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Groceries");
    let b = cat(&conn, "Shopping");
    learning::learn(&conn, "target", a, None).unwrap();
    learning::learn(&conn, "target", b, Some(1)).unwrap();
    assert_eq!(
        learning::suggest(&conn, "target", Some(1))
            .unwrap()
            .unwrap()
            .category_id,
        b
    );
    assert_eq!(
        learning::suggest(&conn, "target", Some(2))
            .unwrap()
            .unwrap()
            .category_id,
        a
    );
    assert_eq!(
        learning::suggest(&conn, "target", None)
            .unwrap()
            .unwrap()
            .category_id,
        a
    );
}

#[test]
fn forget_and_reset() {
    let conn = open_in_memory().unwrap();
    let a = cat(&conn, "Groceries");
    learning::learn(&conn, "x", a, None).unwrap();
    learning::learn(&conn, "y", a, None).unwrap();
    learning::forget(&conn, "x", None).unwrap();
    assert_eq!(learning::list(&conn).unwrap().len(), 1);
    learning::reset(&conn).unwrap();
    assert!(learning::list(&conn).unwrap().is_empty());
}
