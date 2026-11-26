use slaybudget_core::db::open_in_memory;
use slaybudget_core::settings;

#[test]
fn missing_setting_is_none() {
    let conn = open_in_memory().unwrap();
    assert_eq!(settings::get(&conn, "theme").unwrap(), None);
}

#[test]
fn set_then_get_and_overwrite() {
    let conn = open_in_memory().unwrap();
    settings::set(&conn, "theme", "navy").unwrap();
    assert_eq!(
        settings::get(&conn, "theme").unwrap().as_deref(),
        Some("navy")
    );
    settings::set(&conn, "theme", "aurora").unwrap();
    assert_eq!(
        settings::get(&conn, "theme").unwrap().as_deref(),
        Some("aurora")
    );
}

#[test]
fn all_returns_every_pair() {
    let conn = open_in_memory().unwrap();
    settings::set(&conn, "a", "1").unwrap();
    settings::set(&conn, "b", "2").unwrap();
    let all = settings::all(&conn).unwrap();
    assert_eq!(all.get("a").map(String::as_str), Some("1"));
    assert_eq!(all.get("b").map(String::as_str), Some("2"));
}
