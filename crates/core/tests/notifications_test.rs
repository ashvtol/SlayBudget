use serde_json::json;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::notifications::{self, Kind, NewNotification};
use slaybudget_core::profiles;

fn new(key: &str, kind: Kind, profile: Option<i64>) -> NewNotification {
    NewNotification {
        key: key.into(),
        kind,
        title: format!("Title {key}"),
        body: "Body".into(),
        target: json!({ "kind": "recurring", "id": 1 }),
        profile_id: profile,
    }
}

#[test]
fn adds_each_event_once_even_after_it_is_dismissed() {
    let conn = open_in_memory().unwrap();
    let a = notifications::add_if_new(
        &conn,
        &new("bill:1:2026-12-01", Kind::BillUpcoming, None),
        "2026-11-22T10:00:00Z",
        false,
    )
    .unwrap();
    assert!(a.is_some());
    assert!(notifications::add_if_new(
        &conn,
        &new("bill:1:2026-12-01", Kind::BillUpcoming, None),
        "2026-11-22T11:00:00Z",
        false
    )
    .unwrap()
    .is_none());
    notifications::dismiss(&conn, a.unwrap().id).unwrap();
    assert!(notifications::list(&conn, None).unwrap().is_empty());
    assert!(notifications::add_if_new(
        &conn,
        &new("bill:1:2026-12-01", Kind::BillUpcoming, None),
        "2026-11-23T10:00:00Z",
        false
    )
    .unwrap()
    .is_none());
}

#[test]
fn lists_newest_first_with_target_and_read_state_and_marks_read() {
    let conn = open_in_memory().unwrap();
    notifications::add_if_new(
        &conn,
        &new("a", Kind::PriceUp, None),
        "2026-11-20T10:00:00Z",
        false,
    )
    .unwrap();
    let b = notifications::add_if_new(
        &conn,
        &new("b", Kind::LargeTransaction, None),
        "2026-11-21T10:00:00Z",
        false,
    )
    .unwrap()
    .unwrap();
    let base = notifications::add_if_new(
        &conn,
        &new("c", Kind::MoneyIn, None),
        "2026-11-19T10:00:00Z",
        true,
    )
    .unwrap()
    .unwrap();
    assert!(base.read, "baseline items arrive already read");
    let list = notifications::list(&conn, None).unwrap();
    assert_eq!(
        list.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
        ["b", "a", "c"]
    );
    assert_eq!(list[0].target, json!({ "kind": "recurring", "id": 1 }));
    assert_eq!(list[0].kind, Kind::LargeTransaction);
    assert!(!list[0].read);
    notifications::mark_read(&conn, b.id, "2026-11-22T00:00:00Z").unwrap();
    assert!(notifications::list(&conn, None).unwrap()[0].read);
    notifications::mark_all_read(&conn, None, "2026-11-22T00:00:00Z").unwrap();
    assert!(notifications::list(&conn, None)
        .unwrap()
        .iter()
        .all(|n| n.read));
}

#[test]
fn a_profile_sees_its_own_and_household_items_but_not_other_profiles() {
    let conn = open_in_memory().unwrap();
    let me = profiles::list(&conn).unwrap()[0].id;
    let other = profiles::create(&conn, "Sam", None).unwrap();
    notifications::add_if_new(
        &conn,
        &new("mine", Kind::BillUpcoming, Some(me)),
        "2026-11-20T10:00:00Z",
        false,
    )
    .unwrap();
    notifications::add_if_new(
        &conn,
        &new("theirs", Kind::BillUpcoming, Some(other)),
        "2026-11-20T10:00:00Z",
        false,
    )
    .unwrap();
    notifications::add_if_new(
        &conn,
        &new("all-recap", Kind::MonthlyRecap, None),
        "2026-11-20T10:00:00Z",
        false,
    )
    .unwrap();
    notifications::add_if_new(
        &conn,
        &new("update:0.2.0", Kind::Update, None),
        "2026-11-20T10:00:00Z",
        false,
    )
    .unwrap();
    let keys = |p| {
        let mut k: Vec<String> = notifications::list(&conn, p)
            .unwrap()
            .into_iter()
            .map(|n| n.key)
            .collect();
        k.sort();
        k
    };
    assert_eq!(keys(Some(me)), ["all-recap", "mine", "update:0.2.0"]);
    assert_eq!(keys(None), ["all-recap", "mine", "theirs", "update:0.2.0"]);
    notifications::mark_all_read(&conn, Some(me), "2026-11-22T00:00:00Z").unwrap();
    assert!(
        notifications::list(&conn, Some(other))
            .unwrap()
            .iter()
            .any(|n| !n.read),
        "other profile untouched"
    );
}

#[test]
fn prunes_items_older_than_90_days_and_keeps_at_most_200() {
    let conn = open_in_memory().unwrap();
    notifications::add_if_new(
        &conn,
        &new("old", Kind::PriceUp, None),
        "2026-08-01T10:00:00Z",
        false,
    )
    .unwrap();
    for i in 0..205 {
        notifications::add_if_new(
            &conn,
            &new(&format!("n{i:03}"), Kind::PriceUp, None),
            &format!(
                "2026-11-{:02}T{:02}:{:02}:00Z",
                1 + i / 24 % 20,
                i % 24,
                i % 60
            ),
            false,
        )
        .unwrap();
    }
    notifications::prune(&conn, "2026-11-22T12:00:00Z").unwrap();
    let list = notifications::list(&conn, None).unwrap();
    assert_eq!(list.len(), 200);
    assert!(!list.iter().any(|n| n.key == "old"));
}

#[test]
fn undelivered_items_wait_for_a_banner_until_marked_delivered() {
    let conn = open_in_memory().unwrap();
    let a = notifications::add_if_new(
        &conn,
        &new("a", Kind::PriceUp, None),
        "2026-11-22T10:00:00Z",
        false,
    )
    .unwrap()
    .unwrap();
    notifications::add_if_new(
        &conn,
        &new("b", Kind::PriceUp, None),
        "2026-11-22T10:00:00Z",
        true,
    )
    .unwrap();
    let pending = notifications::pending_banners(&conn, None).unwrap();
    assert_eq!(
        pending.iter().map(|n| n.key.as_str()).collect::<Vec<_>>(),
        ["a"],
        "baseline (read) items never banner"
    );
    notifications::mark_delivered(&conn, &[a.id], "2026-11-22T10:01:00Z").unwrap();
    assert!(notifications::pending_banners(&conn, None)
        .unwrap()
        .is_empty());
}

mod config {
    use slaybudget_core::db::open_in_memory;
    use slaybudget_core::notifications::config::{self, Config};
    use slaybudget_core::settings;

    #[test]
    fn defaults_match_the_shared_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/notification-config-defaults.json"))
                .unwrap();
        assert_eq!(serde_json::to_value(Config::default()).unwrap(), fixture);
    }

    #[test]
    fn loads_saved_values_filling_gaps_with_defaults_and_migrates_the_old_horizon() {
        let conn = open_in_memory().unwrap();
        settings::set(&conn, "reminder_horizon_days", "14").unwrap();
        assert_eq!(config::load(&conn).unwrap().bill_lead_days, 14);
        settings::set(
            &conn,
            "notifications.config",
            r#"{"largeCents": 120000, "billLeadDays": 10}"#,
        )
        .unwrap();
        let c = config::load(&conn).unwrap();
        assert_eq!(
            (c.large_cents, c.bill_lead_days, c.missed_grace_days),
            (120000, 10, 3)
        );
        settings::set(&conn, "notifications.config", "not json").unwrap();
        assert_eq!(config::load(&conn).unwrap().large_cents, 50000);
    }

    #[test]
    fn rejects_out_of_range_values_with_a_message() {
        let mut c = Config::default();
        assert!(config::validate(&c).is_ok());
        c.bill_lead_days = 0;
        assert!(config::validate(&c)
            .unwrap_err()
            .to_string()
            .contains("days before"));
        let c = Config {
            large_cents: -1,
            ..Default::default()
        };
        assert!(config::validate(&c).is_err());
        let mut c = Config::default();
        c.quiet_hours.start = "25:00".into();
        assert!(config::validate(&c).is_err());
    }
}
