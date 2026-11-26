use slaybudget_core::categories;
use slaybudget_core::categorize::starter;
use slaybudget_core::db::open_in_memory;

#[test]
fn every_entry_lands_in_a_category_a_new_install_has() {
    let conn = open_in_memory().unwrap();
    let mut missing = Vec::new();
    for e in starter::entries() {
        if starter::target(&conn, e).unwrap().is_none() {
            missing.push(format!("{} -> {:?}", e.pattern, e.targets));
        }
    }
    assert!(missing.is_empty(), "no category for: {missing:#?}");
}

#[test]
fn the_list_is_a_useful_size_and_has_no_duplicates_or_payment_apps() {
    let all = starter::entries();
    assert!((500..=1000).contains(&all.len()), "{} entries", all.len());
    let mut seen = std::collections::HashSet::new();
    for e in all {
        assert!(seen.insert(e.pattern), "duplicate {}", e.pattern);
        assert_eq!(e.pattern, e.pattern.trim().to_lowercase(), "{}", e.pattern);
        for app in ["venmo", "zelle", "paypal", "cash app", "cashapp"] {
            assert!(!e.pattern.contains(app), "payment app {}", e.pattern);
        }
    }
}

#[test]
fn the_longest_pattern_wins_and_only_whole_words_match() {
    let eats = starter::lookup("uber eats 8823").unwrap();
    assert_eq!(eats.pattern, "uber eats");
    assert!(
        eats.targets.contains(&"Food & Dining"),
        "{:?}",
        eats.targets
    );
    assert_eq!(starter::lookup("uber 7781 sf").unwrap().pattern, "uber");
    assert!(starter::lookup("shellfish shack").is_none_or(|e| e.pattern != "shell"));
    assert!(starter::lookup("zxqv llc").is_none());
}

#[test]
fn a_user_category_is_preferred_over_the_built_in_fallback() {
    let conn = open_in_memory().unwrap();
    // "Mobile, else Phone & Internet": a new install has only the fallback.
    let e = starter::lookup("VERIZON WIRELESS PAYMENT").unwrap();
    assert_eq!(e.targets[0], "Mobile");
    let phone = categories::find_by_legacy_name(&conn, "Phone & Internet")
        .unwrap()
        .unwrap()
        .id;
    assert_eq!(starter::target(&conn, e).unwrap(), Some(phone));
    conn.execute(
        "INSERT INTO categories (group_id, name, kind, legacy_name) SELECT group_id, 'Mobile', 'expense', 'Mobile' FROM categories WHERE id = ?1",
        [phone],
    )
    .unwrap();
    let mobile: i64 = conn
        .query_row("SELECT id FROM categories WHERE name = 'Mobile'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(starter::target(&conn, e).unwrap(), Some(mobile));
}

#[test]
fn seeding_teaches_the_classifier_once() {
    let conn = open_in_memory().unwrap();
    let n = starter::seed(&conn).unwrap();
    assert!(n >= 500);
    assert_eq!(starter::seed(&conn).unwrap(), 0, "second seed does nothing");
    let docs: f64 = conn
        .query_row("SELECT sum(docs) FROM model_totals", [], |r| r.get(0))
        .unwrap();
    assert_eq!(docs, n as f64, "weight 1 per entry");
}

#[test]
fn an_entry_whose_categories_are_all_gone_is_skipped() {
    let conn = open_in_memory().unwrap();
    let tolls = categories::find_by_legacy_name(&conn, "Transportation - Tolls")
        .unwrap()
        .unwrap()
        .id;
    categories::delete(&conn, tolls).unwrap();
    let e = starter::lookup("ez pass").unwrap();
    assert_eq!(starter::target(&conn, e).unwrap(), None);
}

#[test]
fn dots_and_slashes_separate_words() {
    assert_eq!(
        starter::lookup("AMAZON.COM*AB12 AMZN.COM/BILL")
            .unwrap()
            .pattern,
        "amazon com"
    );
}

#[test]
fn known_merchants_land_in_the_specific_categories() {
    let conn = open_in_memory().unwrap();
    let name_of = |text: &str| {
        let e = starter::lookup(text).unwrap_or_else(|| panic!("{text} not in the list"));
        let id = starter::target(&conn, e).unwrap().unwrap();
        categories::get(&conn, id).unwrap().name
    };
    for (text, category) in [
        ("STARBUCKS STORE 123", "Coffee"),
        ("PLANET FITNESS CLUB", "Fitness"),
        ("PETCO 1234", "Pets"),
        ("THE HOME DEPOT 0456", "Home & Household"),
        ("UNIQLO USA", "Clothing"),
        ("PG&E WEB ONLINE", "Utilities"),
        ("IRS USATAXPYMT", "Taxes"),
        ("ATM WITHDRAWAL 123 MAIN ST", "Cash & ATM"),
        ("INTEREST CHARGE ON PURCHASES", "Interest"),
        ("NAVIENT PAYMENT", "Loan Payments"),
        ("AMERICAN RED CROSS", "Charity"),
        ("BRIGHT HORIZONS", "Kids & Childcare"),
        ("EXPENSIFY REIMBURSEMENT", "Reimbursements"),
    ] {
        assert_eq!(name_of(text), category, "{text}");
    }
}
