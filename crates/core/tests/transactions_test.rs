use chrono::NaiveDate;
use slaybudget_core::categories;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::profiles::{self, SourceKind};
use slaybudget_core::transactions::{
    self, InsertOutcome, NewTransaction, TransactionFilter, TransactionPatch,
};

fn setup() -> (rusqlite::Connection, i64, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::create(&conn, "Alex", None).unwrap();
    let s = profiles::find_or_create_source(&conn, p, "Amex", SourceKind::Csv).unwrap();
    (conn, p, s)
}

fn tx(profile_id: i64, source_id: i64, date: &str, desc: &str, cents: i64) -> NewTransaction {
    NewTransaction {
        profile_id,
        source_id,
        posted_on: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
        description: desc.to_string(),
        amount_cents: cents,
        currency: "USD".into(),
        occurrence: 0,
        category_id: None,
        import_id: None,
    }
}

#[test]
fn insert_then_reinsert_is_deduplicated() {
    let (conn, p, s) = setup();
    let first = transactions::insert(
        &conn,
        &tx(p, s, "2026-11-14", "WHOLE FOODS MKT 10234", -6418),
    )
    .unwrap();
    let second = transactions::insert(
        &conn,
        &tx(p, s, "2026-11-14", "WHOLE FOODS MKT 10234", -6418),
    )
    .unwrap();
    let InsertOutcome::Inserted(id) = first else {
        panic!("expected insert")
    };
    assert_eq!(second, InsertOutcome::Duplicate(id));
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        1
    );
}

#[test]
fn same_day_same_amount_with_different_occurrence_both_insert() {
    let (conn, p, s) = setup();
    let mut a = tx(p, s, "2026-11-14", "STARBUCKS 4412", -575);
    let mut b = a.clone();
    a.occurrence = 0;
    b.occurrence = 1;
    assert!(matches!(
        transactions::insert(&conn, &a).unwrap(),
        InsertOutcome::Inserted(_)
    ));
    assert!(matches!(
        transactions::insert(&conn, &b).unwrap(),
        InsertOutcome::Inserted(_)
    ));
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p)).unwrap(),
        2
    );
}

#[test]
fn merchant_is_derived_and_stored() {
    let (conn, p, s) = setup();
    let InsertOutcome::Inserted(id) = transactions::insert(
        &conn,
        &tx(
            p,
            s,
            "2026-11-14",
            "Debit Card Purchase 11/13 04:55p #1234 COSTCO WHSE",
            -12034,
        ),
    )
    .unwrap() else {
        panic!()
    };
    let t = transactions::get(&conn, id).unwrap();
    assert_eq!(t.merchant, "costco whse");
}

#[test]
fn list_filters_by_date_category_source_review_and_text() {
    let (conn, p, s) = setup();
    let s2 = profiles::find_or_create_source(&conn, p, "Citi", SourceKind::Csv).unwrap();
    let groceries = categories::find_by_legacy_name(&conn, "Groceries")
        .unwrap()
        .unwrap()
        .id;
    let fuel = categories::find_by_legacy_name(&conn, "Transportation - Fuel")
        .unwrap()
        .unwrap()
        .id;
    let mut a = tx(p, s, "2026-11-01", "WHOLE FOODS", -5000);
    a.category_id = Some(groceries);
    let mut b = tx(p, s2, "2026-11-10", "SHELL OIL 123", -4800);
    b.category_id = Some(fuel);
    let c = tx(p, s, "2026-10-05", "NETFLIX.COM", -1799);
    let InsertOutcome::Inserted(a_id) = transactions::insert(&conn, &a).unwrap() else {
        panic!()
    };
    transactions::insert(&conn, &b).unwrap();
    transactions::insert(&conn, &c).unwrap();
    transactions::update(
        &conn,
        a_id,
        &TransactionPatch {
            reviewed: Some(true),
            ..Default::default()
        },
    )
    .unwrap();

    let all = transactions::list(&conn, &TransactionFilter::for_profile(p)).unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].description, "SHELL OIL 123", "newest first");

    let november = TransactionFilter {
        from: Some(NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()),
        to: Some(NaiveDate::from_ymd_opt(2026, 11, 30).unwrap()),
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::list(&conn, &november).unwrap().len(), 2);

    let by_cat = TransactionFilter {
        category_ids: vec![fuel],
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::list(&conn, &by_cat).unwrap().len(), 1);

    let by_src = TransactionFilter {
        source_ids: vec![s2],
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(
        transactions::list(&conn, &by_src).unwrap()[0].description,
        "SHELL OIL 123"
    );

    let unreviewed = TransactionFilter {
        reviewed: Some(false),
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::list(&conn, &unreviewed).unwrap().len(), 2);

    let text = TransactionFilter {
        text: Some("netflix".into()),
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::list(&conn, &text).unwrap().len(), 1);

    let paged = TransactionFilter {
        limit: Some(2),
        offset: 1,
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::list(&conn, &paged).unwrap().len(), 2);
}

#[test]
fn combined_view_spans_profiles() {
    let (conn, p, s) = setup();
    let p2 = profiles::create(&conn, "Jamie", None).unwrap();
    let s2 = profiles::find_or_create_source(&conn, p2, "Chase", SourceKind::Csv).unwrap();
    transactions::insert(&conn, &tx(p, s, "2026-11-01", "A", -100)).unwrap();
    transactions::insert(&conn, &tx(p2, s2, "2026-11-02", "B", -200)).unwrap();
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::combined()).unwrap(),
        2
    );
    assert_eq!(
        transactions::count(&conn, &TransactionFilter::for_profile(p2)).unwrap(),
        1
    );
}

#[test]
fn update_category_notes_and_lock() {
    let (conn, p, s) = setup();
    let fuel = categories::find_by_legacy_name(&conn, "Transportation - Fuel")
        .unwrap()
        .unwrap()
        .id;
    let InsertOutcome::Inserted(id) =
        transactions::insert(&conn, &tx(p, s, "2026-11-01", "SHELL", -4000)).unwrap()
    else {
        panic!()
    };
    transactions::update(
        &conn,
        id,
        &TransactionPatch {
            category_id: Some(Some(fuel)),
            category_locked: Some(true),
            notes: Some(Some("road trip".into())),
            ..Default::default()
        },
    )
    .unwrap();
    let t = transactions::get(&conn, id).unwrap();
    assert_eq!(t.category_id, Some(fuel));
    assert!(t.category_locked);
    assert_eq!(t.notes.as_deref(), Some("road trip"));
}

#[test]
fn bulk_update_sets_reviewed_on_many() {
    let (conn, p, s) = setup();
    let ids: Vec<i64> = (1..=3)
        .map(|i| {
            match transactions::insert(&conn, &tx(p, s, "2026-11-01", &format!("T{i}"), -100 * i))
                .unwrap()
            {
                InsertOutcome::Inserted(id) => id,
                _ => panic!(),
            }
        })
        .collect();
    let n = transactions::bulk_update(
        &conn,
        &ids,
        &TransactionPatch {
            reviewed: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(n, 3);
    let unreviewed = TransactionFilter {
        reviewed: Some(false),
        ..TransactionFilter::for_profile(p)
    };
    assert_eq!(transactions::count(&conn, &unreviewed).unwrap(), 0);
}

#[test]
fn filters_by_months_and_merchants_any_of_each_all_of_kinds() {
    let (conn, p, s) = setup();
    for (date, desc) in [
        ("2026-05-03", "WSDOT GOODTOGO 1"),
        ("2026-06-10", "WSDOT GOODTOGO 2"),
        ("2026-07-01", "WSDOT GOODTOGO 3"),
        ("2026-06-11", "GEICO AUTO"),
        ("2026-06-12", "SAFEWAY 12"),
    ] {
        transactions::insert(&conn, &tx(p, s, date, desc, -100)).unwrap();
    }
    let count = |f: TransactionFilter| transactions::count(&conn, &f).unwrap();
    let months = TransactionFilter {
        months: vec!["2026-05".into(), "2026-06".into()],
        ..Default::default()
    };
    assert_eq!(count(months.clone()), 4);
    let merchants = TransactionFilter {
        merchants: vec!["wsdot goodtogo".into(), "geico auto".into()],
        ..Default::default()
    };
    assert_eq!(count(merchants), 4);
    let both = TransactionFilter {
        merchants: vec!["wsdot goodtogo".into()],
        ..months
    };
    assert_eq!(count(both), 2);
}
