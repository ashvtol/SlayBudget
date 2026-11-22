use slaybudget_core::categories;
use slaybudget_core::categorize::recategorize::{bank_category_suggestion, other_groups};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline;
use slaybudget_core::profiles;

fn id_of(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::list(conn)
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("no {name}"))
        .id
}

#[test]
fn amex_categories_map_to_existing_categories() {
    let conn = open_in_memory().unwrap();
    let s = |bank: &str| bank_category_suggestion(&conn, bank).unwrap();
    assert_eq!(
        s("Restaurant-Restaurant"),
        Some(id_of(&conn, "Restaurants"))
    );
    assert_eq!(
        s("Transportation-Taxis & Coach"),
        Some(id_of(&conn, "Rideshare"))
    );
    assert_eq!(s("Transportation-Fuel"), Some(id_of(&conn, "Fuel")));
    assert_eq!(
        s("Merchandise & Supplies-Groceries"),
        Some(id_of(&conn, "Groceries"))
    );
    assert_eq!(
        s("Merchandise & Supplies-Clothing Stores"),
        Some(id_of(&conn, "Shopping"))
    );
    assert_eq!(s("Travel-Airline"), Some(id_of(&conn, "Travel")));
    assert_eq!(
        s("Entertainment-Theatrical Events"),
        Some(id_of(&conn, "Entertainment"))
    );
    // Nothing sensible to suggest.
    assert_eq!(s("Business Services-Other Services"), None);
    assert_eq!(s(""), None);
}

#[test]
fn a_suggestion_needs_the_category_to_exist_and_be_in_use() {
    let conn = open_in_memory().unwrap();
    let travel = id_of(&conn, "Travel");
    categories::update(
        &conn,
        travel,
        &categories::CategoryPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        bank_category_suggestion(&conn, "Travel-Airline").unwrap(),
        None
    );
}

#[test]
fn other_groups_carry_the_banks_category_and_a_suggestion() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    // Not known to the app, so these land in Other; Amex says what they are.
    let csv = "Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category\n\
               11/01/2026,ZZQ FLORBLE KOLA,40.00,,,,,,,'1',Restaurant-Restaurant\n\
               11/02/2026,ZZQ FLORBLE KOLA,20.00,,,,,,,'2',Restaurant-Restaurant\n\
               11/03/2026,ZZQ GRUNTLE PEX,10.00,,,,,,,'3',\n";
    pipeline::import_csv(&conn, p, "Statements/Alex/Amex/new.csv", csv).unwrap();
    let groups = other_groups(&conn).unwrap();
    let bistro = groups
        .iter()
        .find(|g| g.merchant.contains("florble"))
        .expect("florble in Other");
    assert_eq!(
        bistro.bank_category.as_deref(),
        Some("Restaurant-Restaurant")
    );
    assert_eq!(
        bistro.suggested_category_id,
        Some(id_of(&conn, "Restaurants"))
    );
    let shop = groups
        .iter()
        .find(|g| g.merchant.contains("gruntle"))
        .expect("gruntle in Other");
    assert_eq!(
        (shop.bank_category.as_deref(), shop.suggested_category_id),
        (None, None)
    );
}
