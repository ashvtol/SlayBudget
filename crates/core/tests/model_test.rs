use slaybudget_core::accounts::AccountType;
use slaybudget_core::categories;
use slaybudget_core::categorize::extract_merchant;
use slaybudget_core::categorize::model::{self, Band, Features};
use slaybudget_core::db::open_in_memory;

fn cat(conn: &rusqlite::Connection, legacy: &str) -> i64 {
    categories::find_by_legacy_name(conn, legacy)
        .unwrap()
        .unwrap()
        .id
}

fn f(desc: &str) -> Features {
    model::features(
        desc,
        &extract_merchant(desc),
        -1200,
        Some(AccountType::Card),
    )
}

#[test]
fn features_cover_prefix_direction_account_and_merchant_letters() {
    let x = model::features("TST* JOES 0423", "joes", -1200, Some(AccountType::Card)).0;
    for want in ["p:tst", "d:out", "a:card", "c:joe", "w:joes"] {
        assert!(x.iter().any(|s| s == want), "missing {want} in {x:?}");
    }
    assert!(!x.iter().any(|s| s == "w:0423"), "numbers are not words");
    let y = model::features("PAYROLL", "payroll", 500, None).0;
    assert!(y.iter().any(|s| s == "d:in"));
    assert!(!y.iter().any(|s| s.starts_with("a:")));
}

#[test]
fn learns_from_a_few_examples_and_is_sure_of_a_close_match() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    let groceries = cat(&conn, "Groceries");
    for _ in 0..3 {
        model::train(&conn, &f("STARBUCKS #1234"), dining, 1.0).unwrap();
        model::train(&conn, &f("SAFEWAY 991"), groceries, 1.0).unwrap();
    }
    let p = model::predict(&conn, &f("STARBUCKS STORE 55"))
        .unwrap()
        .unwrap();
    assert_eq!(p.category_id, dining);
    assert_eq!(p.runner_up, Some(groceries));
    assert!(p.probability >= 0.9, "{p:?}");
    assert_eq!(model::band(&p), Band::Auto);
}

#[test]
fn an_unseen_merchant_is_not_guessed_with_confidence() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    let groceries = cat(&conn, "Groceries");
    model::train(&conn, &f("STARBUCKS #1234"), dining, 3.0).unwrap();
    model::train(&conn, &f("SAFEWAY 991"), groceries, 3.0).unwrap();
    let p = model::predict(&conn, &model::features("ZXQV LLC", "zxqv llc", 0, None)).unwrap();
    assert!(
        p.as_ref().is_none_or(|p| model::band(p) == Band::None),
        "{p:?}"
    );
}

#[test]
fn nothing_learned_means_no_prediction() {
    let conn = open_in_memory().unwrap();
    assert!(model::predict(&conn, &f("STARBUCKS")).unwrap().is_none());
}

#[test]
fn a_deleted_category_is_never_predicted() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    let groceries = cat(&conn, "Groceries");
    model::train(&conn, &f("STARBUCKS #1234"), dining, 3.0).unwrap();
    model::train(&conn, &f("SAFEWAY 991"), groceries, 3.0).unwrap();
    categories::delete(&conn, dining).unwrap();
    let p = model::predict(&conn, &f("STARBUCKS #1234")).unwrap();
    assert!(p.is_none_or(|p| p.category_id != dining));
}

#[test]
fn unlearning_never_goes_below_zero() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    model::train(&conn, &f("STARBUCKS"), dining, 3.0).unwrap();
    model::train(&conn, &f("STARBUCKS"), dining, -3.0).unwrap();
    model::train(&conn, &f("STARBUCKS"), dining, -3.0).unwrap();
    let min: f64 = conn
        .query_row(
            "SELECT min(m) FROM (SELECT min(weight) m FROM model_counts UNION ALL SELECT min(docs) FROM model_totals UNION ALL SELECT min(tokens) FROM model_totals)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(min >= 0.0);
}

#[test]
fn reset_forgets_everything() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    model::train(&conn, &f("STARBUCKS"), dining, 3.0).unwrap();
    model::reset(&conn).unwrap();
    assert!(model::predict(&conn, &f("STARBUCKS")).unwrap().is_none());
}

#[test]
fn bands_follow_the_thresholds() {
    let p = |probability, margin| model::Prediction {
        category_id: 1,
        probability,
        margin,
        runner_up: None,
    };
    assert_eq!(model::band(&p(0.95, 0.6)), Band::Auto);
    assert_eq!(model::band(&p(0.95, 0.4)), Band::Suggest);
    assert_eq!(model::band(&p(0.7, 0.9)), Band::Suggest);
    assert_eq!(model::band(&p(0.5, 2.0)), Band::None);
}

#[test]
fn a_known_merchant_wins_over_generic_words_until_you_say_otherwise() {
    let conn = open_in_memory().unwrap();
    slaybudget_core::categorize::starter::seed(&conn).unwrap();
    let dining = cat(&conn, "Food & Dining");
    let p = model::classify(
        &conn,
        &extract_merchant("STARBUCKS STORE 991"),
        &f("STARBUCKS STORE 991"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(p.category_id, dining);
    assert_eq!(
        model::explain(&conn, "starbucks store", dining).unwrap(),
        "Known merchant: Starbucks"
    );
    assert_ne!(
        model::explain(&conn, "starbucks store", cat(&conn, "Shopping")).unwrap(),
        "Known merchant: Starbucks",
        "the starter list only vouches for its own category"
    );
}

#[test]
fn money_direction_and_account_alone_are_not_enough_to_guess() {
    let conn = open_in_memory().unwrap();
    let dining = cat(&conn, "Food & Dining");
    for i in 0..10 {
        model::train(&conn, &f(&format!("STARBUCKS #{i}")), dining, 3.0).unwrap();
    }
    let p = model::predict(
        &conn,
        &model::features("ZXQV QWRT", "zxqv qwrt", -4400, Some(AccountType::Card)),
    )
    .unwrap();
    assert!(p.is_none(), "{p:?}");
}

#[test]
fn a_known_shop_does_not_decide_money_coming_in() {
    let conn = open_in_memory().unwrap();
    let refund = model::features(
        "AMAZON.COM REFUND",
        "amazon com",
        2500,
        Some(AccountType::Card),
    );
    let p = model::classify(&conn, "amazon com", &refund).unwrap();
    assert!(p.is_none(), "{p:?}");
}
