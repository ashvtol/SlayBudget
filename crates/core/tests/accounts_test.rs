use slaybudget_core::accounts::{self, AccountType, Choice, NewAccount};
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline::{self, StatementFile};
use slaybudget_core::profiles;
use slaybudget_core::tags;
use slaybudget_core::transactions::{self, TransactionFilter};

const CHASE_HEAD: &str = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n";
fn chase(rows: &[(&str, &str, &str)]) -> String {
    let mut s = CHASE_HEAD.to_string();
    for (d, desc, amt) in rows {
        s.push_str(&format!("{d},{d},{desc},Shopping,Sale,{amt},\n"));
    }
    s
}
fn setup() -> (rusqlite::Connection, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    (conn, p)
}
fn import(
    conn: &rusqlite::Connection,
    p: i64,
    path: &str,
    text: &str,
    choice: Option<Choice>,
) -> pipeline::ImportReport {
    pipeline::import_file(conn, p, path, StatementFile::Csv(text), choice).unwrap()
}
fn new_account(name: &str) -> Choice {
    Choice::New {
        account: NewAccount {
            name: name.into(),
            institution: Some("Chase".into()),
            account_type: Some(AccountType::Card),
            color: Some("#4b7bec".into()),
            default_tag_id: None,
        },
        remember: true,
    }
}
fn account_of(conn: &rusqlite::Connection, desc: &str) -> String {
    let t = transactions::list(conn, &TransactionFilter::default())
        .unwrap()
        .into_iter()
        .find(|t| t.description == desc)
        .unwrap();
    profiles::list_all_sources(conn)
        .unwrap()
        .into_iter()
        .find(|s| s.id == t.source_id)
        .unwrap()
        .name
}

#[test]
fn an_unknown_file_asks_once_then_its_layout_is_remembered() {
    let (conn, p) = setup();
    let first = import(
        &conn,
        p,
        "activity.csv",
        &chase(&[
            ("11/03/2026", "UBER TRIP", "-12.00"),
            ("11/05/2026", "SHELL", "-40.00"),
        ]),
        None,
    );
    let ask = first.needs_account.expect("asks which account");
    assert_eq!(first.inserted, 0);
    assert_eq!(ask.guess, None);
    assert_eq!(ask.suggested_name, "New account");
    assert_eq!(
        (
            ask.preview.rows,
            ask.preview.first.as_deref(),
            ask.preview.last.as_deref()
        ),
        (2, Some("2026-11-03"), Some("2026-11-05"))
    );
    assert_eq!(ask.preview.sample[0].description, "UBER TRIP");
    assert!(
        transactions::list(&conn, &TransactionFilter::default())
            .unwrap()
            .is_empty(),
        "nothing imported yet"
    );

    let done = import(
        &conn,
        p,
        "activity.csv",
        &chase(&[
            ("11/03/2026", "UBER TRIP", "-12.00"),
            ("11/05/2026", "SHELL", "-40.00"),
        ]),
        Some(new_account("Chase Freedom")),
    );
    assert_eq!(
        (done.inserted, done.source_name.as_str()),
        (2, "Chase Freedom")
    );
    let src = profiles::list_all_sources(&conn)
        .unwrap()
        .into_iter()
        .find(|s| s.name == "Chase Freedom")
        .unwrap();
    assert_eq!(
        (
            src.institution.as_deref(),
            src.account_type.as_deref(),
            src.color.as_deref()
        ),
        (Some("Chase"), Some("card"), Some("#4b7bec"))
    );

    let next = import(
        &conn,
        p,
        "activity (1).csv",
        &chase(&[("12/02/2026", "TARGET", "-25.00")]),
        None,
    );
    assert!(
        next.needs_account.is_none(),
        "the layout now belongs to Chase Freedom"
    );
    assert_eq!(account_of(&conn, "TARGET"), "Chase Freedom");
}

#[test]
fn two_cards_with_the_same_layout_are_told_apart_by_their_last_4() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "Chase1004_Activity.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Freedom")),
    );
    // Same layout, other card: the layout's owner has a different ending, so it asks, guessing Freedom.
    let ask = import(
        &conn,
        p,
        "Chase7781_Activity.csv",
        &chase(&[("11/04/2026", "COSTCO", "-80.00")]),
        None,
    )
    .needs_account
    .expect("asks");
    assert_eq!(ask.suggested_name, "Chase ••7781");
    let freedom = profiles::list_all_sources(&conn)
        .unwrap()
        .into_iter()
        .find(|s| s.name == "Freedom")
        .unwrap()
        .id;
    assert_eq!(ask.guess, Some(freedom));
    import(
        &conn,
        p,
        "Chase7781_Activity.csv",
        &chase(&[("11/04/2026", "COSTCO", "-80.00")]),
        Some(new_account("Sapphire")),
    );

    import(
        &conn,
        p,
        "Chase1004_Activity (2).csv",
        &chase(&[("12/01/2026", "LYFT", "-9.00")]),
        None,
    );
    import(
        &conn,
        p,
        "Chase7781_Activity (2).csv",
        &chase(&[("12/01/2026", "WHOLE FOODS", "-50.00")]),
        None,
    );
    assert_eq!(account_of(&conn, "LYFT"), "Freedom");
    assert_eq!(account_of(&conn, "WHOLE FOODS"), "Sapphire");

    // A layout two accounts share, with no ending in the file: ask.
    let shared = import(
        &conn,
        p,
        "activity.csv",
        &chase(&[("12/09/2026", "CVS", "-7.00")]),
        None,
    );
    assert!(shared.needs_account.is_some());
}

#[test]
fn a_file_in_an_account_folder_goes_to_that_account() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "nov.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Amex Gold")),
    );
    let other = "Date,Description,Amount\n2026-11-08,COFFEE,-4.50\n";
    let r = import(&conn, p, "Statements/Amex Gold/coffee.csv", other, None);
    assert!(r.needs_account.is_none());
    assert_eq!(account_of(&conn, "COFFEE"), "Amex Gold");
}

#[test]
fn choosing_an_existing_account_remembers_unless_told_not_to() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "a.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Freedom")),
    );
    let freedom = profiles::list_all_sources(&conn)
        .unwrap()
        .into_iter()
        .find(|s| s.name == "Freedom")
        .unwrap()
        .id;
    let generic = |d: &str, desc: &str| format!("Date,Description,Amount\n{d},{desc},-4.50\n");
    import(
        &conn,
        p,
        "x.csv",
        &generic("2026-11-08", "COFFEE"),
        Some(Choice::Existing {
            source_id: freedom,
            remember: false,
        }),
    );
    assert!(
        import(&conn, p, "y.csv", &generic("2026-11-09", "TEA"), None)
            .needs_account
            .is_some(),
        "not remembered"
    );
    import(
        &conn,
        p,
        "y.csv",
        &generic("2026-11-09", "TEA"),
        Some(Choice::Existing {
            source_id: freedom,
            remember: true,
        }),
    );
    assert!(
        import(&conn, p, "z.csv", &generic("2026-11-10", "JUICE"), None)
            .needs_account
            .is_none()
    );
    assert_eq!(
        accounts::clues_of(&conn, freedom).unwrap().len(),
        2,
        "Chase layout and the generic layout"
    );
}

#[test]
fn an_account_default_tag_goes_on_what_it_imports() {
    let (conn, p) = setup();
    let business = tags::create(&conn, "Business", None).unwrap();
    let mut choice = new_account("Ink");
    if let Choice::New { account, .. } = &mut choice {
        account.default_tag_id = Some(business);
    }
    import(
        &conn,
        p,
        "ink.csv",
        &chase(&[
            ("11/03/2026", "STAPLES", "-30.00"),
            ("11/04/2026", "FEDEX", "-12.00"),
        ]),
        Some(choice),
    );
    let rows = transactions::list(&conn, &TransactionFilter::default()).unwrap();
    assert!(rows.iter().all(|t| t.tag_ids == vec![business]), "{rows:?}");
}

#[test]
fn a_file_already_imported_never_asks() {
    let (conn, p) = setup();
    let text = chase(&[("11/03/2026", "UBER", "-12.00")]);
    import(&conn, p, "a.csv", &text, Some(new_account("Freedom")));
    let again = import(&conn, p, "copy of a.csv", &text, None);
    assert!(again.already_imported && again.needs_account.is_none());
}

#[test]
fn an_amex_export_is_read_the_amex_way_once_the_account_is_known() {
    let (conn, p) = setup();
    // The short Amex export shows charges as positive amounts.
    let amex =
        "Date,Description,Card Member,Account #,Amount\n11/03/2026,TRADER JOES,ASH,-21004,62.10\n";
    let ask = import(&conn, p, "activity.csv", amex, None)
        .needs_account
        .expect("asks");
    assert_eq!(ask.suggested_name, "American Express ••1004");
    import(
        &conn,
        p,
        "activity.csv",
        amex,
        Some(Choice::New {
            account: NewAccount {
                name: "Amex Gold".into(),
                institution: Some("American Express".into()),
                account_type: Some(AccountType::Card),
                color: None,
                default_tag_id: None,
            },
            remember: true,
        }),
    );
    let t = &transactions::list(&conn, &TransactionFilter::default()).unwrap()[0];
    assert_eq!(t.amount_cents, -6210, "a charge is money out");
}

fn id_of(conn: &rusqlite::Connection, name: &str) -> i64 {
    profiles::list_all_sources(conn)
        .unwrap()
        .into_iter()
        .find(|s| s.name == name)
        .unwrap()
        .id
}

#[test]
fn moving_an_import_moves_its_rows_drops_ones_the_account_has_and_is_undoable() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "a.csv",
        &chase(&[("11/01/2026", "KEEP", "-1.00")]),
        Some(new_account("Sapphire")),
    );
    // Sapphire already has the 11/03 Uber (from another file).
    let generic = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/03/2026,11/03/2026,UBER TRIP,Shopping,Sale,-12.00,\n11/02/2026,11/02/2026,OTHER,Shopping,Sale,-2.00,\n";
    import(
        &conn,
        p,
        "b.csv",
        generic,
        Some(Choice::Existing {
            source_id: id_of(&conn, "Sapphire"),
            remember: false,
        }),
    );
    let wrong = import(
        &conn,
        p,
        "nov.csv",
        &chase(&[
            ("11/03/2026", "UBER TRIP", "-12.00"),
            ("11/05/2026", "SHELL", "-40.00"),
            ("11/06/2026", "CVS", "-7.00"),
        ]),
        Some(new_account("Freedom")),
    );
    let import_id = wrong.import_id.unwrap();
    let count = |c: &rusqlite::Connection, name: &str| {
        transactions::list(c, &TransactionFilter::default())
            .unwrap()
            .iter()
            .filter(|t| t.source_id == id_of(c, name))
            .count()
    };
    let before = (count(&conn, "Freedom"), count(&conn, "Sapphire"));
    assert_eq!(before, (3, 3));

    let mut stack = slaybudget_core::undo::UndoStack::new();
    let report = stack
        .record(&conn, "Move Import", |c| {
            accounts::move_import(c, import_id, id_of(c, "Sapphire"))
        })
        .unwrap();
    assert_eq!((report.moved, report.dropped), (2, 1));
    assert_eq!((count(&conn, "Freedom"), count(&conn, "Sapphire")), (0, 5));
    let rec = slaybudget_core::imports::list(&conn)
        .unwrap()
        .into_iter()
        .find(|i| i.id == import_id)
        .unwrap();
    assert_eq!(rec.source_name, "Sapphire");
    // Moved rows are now Sapphire's for good: importing the same rows into Sapphire again adds nothing.
    let again = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/05/2026,11/05/2026,SHELL,Shopping,Sale,-40.00,\n11/30/2026,11/30/2026,NEW,Shopping,Sale,-1.00,\n";
    let r = import(
        &conn,
        p,
        "c.csv",
        again,
        Some(Choice::Existing {
            source_id: id_of(&conn, "Sapphire"),
            remember: false,
        }),
    );
    assert_eq!((r.inserted, r.duplicates), (1, 1));

    assert_eq!(stack.undo(&conn).unwrap().as_deref(), Some("Move Import"));
    assert_eq!(count(&conn, "Freedom"), 3, "undo puts them back");
}

#[test]
fn a_default_tag_can_also_go_on_what_the_account_already_has_and_removing_it_untags_nothing() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "ink.csv",
        &chase(&[
            ("11/03/2026", "STAPLES", "-30.00"),
            ("11/04/2026", "FEDEX", "-12.00"),
        ]),
        Some(new_account("Ink")),
    );
    let ink = id_of(&conn, "Ink");
    let business = tags::create(&conn, "Business", None).unwrap();
    assert_eq!(
        accounts::set_default_tag(&conn, ink, Some(business), false).unwrap(),
        0,
        "only new imports"
    );
    assert!(transactions::list(&conn, &TransactionFilter::default())
        .unwrap()
        .iter()
        .all(|t| t.tag_ids.is_empty()));
    assert_eq!(
        accounts::set_default_tag(&conn, ink, Some(business), true).unwrap(),
        2
    );
    assert!(transactions::list(&conn, &TransactionFilter::default())
        .unwrap()
        .iter()
        .all(|t| t.tag_ids == vec![business]));
    accounts::set_default_tag(&conn, ink, None, true).unwrap();
    assert!(transactions::list(&conn, &TransactionFilter::default())
        .unwrap()
        .iter()
        .all(|t| t.tag_ids == vec![business]));
    assert_eq!(
        profiles::list_all_sources(&conn)
            .unwrap()
            .into_iter()
            .find(|s| s.id == ink)
            .unwrap()
            .default_tag_id,
        None
    );
}

#[test]
fn an_account_can_be_edited_and_names_stay_unique() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "a.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Freedom")),
    );
    import(
        &conn,
        p,
        "b.csv",
        "Date,Description,Amount\n2026-11-08,COFFEE,-4.50\n",
        Some(new_account("Sapphire")),
    );
    let freedom = id_of(&conn, "Freedom");
    accounts::update(
        &conn,
        freedom,
        &accounts::AccountPatch {
            name: Some("Freedom Flex".into()),
            institution: Some(Some("Chase".into())),
            account_type: Some(Some(AccountType::Checking)),
            color: Some(Some("#e8743b".into())),
        },
    )
    .unwrap();
    let s = profiles::list_all_sources(&conn)
        .unwrap()
        .into_iter()
        .find(|s| s.id == freedom)
        .unwrap();
    assert_eq!(
        (
            s.name.as_str(),
            s.account_type.as_deref(),
            s.color.as_deref()
        ),
        ("Freedom Flex", Some("checking"), Some("#e8743b"))
    );
    let clash = accounts::update(
        &conn,
        freedom,
        &accounts::AccountPatch {
            name: Some("sapphire".into()),
            ..Default::default()
        },
    );
    assert!(clash.unwrap_err().to_string().contains("already exists"));
}

#[test]
fn account_folder_names_are_safe_for_the_file_system() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "a.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Amex / Gold: Main")),
    );
    import(
        &conn,
        p,
        "b.csv",
        "Date,Description,Amount\n2026-11-08,COFFEE,-4.50\n",
        Some(new_account("Chase ••1004")),
    );
    assert_eq!(
        accounts::folder_names(&conn, p).unwrap(),
        vec!["Amex - Gold - Main", "Chase ••1004"]
    );
}

#[test]
fn a_file_in_a_made_folder_is_recognized_even_when_the_name_had_unsafe_characters() {
    let (conn, p) = setup();
    import(
        &conn,
        p,
        "a.csv",
        &chase(&[("11/03/2026", "UBER", "-12.00")]),
        Some(new_account("Amex / Gold")),
    );
    let r = import(
        &conn,
        p,
        "/Users/me/Statements/Amex - Gold/x.csv",
        "Date,Description,Amount\n2026-11-08,TEA,-4.50\n",
        None,
    );
    assert!(r.needs_account.is_none());
    assert_eq!(account_of(&conn, "TEA"), "Amex / Gold");
}
