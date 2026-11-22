//! Dry run: what importing Financial-Tracker's learned merchants would propose and move.
//! Usage: cargo run -p slaybudget-core --example ft_preview -- <db> <ai-model.json> [--apply]
use slaybudget_core::categorize::recategorize;
use slaybudget_core::import::ft_model::{self, FtChoice, FtTarget};
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let conn = slaybudget_core::db::open_db(std::path::Path::new(&args[1])).unwrap();
    let json = std::fs::read_to_string(&args[2]).unwrap();
    let p = ft_model::preview(&conn, &json).unwrap();
    let names: BTreeMap<i64, String> = slaybudget_core::categories::list(&conn)
        .unwrap()
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect();
    let mut by: BTreeMap<String, (usize, i64)> = BTreeMap::new();
    for x in &p {
        let k = match &x.target {
            FtTarget::Existing(id) => names[id].clone(),
            FtTarget::New(n) => format!("NEW {n}"),
        };
        let e = by.entry(k).or_default();
        e.0 += 1;
        e.1 += x.moves;
    }
    for (k, (n, m)) in &by {
        println!("{k:32} {n:4} merchants {m:5} moves");
    }
    println!(
        "total merchants {} moves {}",
        p.len(),
        p.iter().map(|x| x.moves).sum::<i64>()
    );
    println!("other before {}", recategorize::other_count(&conn).unwrap());
    if args.iter().any(|a| a == "--apply") {
        let choices: Vec<FtChoice> = p
            .iter()
            .map(|x| FtChoice {
                merchant: x.merchant.clone(),
                target: x.target.clone(),
            })
            .collect();
        let r = ft_model::apply(&conn, &choices).unwrap();
        println!(
            "applied {r:?}; other after {}",
            recategorize::other_count(&conn).unwrap()
        );
    }
}
