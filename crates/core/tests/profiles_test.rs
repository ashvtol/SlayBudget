use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, NewSource, SourceKind};

#[test]
fn a_default_profile_exists_after_open() {
    let conn = open_in_memory().unwrap();
    let all = profiles::list(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Me");
}

#[test]
fn create_and_list_profiles_in_sort_order() {
    let conn = open_in_memory().unwrap();
    let a = profiles::create(&conn, "Alex", Some("#5b8cff")).unwrap();
    let b = profiles::create(&conn, "Jamie", None).unwrap();
    let names: Vec<_> = profiles::list(&conn)
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, vec!["Me", "Alex", "Jamie"]);
    assert_ne!(a, b);
}

#[test]
fn duplicate_profile_name_is_rejected() {
    let conn = open_in_memory().unwrap();
    profiles::create(&conn, "Alex", None).unwrap();
    assert!(profiles::create(&conn, "Alex", None).is_err());
}

#[test]
fn rename_and_delete_profile() {
    let conn = open_in_memory().unwrap();
    let id = profiles::create(&conn, "Temp", None).unwrap();
    profiles::rename(&conn, id, "Renamed").unwrap();
    assert!(profiles::list(&conn)
        .unwrap()
        .iter()
        .any(|p| p.name == "Renamed"));
    profiles::delete(&conn, id).unwrap();
    assert!(!profiles::list(&conn)
        .unwrap()
        .iter()
        .any(|p| p.name == "Renamed"));
}

#[test]
fn sources_belong_to_a_profile_and_are_unique_by_name() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let amex = profiles::create_source(
        &conn,
        &NewSource {
            profile_id: p,
            name: "Amex".into(),
            kind: SourceKind::Csv,
            institution: Some("American Express".into()),
        },
    )
    .unwrap();
    profiles::create_source(
        &conn,
        &NewSource {
            profile_id: p,
            name: "Citi Checking".into(),
            kind: SourceKind::Pdf,
            institution: Some("Citi".into()),
        },
    )
    .unwrap();
    let sources = profiles::list_sources(&conn, p).unwrap();
    assert_eq!(sources.len(), 2);
    assert_eq!(sources[0].id, amex);
    assert_eq!(sources[0].kind, SourceKind::Csv);
    let dup = profiles::create_source(
        &conn,
        &NewSource {
            profile_id: p,
            name: "Amex".into(),
            kind: SourceKind::Csv,
            institution: None,
        },
    );
    assert!(dup.is_err());
}

#[test]
fn find_or_create_source_returns_existing() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let a = profiles::find_or_create_source(&conn, p, "Citi-Costco", SourceKind::Csv).unwrap();
    let b = profiles::find_or_create_source(&conn, p, "Citi-Costco", SourceKind::Csv).unwrap();
    assert_eq!(a, b);
    assert_eq!(profiles::list_sources(&conn, p).unwrap().len(), 1);
}

#[test]
fn list_all_sources_spans_profiles() {
    let conn = open_in_memory().unwrap();
    let p1 = profiles::create(&conn, "A", None).unwrap();
    let p2 = profiles::create(&conn, "B", None).unwrap();
    profiles::find_or_create_source(&conn, p1, "Amex", SourceKind::Csv).unwrap();
    profiles::find_or_create_source(&conn, p2, "Chase", SourceKind::Csv).unwrap();
    assert_eq!(profiles::list_all_sources(&conn).unwrap().len(), 2);
}

#[test]
fn the_bank_is_inferred_from_the_source_name() {
    use slaybudget_core::profiles::institution_for;
    assert_eq!(institution_for("Amex"), Some("American Express"));
    assert_eq!(institution_for("Amex Gold"), Some("American Express"));
    assert_eq!(institution_for("Citi-Costco"), Some("Citi"));
    assert_eq!(institution_for("Citi-Checking"), Some("Citi"));
    assert_eq!(institution_for("Chase Sapphire"), Some("Chase"));
    assert_eq!(institution_for("Imported"), None);
}

#[test]
fn new_sources_get_their_bank_and_existing_ones_are_backfilled_without_overwriting() {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let amex = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    // An older source with no bank recorded, and one the user set by hand.
    conn.execute(
        "INSERT INTO sources (profile_id, name, kind) VALUES (?1, 'Citi-Costco', 'csv')",
        [p],
    )
    .unwrap();
    conn.execute("INSERT INTO sources (profile_id, name, kind, institution) VALUES (?1, 'Citi-Checking', 'pdf', 'My Credit Union')", [p]).unwrap();
    profiles::backfill_institutions(&conn).unwrap();
    let by_name: std::collections::HashMap<String, Option<String>> =
        profiles::list_sources(&conn, p)
            .unwrap()
            .into_iter()
            .map(|s| (s.name, s.institution))
            .collect();
    assert_eq!(by_name["Amex"].as_deref(), Some("American Express"));
    assert_eq!(by_name["Citi-Costco"].as_deref(), Some("Citi"));
    assert_eq!(by_name["Citi-Checking"].as_deref(), Some("My Credit Union"));
    let _ = amex;
}
