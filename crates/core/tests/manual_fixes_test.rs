use slaybudget_core::db::open_in_memory;
use slaybudget_core::import::pipeline;
use slaybudget_core::imports;
use slaybudget_core::profiles;
use slaybudget_core::tags;
use slaybudget_core::transactions::{self, TransactionFilter};

const NOV_1: &str = "Transaction Date,Posted Date,Memo,Amount\n2026-11-01,2026-11-01,Coffee Shop 12,-4.50\n2026-11-03,2026-11-03,Trader Joes 55,-62.10\n";
// The full month: repeats both rows above, and adds one.
const NOV_ALL: &str = "Transaction Date,Posted Date,Memo,Amount\n2026-11-01,2026-11-01,Coffee Shop 12,-4.50\n2026-11-03,2026-11-03,Trader Joes 55,-62.10\n2026-11-20,2026-11-20,Shell Oil 99,-48.27\n";

fn setup() -> (rusqlite::Connection, i64) {
    let conn = open_in_memory().unwrap();
    let p = profiles::list(&conn).unwrap()[0].id;
    (conn, p)
}
fn all(conn: &rusqlite::Connection) -> Vec<transactions::Transaction> {
    transactions::list(conn, &TransactionFilter::default()).unwrap()
}

#[test]
fn deleting_transactions_removes_them_with_their_splits_and_tags_and_clears_refund_links() {
    let (conn, p) = setup();
    pipeline::import_csv(&conn, p, "Statements/Amex/nov.csv", NOV_ALL).unwrap();
    let rows = all(&conn);
    let shell = rows
        .iter()
        .find(|t| t.description.contains("Shell"))
        .unwrap()
        .id;
    let coffee = rows
        .iter()
        .find(|t| t.description.contains("Coffee"))
        .unwrap()
        .id;
    let joes = rows
        .iter()
        .find(|t| t.description.contains("Trader"))
        .unwrap()
        .id;
    let tag = tags::create(&conn, "Trip", None).unwrap();
    tags::add(&conn, &[shell], &[tag]).unwrap();
    conn.execute(
        "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
        [shell, coffee],
    )
    .unwrap();

    assert_eq!(transactions::delete_many(&conn, &[shell, joes]).unwrap(), 2);
    let left = all(&conn);
    assert_eq!(left.iter().map(|t| t.id).collect::<Vec<_>>(), vec![coffee]);
    assert_eq!(
        left[0].refund_of, None,
        "the refund link to a deleted charge is cleared"
    );
    let tagged: i64 = conn
        .query_row("SELECT count(*) FROM transaction_tags", [], |r| r.get(0))
        .unwrap();
    assert_eq!(tagged, 0);
    assert_eq!(transactions::delete_many(&conn, &[]).unwrap(), 0);
}

#[test]
fn imports_are_listed_newest_first_with_how_many_rows_remain() {
    let (conn, p) = setup();
    pipeline::import_csv(&conn, p, "Statements/Amex/nov-1.csv", NOV_1).unwrap();
    pipeline::import_csv(&conn, p, "Statements/Amex/nov-all.csv", NOV_ALL).unwrap();
    let list = imports::list(&conn).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].file_name, "nov-all.csv");
    assert_eq!(
        (
            list[0].imported_rows,
            list[0].skipped_rows,
            list[0].remaining
        ),
        (1, 2, 1)
    );
    assert_eq!(list[0].source_name, "Amex");
    assert_eq!((list[1].imported_rows, list[1].remaining), (2, 2));
}

#[test]
fn undoing_an_import_removes_only_what_it_added_and_lets_the_file_be_imported_again() {
    let (conn, p) = setup();
    pipeline::import_csv(&conn, p, "Statements/Amex/nov-1.csv", NOV_1).unwrap();
    let report = pipeline::import_csv(&conn, p, "Statements/Amex/nov-all.csv", NOV_ALL).unwrap();
    let later = report.import_id.unwrap();

    assert_eq!(imports::undo(&conn, later).unwrap(), 1);
    let left: Vec<String> = all(&conn).into_iter().map(|t| t.description).collect();
    assert_eq!(
        left.len(),
        2,
        "the rows it skipped belong to the earlier import and stay: {left:?}"
    );
    assert!(left.iter().all(|d| !d.contains("Shell")));
    assert_eq!(imports::list(&conn).unwrap().len(), 1);

    let again = pipeline::import_csv(&conn, p, "Statements/Amex/nov-all.csv", NOV_ALL).unwrap();
    assert_eq!(
        (again.inserted, again.duplicates, again.already_imported),
        (1, 2, false)
    );
}

#[test]
fn a_backup_is_made_beside_the_database_and_only_the_newest_three_of_a_kind_are_kept() {
    let dir = std::env::temp_dir().join(format!("sb-backup-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let conn = slaybudget_core::db::open_db(&dir.join("slaybudget.db")).unwrap();
    let mut made = Vec::new();
    for i in 0..4 {
        let path =
            slaybudget_core::db::backup_before(&conn, "delete", &format!("20261122-10000{i}"))
                .unwrap()
                .unwrap();
        made.push(path);
    }
    slaybudget_core::db::backup_before(&conn, "undo-import", "20261122-110000").unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|n| n.contains(".before-"))
        .collect();
    names.sort();
    assert_eq!(
        names,
        [
            "slaybudget.before-delete-20261122-100001.db",
            "slaybudget.before-delete-20261122-100002.db",
            "slaybudget.before-delete-20261122-100003.db",
            "slaybudget.before-undo-import-20261122-110000.db",
        ]
    );
    let _ = std::fs::remove_dir_all(&dir);
    // An in-memory database has nowhere to back up to: nothing happens.
    assert!(
        slaybudget_core::db::backup_before(&open_in_memory().unwrap(), "delete", "x")
            .unwrap()
            .is_none()
    );
}
