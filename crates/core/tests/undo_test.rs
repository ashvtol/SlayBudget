use slaybudget_core::budgets;
use slaybudget_core::categories;
use slaybudget_core::categorize::recategorize;
use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline;
use slaybudget_core::imports;
use slaybudget_core::profiles;
use slaybudget_core::search;
use slaybudget_core::tags;
use slaybudget_core::transactions::{self, SplitPart, TransactionFilter};
use slaybudget_core::undo::{UndoStack, UndoState};

const CSV: &str = "Transaction Date,Posted Date,Memo,Amount\n2026-11-01,2026-11-01,UBER TRIP 1,-12.00\n2026-11-02,2026-11-02,UBER TRIP 2,-15.00\n2026-11-03,2026-11-03,UBER TRIP 3,-9.00\n2026-11-04,2026-11-04,WHOLE FOODS 22,-64.18\n";

fn setup() -> (rusqlite::Connection, i64, UndoStack) {
    let conn = open_in_memory().unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    pipeline::import_csv(&conn, p, "Statements/Visa/nov.csv", CSV).unwrap();
    (conn, p, UndoStack::new())
}
fn all(conn: &rusqlite::Connection) -> Vec<transactions::Transaction> {
    let mut v = transactions::list(conn, &TransactionFilter::default()).unwrap();
    v.sort_by_key(|t| t.id);
    v
}
fn by(conn: &rusqlite::Connection, desc: &str) -> transactions::Transaction {
    all(conn)
        .into_iter()
        .find(|t| t.description == desc)
        .unwrap()
}
fn cat(conn: &rusqlite::Connection, name: &str) -> i64 {
    categories::list(conn)
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
        .id
}
fn learned(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT count(*) FROM merchant_rules", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_category_change_undoes_with_what_it_taught_and_redoes() {
    let (conn, _, mut stack) = setup();
    let uber = by(&conn, "UBER TRIP 1");
    let before = (uber.category_id, uber.reviewed, learned(&conn));
    let groceries = cat(&conn, "Groceries");
    stack
        .record(&conn, "Change Category", |c| {
            recategorize::set_one(c, uber.id, groceries)
        })
        .unwrap();
    assert_eq!(by(&conn, "UBER TRIP 1").category_id, Some(groceries));
    assert_eq!(
        stack.state(),
        UndoState {
            undo: Some("Change Category".into()),
            redo: None
        }
    );

    assert_eq!(
        stack.undo(&conn).unwrap().as_deref(),
        Some("Change Category")
    );
    let now = by(&conn, "UBER TRIP 1");
    assert_eq!((now.category_id, now.reviewed, learned(&conn)), before);
    assert_eq!(
        stack.state(),
        UndoState {
            undo: None,
            redo: Some("Change Category".into())
        }
    );

    assert_eq!(
        stack.redo(&conn).unwrap().as_deref(),
        Some("Change Category")
    );
    assert_eq!(by(&conn, "UBER TRIP 1").category_id, Some(groceries));
    assert_eq!(
        stack.undo(&conn).unwrap().as_deref(),
        Some("Change Category")
    );
    assert_eq!(stack.undo(&conn).unwrap(), None, "nothing more to undo");
}

#[test]
fn apply_to_others_is_one_step() {
    let (conn, _, mut stack) = setup();
    let ids: Vec<i64> = all(&conn)
        .iter()
        .filter(|t| t.description.starts_with("UBER"))
        .map(|t| t.id)
        .collect();
    let before: Vec<_> = all(&conn).iter().map(|t| t.category_id).collect();
    let rideshare = cat(&conn, "Groceries");
    stack
        .record(&conn, "Change Category of 3 Transactions", |c| {
            recategorize::apply(c, &ids, rideshare)
        })
        .unwrap();
    stack.undo(&conn).unwrap();
    assert_eq!(
        all(&conn).iter().map(|t| t.category_id).collect::<Vec<_>>(),
        before
    );
}

#[test]
fn a_delete_comes_back_with_splits_tags_refund_links_and_search() {
    let (conn, _, mut stack) = setup();
    let wf = by(&conn, "WHOLE FOODS 22");
    let uber = by(&conn, "UBER TRIP 2");
    let parts = transactions::split(
        &conn,
        wf.id,
        &[
            SplitPart {
                amount_cents: -4000,
                category_id: None,
                description: None,
            },
            SplitPart {
                amount_cents: -2418,
                category_id: None,
                description: None,
            },
        ],
    )
    .unwrap();
    let tag = tags::create(&conn, "Trip", None).unwrap();
    tags::add(&conn, &[wf.id, uber.id], &[tag]).unwrap();
    conn.execute(
        "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
        [wf.id, uber.id],
    )
    .unwrap();
    let snapshot = |c: &rusqlite::Connection| {
        let rows: Vec<_> = all(c)
            .into_iter()
            .map(|t| (t.id, t.refund_of, t.tag_ids))
            .collect();
        let kids = transactions::children(c, wf.id).unwrap().len();
        (rows, kids)
    };
    let before = snapshot(&conn);

    stack
        .record(&conn, "Delete Transaction", |c| {
            transactions::delete_many(c, &[wf.id])
        })
        .unwrap();
    assert!(transactions::get(&conn, wf.id).is_err());
    assert!(
        transactions::get(&conn, parts[0]).is_err(),
        "the parts went with it"
    );
    stack.undo(&conn).unwrap();
    assert_eq!(snapshot(&conn), before);
    let q = search::parser::parse(
        "whole foods",
        chrono::NaiveDate::from_ymd_opt(2026, 11, 22).unwrap(),
    );
    assert_eq!(
        search::search(&conn, None, &q, 10).unwrap().len(),
        1,
        "search finds it again"
    );

    stack.redo(&conn).unwrap();
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign keys are back on");
    assert!(transactions::get(&conn, wf.id).is_err());
    assert_eq!(by(&conn, "UBER TRIP 2").refund_of, None);
}

#[test]
fn an_import_and_undo_import_are_undoable() {
    let (conn, p, mut stack) = setup();
    let more = "Transaction Date,Posted Date,Memo,Amount\n2026-11-04,2026-11-04,WHOLE FOODS 22,-64.18\n2026-11-09,2026-11-09,SHELL OIL 9,-40.00\n";
    let count = |c: &rusqlite::Connection| (all(c).len(), imports::list(c).unwrap().len());
    let before = count(&conn);
    let report = stack
        .record(&conn, "Import dec.csv", |c| {
            pipeline::import_csv(c, p, "Statements/Visa/dec.csv", more)
        })
        .unwrap();
    assert_eq!(count(&conn), (before.0 + 1, before.1 + 1));
    stack.undo(&conn).unwrap();
    assert_eq!(count(&conn), before);
    stack.redo(&conn).unwrap();
    assert_eq!(count(&conn), (before.0 + 1, before.1 + 1));

    let import_id = report.import_id.unwrap();
    stack
        .record(&conn, "Undo Import dec.csv", |c| {
            imports::undo(c, import_id)
        })
        .unwrap();
    assert_eq!(count(&conn), before);
    stack.undo(&conn).unwrap();
    assert_eq!(
        count(&conn),
        (before.0 + 1, before.1 + 1),
        "undoing the undo brings the import back"
    );
}

#[test]
fn budgets_undo() {
    let (conn, _, mut stack) = setup();
    let groceries = cat(&conn, "Groceries");
    let before = budgets::plan(&conn).unwrap();
    stack
        .record(&conn, "Change Budget", |c| {
            budgets::set_budget(c, groceries, None, Some(77_700))
        })
        .unwrap();
    stack
        .record(&conn, "Change Budget", |c| {
            budgets::set_budget(c, groceries, Some("2026-11"), Some(12_300))
        })
        .unwrap();
    stack.undo(&conn).unwrap();
    stack.undo(&conn).unwrap();
    assert_eq!(budgets::plan(&conn).unwrap(), before);
}

#[test]
fn fifteen_steps_deep_a_new_change_clears_redo_and_no_change_is_no_step() {
    let (conn, _, mut stack) = setup();
    let uber = by(&conn, "UBER TRIP 1").id;
    for i in 0..17 {
        stack
            .record(&conn, &format!("Edit Notes {i}"), |c| {
                c.execute(
                    "UPDATE transactions SET notes = ?1 WHERE id = ?2",
                    rusqlite::params![format!("n{i}"), uber],
                )?;
                Ok(())
            })
            .unwrap();
    }
    let mut undone = 0;
    while stack.undo(&conn).unwrap().is_some() {
        undone += 1;
    }
    assert_eq!(undone, 15);
    assert_eq!(
        by(&conn, "UBER TRIP 1").notes.as_deref(),
        Some("n1"),
        "the two oldest fell off"
    );

    stack.redo(&conn).unwrap();
    assert!(stack.state().redo.is_some());
    stack
        .record(&conn, "Change Category", |c| {
            recategorize::set_one(c, uber, cat(c, "Groceries"))
        })
        .unwrap();
    assert_eq!(stack.state().redo, None, "a new change clears redo");

    stack.record(&conn, "Nothing", |_| Ok(())).unwrap();
    assert_eq!(
        stack.state().undo.as_deref(),
        Some("Change Category"),
        "an action that changed nothing isn't a step"
    );
}

#[test]
fn a_step_whose_rows_changed_since_is_skipped_whole() {
    let (conn, _, mut stack) = setup();
    let uber = by(&conn, "UBER TRIP 1").id;
    let wf = by(&conn, "WHOLE FOODS 22").id;
    // A category neither row has yet, so the step changes both.
    let had = [
        by(&conn, "UBER TRIP 1").category_id,
        by(&conn, "WHOLE FOODS 22").category_id,
    ];
    let groceries = categories::list(&conn)
        .unwrap()
        .into_iter()
        .find(|c| !had.contains(&Some(c.id)))
        .unwrap()
        .id;
    stack
        .record(&conn, "Change Category of 2 Transactions", |c| {
            recategorize::apply(c, &[uber, wf], groceries)
        })
        .unwrap();
    // Something outside the stack (a watched-folder import, say) changes one of those rows again.
    conn.execute(
        "UPDATE transactions SET category_id = NULL WHERE id = ?1",
        [wf],
    )
    .unwrap();
    let err = stack.undo(&conn).unwrap_err().to_string();
    assert!(err.contains("changed since"), "{err}");
    assert_eq!(
        by(&conn, "UBER TRIP 1").category_id,
        Some(groceries),
        "nothing was half-undone"
    );
    assert_eq!(
        stack.state().undo.as_deref(),
        Some("Change Category of 2 Transactions")
    );
    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign keys are back on after a failed undo");
}
