use slaybudget_core::categories;
use slaybudget_core::categorize::export::{self, is_shareable};
use slaybudget_core::categorize::learning;
use slaybudget_core::categorize::rules::{self, MatchKind, NewRule};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::ft_model;
use slaybudget_core::profiles::{self, SourceKind};

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_or_create_by_legacy_name(conn, legacy).unwrap()
}

#[test]
fn ordinary_merchants_and_their_details_are_shareable() {
    let none: [&str; 0] = [];
    for m in [
        "whole foods",
        "shell seattle",
        "7-eleven",
        "safeway 1234",
        "store 85432",
        "jane doe bakery",
    ] {
        assert!(is_shareable(m, &none), "{m} should be shareable");
    }
}

#[test]
fn the_users_own_details_are_not_shareable() {
    let none: [&str; 0] = [];
    for m in [
        "acme 231017113550273",    // 6+ digit reference
        "pay id:cti2ofhebhzv org", // identifier
        "ref: abc",
        "conf: 12ab",
        "acct transfer",
        "card x1234",
        "card xx1234",
        "me@example.com",
        "zelle to jane",
        "venmo",
        "cash app pat",
        "paypal *person",
        "apple cash",
        "online transfer",
        "acme payroll",
        "direct dep acme",
        "check 101",
        "call 2065550100",
    ] {
        assert!(!is_shareable(m, &none), "{m} should not be shareable");
    }
}

#[test]
fn profile_names_are_not_shareable_but_generic_ones_are_ignored() {
    assert!(!is_shareable("alex lunch", &["Alex"]));
    assert!(is_shareable("alexandra cafe", &["Alex"])); // whole words only
    assert!(is_shareable("personal trainer", &["Personal"])); // generic profile names are ignored
    assert!(is_shareable("me cafe", &["Me"])); // too short to be a name match
}

#[test]
fn export_lists_categories_by_name_sorted_and_leaves_out_the_users_details() {
    let conn = open_in_memory().unwrap();
    let groceries = cat(&conn, "Groceries");
    let gas = cat(&conn, "Gas");
    learning::learn(&conn, "whole foods", groceries, None).unwrap();
    learning::learn(&conn, "whole foods", groceries, None).unwrap();
    learning::learn(&conn, "aldi", groceries, None).unwrap();
    learning::learn(&conn, "acme 231017113550273", groceries, None).unwrap();
    rules::create(
        &conn,
        &NewRule {
            name: "Shell".into(),
            match_kind: MatchKind::Merchant,
            pattern: "shell seattle".into(),
            min_cents: None,
            max_cents: Some(20000),
            source_id: None,
            category_id: gas,
            priority: 1,
        },
    )
    .unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    rules::create(
        &conn,
        &NewRule {
            name: "Amex only".into(),
            match_kind: MatchKind::Contains,
            pattern: "fee".into(),
            min_cents: None,
            max_cents: None,
            source_id: Some(s),
            category_id: gas,
            priority: 0,
        },
    )
    .unwrap();

    let out = export::export_rules(&conn, "2026-11-21").unwrap();
    assert_eq!(out.file.format, "slaybudget-rules");
    assert_eq!(out.file.version, 1);
    let learned: Vec<_> = out
        .file
        .learned
        .iter()
        .map(|l| (l.merchant.as_str(), l.category.as_str(), l.hits))
        .collect();
    let groceries_name = categories::list(&conn)
        .unwrap()
        .into_iter()
        .find(|c| c.id == groceries)
        .unwrap()
        .name;
    assert_eq!(
        learned,
        vec![
            ("aldi", groceries_name.as_str(), 1),
            ("whole foods", groceries_name.as_str(), 2)
        ]
    );
    assert_eq!(out.file.rules.len(), 1);
    assert_eq!(out.file.rules[0].pattern, "shell seattle");
    assert_eq!(out.file.rules[0].max_cents, Some(20000));
    assert_eq!(out.left_out, 2); // the reference-number merchant and the account-bound rule
    let mut names: Vec<_> = out.file.categories.iter().map(|c| c.name.clone()).collect();
    names.sort();
    assert_eq!(names.len(), 2);
}

#[test]
fn the_written_file_has_no_ids_accounts_or_user_details_and_is_stable() {
    let conn = open_in_memory().unwrap();
    let groceries = cat(&conn, "Groceries");
    learning::learn(&conn, "whole foods", groceries, None).unwrap();
    learning::learn(&conn, "zelle to pat", groceries, None).unwrap();
    learning::learn(&conn, "acme 99887766", groceries, None).unwrap();
    let a = export::to_json(&export::export_rules(&conn, "2026-11-21").unwrap().file).unwrap();
    let b = export::to_json(&export::export_rules(&conn, "2026-11-21").unwrap().file).unwrap();
    assert_eq!(a, b);
    let lower = a.to_lowercase();
    for banned in [
        "\"id\"",
        "categoryid",
        "profile",
        "source",
        "account",
        "zelle",
        "99887766",
    ] {
        assert!(!lower.contains(banned), "file contains {banned}: {a}");
    }
    let value: serde_json::Value = serde_json::from_str(&a).unwrap();
    for entry in value["learned"].as_array().unwrap() {
        assert!(is_shareable(
            entry["merchant"].as_str().unwrap(),
            &[] as &[&str]
        ));
    }
}

#[test]
fn an_exported_file_previews_through_import_rules() {
    let conn = open_in_memory().unwrap();
    let groceries = cat(&conn, "Groceries");
    learning::learn(&conn, "whole foods", groceries, None).unwrap();
    let json = export::to_json(&export::export_rules(&conn, "2026-11-21").unwrap().file).unwrap();

    let other = open_in_memory().unwrap();
    let proposals = ft_model::preview(&other, &json).unwrap();
    assert_eq!(proposals.len(), 1);
    assert_eq!(proposals[0].merchant, "whole foods");
    assert_eq!(
        proposals[0].target,
        ft_model::FtTarget::Existing(cat(&other, "Groceries"))
    );
}
