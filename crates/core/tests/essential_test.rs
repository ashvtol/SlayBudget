use rusqlite::Connection;
use slaybudget_core::categories::{self, CategoryKind, CategoryPatch, NewCategory};
use slaybudget_core::db::open_in_memory;

fn named(conn: &Connection, name: &str) -> categories::Category {
    categories::list(conn)
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
}

#[test]
fn seeded_needs_are_essential_and_wants_are_not() {
    let conn = open_in_memory().unwrap();
    for n in [
        "Groceries",
        "Whole Foods",
        "Fuel",
        "Public Transit",
        "Housing & Utilities",
        "Phone & Internet",
    ] {
        assert!(named(&conn, n).essential, "{n} should be essential");
    }
    for n in [
        "Restaurants",
        "Entertainment",
        "Shopping",
        "Rideshare",
        "Subscriptions",
    ] {
        assert!(!named(&conn, n).essential, "{n} should not be essential");
    }
    // Income and transfer categories never are.
    assert!(categories::list(&conn)
        .unwrap()
        .iter()
        .filter(|c| c.kind != CategoryKind::Expense)
        .all(|c| !c.essential));
}

#[test]
fn the_default_rule_matches_names() {
    for n in [
        "Rent",
        "Electric",
        "Gas",
        "Car Insurance",
        "Mortgage",
        "Pharmacy",
        "Student Loan",
        "Water",
    ] {
        assert!(categories::default_essential(n), "{n}");
    }
    for n in [
        "Gym",
        "Gas station snacks",
        "Restaurants",
        "Travel",
        "Coffee",
    ] {
        assert!(!categories::default_essential(n), "{n}");
    }
}

#[test]
fn existing_databases_get_the_defaults_once() {
    let conn = open_in_memory().unwrap();
    let gym = categories::create(
        &conn,
        &NewCategory {
            group: "Health".into(),
            name: "Gym".into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        },
    )
    .unwrap();
    let rent = categories::create(
        &conn,
        &NewCategory {
            group: "Bills".into(),
            name: "Rent".into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        },
    )
    .unwrap();
    // As if upgraded from before 0015: nothing marked, defaults not applied yet.
    conn.execute("UPDATE categories SET essential = 0", [])
        .unwrap();
    conn.execute("INSERT INTO essential_defaults_pending VALUES (1)", [])
        .unwrap();
    categories::apply_default_essentials(&conn).unwrap();
    assert!(categories::get(&conn, rent).unwrap().essential);
    assert!(!categories::get(&conn, gym).unwrap().essential);
    // Once only: a choice you make afterwards sticks.
    categories::update(
        &conn,
        rent,
        &CategoryPatch {
            essential: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    categories::apply_default_essentials(&conn).unwrap();
    assert!(!categories::get(&conn, rent).unwrap().essential);
}

#[test]
fn essential_can_be_changed_and_new_categories_start_off() {
    let conn = open_in_memory().unwrap();
    let id = categories::create(
        &conn,
        &NewCategory {
            group: "Bills".into(),
            name: "Rent".into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        },
    )
    .unwrap();
    assert!(!categories::get(&conn, id).unwrap().essential);
    categories::update(
        &conn,
        id,
        &CategoryPatch {
            essential: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(categories::get(&conn, id).unwrap().essential);
}
