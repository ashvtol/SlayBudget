use slaybudget_core::categories::{self, CategoryKind, NewCategory};
use slaybudget_core::db::open_in_memory;

#[test]
fn default_categories_are_seeded_once() {
    let conn = open_in_memory().unwrap();
    let groups = categories::list_groups(&conn).unwrap();
    assert!(groups.len() >= 10, "got {} groups", groups.len());
    let all = categories::list(&conn).unwrap();
    assert!(all.len() >= 31, "got {} categories", all.len());
    categories::seed_defaults(&conn).unwrap();
    assert_eq!(categories::list(&conn).unwrap().len(), all.len());
}

#[test]
fn legacy_names_resolve_to_two_tiers() {
    let conn = open_in_memory().unwrap();
    let fuel = categories::find_by_legacy_name(&conn, "Transportation - Fuel")
        .unwrap()
        .unwrap();
    let group = categories::list_groups(&conn)
        .unwrap()
        .into_iter()
        .find(|g| g.id == fuel.group_id)
        .unwrap();
    assert_eq!(fuel.name, "Fuel");
    assert_eq!(group.name, "Transportation");

    let salary = categories::find_by_legacy_name(&conn, "Income - Salary")
        .unwrap()
        .unwrap();
    assert_eq!(salary.kind, CategoryKind::Income);

    let transfer = categories::find_by_legacy_name(&conn, "Transfer")
        .unwrap()
        .unwrap();
    assert!(transfer.excluded);

    assert!(categories::find_by_legacy_name(&conn, "Does Not Exist")
        .unwrap()
        .is_none());
}

#[test]
fn create_custom_category_in_existing_or_new_group() {
    let conn = open_in_memory().unwrap();
    let id = categories::create(
        &conn,
        &NewCategory {
            group: "Pets".into(),
            name: "Vet".into(),
            emoji: Some("🐾".into()),
            color: None,
            budget_cents: Some(5000),
            excluded: false,
            kind: CategoryKind::Expense,
        },
    )
    .unwrap();
    let cat = categories::get(&conn, id).unwrap();
    assert_eq!(cat.name, "Vet");
    assert_eq!(cat.budget_cents, Some(5000));
    assert!(categories::list_groups(&conn)
        .unwrap()
        .iter()
        .any(|g| g.name == "Pets"));
    let again = categories::create(
        &conn,
        &NewCategory {
            group: "Pets".into(),
            name: "Vet".into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        },
    );
    assert!(again.is_err(), "duplicate within a group is rejected");
}

#[test]
fn update_budget_and_excluded_flag() {
    let conn = open_in_memory().unwrap();
    let cat = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap();
    categories::update(
        &conn,
        cat.id,
        &categories::CategoryPatch {
            budget_cents: Some(Some(60000)),
            excluded: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let after = categories::get(&conn, cat.id).unwrap();
    assert_eq!(after.budget_cents, Some(60000));
    assert!(after.excluded);
}

#[test]
fn find_or_create_by_legacy_name_creates_custom_under_other() {
    let conn = open_in_memory().unwrap();
    let before = categories::list(&conn).unwrap().len();
    let a = categories::find_or_create_by_legacy_name(&conn, "Wedding - Venue").unwrap();
    let b = categories::find_or_create_by_legacy_name(&conn, "Wedding - Venue").unwrap();
    assert_eq!(a, b);
    assert_eq!(categories::list(&conn).unwrap().len(), before + 1);
    let cat = categories::get(&conn, a).unwrap();
    assert_eq!(cat.name, "Venue");
    let group = categories::list_groups(&conn)
        .unwrap()
        .into_iter()
        .find(|g| g.id == cat.group_id)
        .unwrap();
    assert_eq!(group.name, "Wedding");
    let plain = categories::find_or_create_by_legacy_name(&conn, "Hobbies").unwrap();
    let plain_cat = categories::get(&conn, plain).unwrap();
    assert_eq!(plain_cat.name, "Hobbies");
}

// ---------- category management: names and delete ----------

mod manage {
    use chrono::NaiveDate;
    use slaybudget_core::categories::{
        self, CategoryKind, CategoryPatch, DeleteReport, NewCategory,
    };
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::error::CoreError;
    use slaybudget_core::profiles::{self, SourceKind};
    use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, SplitPart};

    fn new_cat(group: &str, name: &str) -> NewCategory {
        NewCategory {
            group: group.into(),
            name: name.into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        }
    }

    fn id_of(conn: &rusqlite::Connection, legacy: &str) -> i64 {
        categories::find_by_legacy_name(conn, legacy)
            .unwrap()
            .unwrap()
            .id
    }

    fn add_tx(conn: &rusqlite::Connection, cat: i64, day: &str, cents: i64) -> i64 {
        let p = profiles::create(conn, &format!("P{day}{cents}"), None).unwrap();
        let s = profiles::find_or_create_source(conn, p, "Amex", SourceKind::Csv).unwrap();
        let tx = NewTransaction {
            profile_id: p,
            source_id: s,
            posted_on: NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap(),
            description: "X".into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: Some(cat),
            import_id: None,
        };
        match transactions::insert(conn, &tx).unwrap() {
            InsertOutcome::Inserted(id) => id,
            _ => panic!("duplicate"),
        }
    }

    fn category_of(conn: &rusqlite::Connection, tx: i64) -> Option<i64> {
        conn.query_row(
            "SELECT category_id FROM transactions WHERE id = ?1",
            [tx],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn normalized_name_ignores_case_emoji_and_spaces() {
        assert_eq!(
            categories::normalized_name(" ☕️ Coffee "),
            categories::normalized_name("coffee")
        );
        assert_eq!(categories::normalized_name("Food  &  Drink"), "food drink");
    }

    #[test]
    fn create_unique_refuses_a_duplicate_name() {
        let conn = open_in_memory().unwrap();
        categories::create_unique(&conn, &new_cat("Drinks", "Coffee")).unwrap();
        let again = categories::create_unique(&conn, &new_cat("Other", "☕️ coffee"));
        assert!(matches!(again, Err(CoreError::Invalid(_))));
        assert!(matches!(
            categories::create_unique(&conn, &new_cat("Other", "  ")),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn rename_refuses_blank_and_duplicate_names() {
        let conn = open_in_memory().unwrap();
        let fuel = id_of(&conn, "Transportation - Fuel");
        let rename = |id: i64, name: &str| {
            categories::update(
                &conn,
                id,
                &CategoryPatch {
                    name: Some(name.into()),
                    ..Default::default()
                },
            )
        };
        assert!(matches!(rename(fuel, "  "), Err(CoreError::Invalid(_))));
        assert!(matches!(
            rename(fuel, "GROCERIES"),
            Err(CoreError::Invalid(_))
        ));
        rename(fuel, "FUEL").unwrap(); // its own name in another case is fine
        assert_eq!(categories::get(&conn, fuel).unwrap().name, "FUEL");
    }

    #[test]
    fn delete_moves_transactions_including_split_parts_to_other() {
        let conn = open_in_memory().unwrap();
        let other = id_of(&conn, "Other");
        let fuel = id_of(&conn, "Transportation - Fuel");
        let a = add_tx(&conn, fuel, "2026-06-01", -4000);
        let b = add_tx(&conn, fuel, "2026-06-02", -3000);
        let parts = transactions::split(
            &conn,
            b,
            &[
                SplitPart {
                    amount_cents: -1000,
                    category_id: Some(fuel),
                    description: None,
                },
                SplitPart {
                    amount_cents: -2000,
                    category_id: Some(fuel),
                    description: None,
                },
            ],
        )
        .unwrap();
        let report = categories::delete(&conn, fuel).unwrap();
        assert_eq!(report, DeleteReport { moved: 4 });
        for t in [a, b, parts[0], parts[1]] {
            assert_eq!(category_of(&conn, t), Some(other));
        }
        assert!(categories::get(&conn, fuel).is_err());
    }

    #[test]
    fn delete_removes_learned_merchants_and_rules() {
        let conn = open_in_memory().unwrap();
        let fuel = id_of(&conn, "Transportation - Fuel");
        conn.execute(
            "INSERT INTO merchant_rules (merchant, category_id) VALUES ('shell', ?1)",
            [fuel],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rules (name, match_kind, pattern, category_id) VALUES ('Shell', 'contains', 'SHELL', ?1)",
            [fuel],
        )
        .unwrap();
        categories::delete(&conn, fuel).unwrap();
        let count = |table: &str| -> i64 {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE category_id = ?1"),
                [fuel],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(count("merchant_rules"), 0);
        assert_eq!(count("rules"), 0);
    }

    #[test]
    fn delete_removes_the_group_when_left_empty_and_keeps_it_otherwise() {
        let conn = open_in_memory().unwrap();
        let solo = categories::create(&conn, &new_cat("Kids", "Toys")).unwrap();
        let first = categories::create(&conn, &new_cat("Pets", "Vet")).unwrap();
        categories::create(&conn, &new_cat("Pets", "Food")).unwrap();
        categories::delete(&conn, solo).unwrap();
        categories::delete(&conn, first).unwrap();
        let groups: Vec<String> = categories::list_groups(&conn)
            .unwrap()
            .into_iter()
            .map(|g| g.name)
            .collect();
        assert!(!groups.contains(&"Kids".to_string()));
        assert!(groups.contains(&"Pets".to_string()));
    }

    #[test]
    fn other_cannot_be_deleted_even_after_rename() {
        let conn = open_in_memory().unwrap();
        let other = id_of(&conn, "Other");
        assert!(categories::is_other(&conn, other).unwrap());
        categories::update(
            &conn,
            other,
            &CategoryPatch {
                name: Some("Misc".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(matches!(
            categories::delete(&conn, other),
            Err(CoreError::Invalid(_))
        ));
        assert!(categories::get(&conn, other).is_ok());
    }
}

mod groups {
    use slaybudget_core::categories::{self, CategoryKind, GroupTarget, NewCategory};
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::error::CoreError;

    fn cat(group: &str, name: &str) -> NewCategory {
        NewCategory {
            group: group.into(),
            name: name.into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        }
    }

    fn group_name(conn: &rusqlite::Connection, cat: i64) -> String {
        let g = categories::get(conn, cat).unwrap().group_id;
        categories::list_groups(conn)
            .unwrap()
            .into_iter()
            .find(|x| x.id == g)
            .unwrap()
            .name
    }

    fn group_id(conn: &rusqlite::Connection, name: &str) -> Option<i64> {
        categories::list_groups(conn)
            .unwrap()
            .into_iter()
            .find(|g| g.name == name)
            .map(|g| g.id)
    }

    #[test]
    fn move_into_existing_group() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Fun", "Games")).unwrap();
        categories::move_to_group(
            &conn,
            toys,
            GroupTarget::Existing(group_id(&conn, "Fun").unwrap()),
        )
        .unwrap();
        assert_eq!(group_name(&conn, toys), "Fun");
    }

    #[test]
    fn start_a_new_group_creates_it_and_moves_the_category() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Kids", "Clothes")).unwrap();
        categories::move_to_group(&conn, toys, GroupTarget::New("Hobbies".into())).unwrap();
        assert_eq!(group_name(&conn, toys), "Hobbies");
        assert!(matches!(
            categories::move_to_group(&conn, toys, GroupTarget::New("kids".into())),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn remove_from_group_makes_it_top_level() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Kids", "Clothes")).unwrap();
        categories::move_to_group(&conn, toys, GroupTarget::Own).unwrap();
        assert_eq!(group_name(&conn, toys), "Toys");
        assert!(
            group_id(&conn, "Kids").is_some(),
            "the old group still has Clothes"
        );
    }

    #[test]
    fn remove_from_group_refuses_when_a_group_with_that_name_holds_others() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Toys", "Lego")).unwrap();
        assert!(matches!(
            categories::move_to_group(&conn, toys, GroupTarget::Own),
            Err(CoreError::Invalid(_))
        ));
        assert_eq!(group_name(&conn, toys), "Kids");
    }

    #[test]
    fn rename_group_refuses_blank_and_duplicate() {
        let conn = open_in_memory().unwrap();
        categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Fun", "Games")).unwrap();
        let kids = group_id(&conn, "Kids").unwrap();
        assert!(matches!(
            categories::rename_group(&conn, kids, "  "),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            categories::rename_group(&conn, kids, "FUN"),
            Err(CoreError::Invalid(_))
        ));
        categories::rename_group(&conn, kids, "Children").unwrap();
        assert!(group_id(&conn, "Children").is_some());
    }

    #[test]
    fn ungroup_gives_each_category_its_own_group_and_removes_the_old_one() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        let clothes = categories::create(&conn, &cat("Kids", "Clothes")).unwrap();
        categories::ungroup(&conn, group_id(&conn, "Kids").unwrap()).unwrap();
        assert_eq!(group_name(&conn, toys), "Toys");
        assert_eq!(group_name(&conn, clothes), "Clothes");
        assert!(group_id(&conn, "Kids").is_none());
    }

    #[test]
    fn moving_the_last_category_out_removes_the_empty_group() {
        let conn = open_in_memory().unwrap();
        let toys = categories::create(&conn, &cat("Kids", "Toys")).unwrap();
        categories::create(&conn, &cat("Fun", "Games")).unwrap();
        categories::move_to_group(
            &conn,
            toys,
            GroupTarget::Existing(group_id(&conn, "Fun").unwrap()),
        )
        .unwrap();
        assert!(group_id(&conn, "Kids").is_none());
    }

    #[test]
    fn create_in_with_own_makes_a_top_level_category_and_checks_the_name() {
        let conn = open_in_memory().unwrap();
        let bikes =
            categories::create_in(&conn, &cat("ignored", "Bikes"), GroupTarget::Own).unwrap();
        assert_eq!(group_name(&conn, bikes), "Bikes");
        assert!(matches!(
            categories::create_in(&conn, &cat("x", "bikes"), GroupTarget::Own),
            Err(CoreError::Invalid(_))
        ));
        let fun = categories::create_in(&conn, &cat("x", "Arcade"), GroupTarget::New("Fun".into()))
            .unwrap();
        assert_eq!(group_name(&conn, fun), "Fun");
    }
}

#[test]
fn group_target_reads_the_json_the_app_sends() {
    use slaybudget_core::categories::GroupTarget;
    let parse = |s: &str| serde_json::from_str::<GroupTarget>(s).unwrap();
    assert_eq!(parse(r#""own""#), GroupTarget::Own);
    assert_eq!(parse(r#"{"existing":5}"#), GroupTarget::Existing(5));
    assert_eq!(
        parse(r#"{"new":"Drinks"}"#),
        GroupTarget::New("Drinks".into())
    );
}

mod top_level_rename {
    use slaybudget_core::categories::{
        self, CategoryKind, CategoryPatch, GroupTarget, NewCategory,
    };
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::error::CoreError;

    fn cat(name: &str) -> NewCategory {
        NewCategory {
            group: name.into(),
            name: name.into(),
            emoji: None,
            color: None,
            budget_cents: None,
            excluded: false,
            kind: CategoryKind::Expense,
        }
    }
    fn group_name(conn: &rusqlite::Connection, id: i64) -> String {
        let g = categories::get(conn, id).unwrap().group_id;
        categories::list_groups(conn)
            .unwrap()
            .into_iter()
            .find(|x| x.id == g)
            .unwrap()
            .name
    }

    #[test]
    fn renaming_a_top_level_category_renames_its_own_group() {
        let conn = open_in_memory().unwrap();
        let trips = categories::create_in(&conn, &cat("Trips"), GroupTarget::Own).unwrap();
        categories::update(
            &conn,
            trips,
            &CategoryPatch {
                name: Some("Vacations".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(group_name(&conn, trips), "Vacations");
    }

    #[test]
    fn renaming_a_grouped_category_leaves_the_group_alone() {
        let conn = open_in_memory().unwrap();
        let a =
            categories::create_in(&conn, &cat("Toys"), GroupTarget::New("Kids".into())).unwrap();
        categories::create_in(
            &conn,
            &cat("Clothes"),
            GroupTarget::Existing(categories::get(&conn, a).unwrap().group_id),
        )
        .unwrap();
        categories::update(
            &conn,
            a,
            &CategoryPatch {
                name: Some("Games".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(group_name(&conn, a), "Kids");
    }

    #[test]
    fn renaming_a_top_level_category_to_an_existing_group_name_is_refused() {
        let conn = open_in_memory().unwrap();
        let trips = categories::create_in(&conn, &cat("Trips"), GroupTarget::Own).unwrap();
        categories::create_in(&conn, &cat("Toys"), GroupTarget::New("Kids".into())).unwrap();
        let r = categories::update(
            &conn,
            trips,
            &CategoryPatch {
                name: Some("Kids".into()),
                ..Default::default()
            },
        );
        assert!(matches!(r, Err(CoreError::Invalid(_))));
        assert_eq!(categories::get(&conn, trips).unwrap().name, "Trips");
    }
}

#[test]
fn usage_counts_every_transaction_that_delete_would_move() {
    use chrono::NaiveDate;
    use slaybudget_core::profiles::{self, SourceKind};
    use slaybudget_core::transactions::{self, InsertOutcome, NewTransaction, SplitPart};
    let conn = open_in_memory().unwrap();
    let fuel = categories::find_by_legacy_name(&conn, "Transportation - Fuel")
        .unwrap()
        .unwrap()
        .id;
    let p = profiles::create(&conn, "A", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    let mut ids = vec![];
    for (day, cents) in [("2026-06-01", -4000), ("2026-06-02", -3000)] {
        let tx = NewTransaction {
            profile_id: p,
            source_id: s,
            posted_on: NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap(),
            description: "X".into(),
            amount_cents: cents,
            currency: "USD".into(),
            occurrence: 0,
            category_id: Some(fuel),
            import_id: None,
        };
        if let InsertOutcome::Inserted(id) = transactions::insert(&conn, &tx).unwrap() {
            ids.push(id)
        }
    }
    transactions::split(
        &conn,
        ids[1],
        &[
            SplitPart {
                amount_cents: -1000,
                category_id: Some(fuel),
                description: None,
            },
            SplitPart {
                amount_cents: -2000,
                category_id: Some(fuel),
                description: None,
            },
        ],
    )
    .unwrap();
    assert_eq!(categories::usage(&conn, fuel).unwrap(), 4);
    assert_eq!(categories::delete(&conn, fuel).unwrap().moved, 4);
}

#[test]
fn categories_created_by_name_get_a_fitting_emoji() {
    let conn = slaybudget_core::db::open_in_memory().unwrap();
    for (name, emoji) in [
        ("Wedding", "💍"),
        ("Legal", "⚖️"),
        ("Coffee Shop", "☕"),
        ("Housing & Utilities - Rent", "🏠"),
        ("Zorbing", "🏷️"),
    ] {
        let id = categories::find_or_create_by_legacy_name(&conn, name).unwrap();
        assert_eq!(
            categories::get(&conn, id).unwrap().emoji.as_deref(),
            Some(emoji),
            "{name}"
        );
    }
}

#[test]
fn missing_emojis_are_filled_in_and_chosen_ones_kept() {
    let conn = slaybudget_core::db::open_in_memory().unwrap();
    let id = categories::find_or_create_by_legacy_name(&conn, "Nespresso").unwrap();
    conn.execute("UPDATE categories SET emoji = NULL WHERE id = ?1", [id])
        .unwrap();
    let groceries = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap();
    assert_eq!(categories::fill_missing_emojis(&conn).unwrap(), 1);
    assert_eq!(
        categories::get(&conn, id).unwrap().emoji.as_deref(),
        Some("☕")
    );
    assert_eq!(
        categories::get(&conn, groceries.id).unwrap().emoji,
        groceries.emoji
    );
}

#[test]
fn emoji_suggestions_match_whole_words_not_fragments() {
    assert_eq!(categories::suggest_emoji("Card Payment"), "🏷️");
    assert_eq!(categories::suggest_emoji("Barber"), "🏷️");
    assert_eq!(categories::suggest_emoji("Car Wash"), "🚗");
    assert_eq!(categories::suggest_emoji("Entertainment - Outdoors"), "🏕️");
}
