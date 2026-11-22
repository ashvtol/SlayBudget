//! Fold one statement source into another (cleanup of a statement imported twice).
//!
//!   cargo run -p slaybudget-core --example merge_sources -- <db> <from source> <into source> [--apply]
//!
//! Without --apply it is a dry run: it reports what would change and rolls back.

use slaybudget_core::db::open_db;
use slaybudget_core::sources_merge::merge_source_into;
use std::path::Path;

fn source_id(conn: &rusqlite::Connection, name: &str) -> (i64, i64) {
    conn.query_row(
        "SELECT id, profile_id FROM sources WHERE name = ?1",
        [name],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap_or_else(|_| panic!("no source named {name:?}"))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        eprintln!("usage: merge_sources <db> <from> <into> [--apply]");
        std::process::exit(2);
    }
    let apply = args.iter().any(|a| a == "--apply");
    let conn = open_db(Path::new(&args[0])).expect("open database");
    let (from, from_profile) = source_id(&conn, &args[1]);
    let (into, into_profile) = source_id(&conn, &args[2]);
    assert_eq!(
        from_profile, into_profile,
        "sources belong to different profiles"
    );
    let report = merge_source_into(&conn, from, into, !apply).expect("merge");
    println!(
        "{}: {} duplicate copies removed, {} rows moved, source {:?} {}",
        if apply { "APPLIED" } else { "DRY RUN" },
        report.merged,
        report.moved,
        args[1],
        if report.source_deleted {
            "deleted"
        } else {
            "kept"
        },
    );
}
