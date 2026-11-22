//! Migrate Financial-Tracker JSON into a SlayBudget database and verify every
//! transaction kept its category.
//!
//! cargo run -p slaybudget-core --example migrate -- transactions.json ai-model.json out.db

use slaybudget_core::categories;
use slaybudget_core::db::open_db;
use slaybudget_core::import::legacy::{migrate_legacy, LegacyInput};
use slaybudget_core::transactions::{self, TransactionFilter};
use std::collections::HashMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: migrate <transactions.json> <ai-model.json|-> <out.db>");
        std::process::exit(2);
    }
    let transactions_json = std::fs::read_to_string(&args[1]).expect("read transactions.json");
    let model_json =
        (args[2] != "-").then(|| std::fs::read_to_string(&args[2]).expect("read ai-model.json"));
    let conn = open_db(std::path::Path::new(&args[3])).expect("open db");
    let report = migrate_legacy(
        &conn,
        &LegacyInput {
            transactions_json: transactions_json.clone(),
            model_json,
        },
    )
    .expect("migrate");
    println!("{report:#?}");

    // Verify: every legacy (date, description, magnitude) row maps to a transaction with the same legacy category.
    let legacy: serde_json::Value = serde_json::from_str(&transactions_json).unwrap();
    let stored = transactions::list(&conn, &TransactionFilter::combined()).unwrap();
    let cats: HashMap<i64, String> = categories::list(&conn)
        .unwrap()
        .into_iter()
        .map(|c| (c.id, c.legacy_name.unwrap_or(c.name)))
        .collect();
    let mut mismatches = 0;
    let mut missing = 0;
    for row in legacy["transactions"].as_array().unwrap() {
        let date = &row["date"].as_str().unwrap()[..10];
        let desc = row["description"].as_str().unwrap().trim();
        let cents = (row["amount"].as_f64().unwrap().abs() * 100.0).round() as i64;
        let want = row["category"].as_str().unwrap();
        let found = stored.iter().find(|t| {
            t.posted_on.to_string() == date
                && t.description == desc
                && t.amount_cents.abs() == cents
        });
        match found {
            None => missing += 1,
            Some(t) => {
                let got = t
                    .category_id
                    .and_then(|id| cats.get(&id))
                    .map(String::as_str)
                    .unwrap_or("");
                if got != want {
                    mismatches += 1;
                    if mismatches <= 5 {
                        println!("mismatch: {date} {desc:?} want {want:?} got {got:?}");
                    }
                }
            }
        }
    }
    println!(
        "verification: {} stored, {missing} missing, {mismatches} category mismatches",
        stored.len()
    );
}
