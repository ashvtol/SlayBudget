//! Delete one category by id; its transactions move to Other (same rules as the app).
//!
//!   cargo run -p slaybudget-core --example delete_category -- <db> <category id> [--apply]
//!
//! Without --apply it only reports what would happen.

use slaybudget_core::categories;
use slaybudget_core::db::open_db;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("usage: delete_category <db> <category id> [--apply]");
        std::process::exit(2);
    }
    let conn = open_db(Path::new(&args[0])).expect("open database");
    let id: i64 = args[1].parse().expect("category id");
    let cat = categories::get(&conn, id).expect("category");
    let moving = categories::usage(&conn, id).expect("usage");
    if !args.iter().any(|a| a == "--apply") {
        println!(
            "DRY RUN: would delete {:?}; {moving} transactions move to Other",
            cat.name
        );
        return;
    }
    let report = categories::delete(&conn, id).expect("delete");
    println!(
        "APPLIED: deleted {:?}; {} transactions moved to Other",
        cat.name, report.moved
    );
}
