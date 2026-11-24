use slaybudget_core::budgets;
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::undo::UndoStack;

fn id(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::list(conn)
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
        .id
}

#[test]
fn sets_each_budget_from_this_month_on_and_leaves_the_rest() {
    let conn = open_in_memory().unwrap();
    let (rest, shop, groc) = (
        id(&conn, "Restaurants"),
        id(&conn, "Shopping"),
        id(&conn, "Groceries"),
    );
    budgets::set_budget(&conn, groc, None, Some(45000)).unwrap();
    budgets::set_budget(&conn, rest, Some("2026-12"), Some(99000)).unwrap(); // a later override goes
    budgets::set_budget(&conn, rest, Some("2026-09"), Some(70000)).unwrap(); // an earlier one stays

    budgets::apply_budgets(&conn, "2026-11", &[(rest, 31500), (shop, 27500)]).unwrap();

    assert_eq!(
        budgets::budget_for(&conn, rest, "2026-11").unwrap(),
        Some(31500)
    );
    assert_eq!(
        budgets::budget_for(&conn, rest, "2026-12").unwrap(),
        Some(31500)
    );
    assert_eq!(
        budgets::budget_for(&conn, rest, "2026-09").unwrap(),
        Some(70000)
    );
    assert_eq!(
        budgets::budget_for(&conn, shop, "2026-11").unwrap(),
        Some(27500)
    );
    assert_eq!(
        budgets::budget_for(&conn, groc, "2026-11").unwrap(),
        Some(45000)
    );
}

#[test]
fn refuses_a_negative_amount_and_changes_nothing() {
    let conn = open_in_memory().unwrap();
    let (rest, shop) = (id(&conn, "Restaurants"), id(&conn, "Shopping"));
    assert!(budgets::apply_budgets(&conn, "2026-11", &[(rest, 31500), (shop, -5)]).is_err());
    assert_eq!(budgets::budget_for(&conn, rest, "2026-11").unwrap(), None);
}

#[test]
fn one_undo_takes_them_all_back() {
    let conn = open_in_memory().unwrap();
    let (rest, shop) = (id(&conn, "Restaurants"), id(&conn, "Shopping"));
    let mut undo = UndoStack::new();
    undo.record(&conn, "Use Suggested Budgets", |c| {
        budgets::apply_budgets(c, "2026-11", &[(rest, 31500), (shop, 27500)])
    })
    .unwrap();
    undo.undo(&conn).unwrap();
    assert_eq!(budgets::budget_for(&conn, rest, "2026-11").unwrap(), None);
    assert_eq!(budgets::budget_for(&conn, shop, "2026-11").unwrap(), None);
}
