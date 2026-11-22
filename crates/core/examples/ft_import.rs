//! Import Financial-Tracker's learned merchants with a reviewed list of skips and re-targets.
//! Usage: cargo run -p slaybudget-core --example ft_import -- <db> <ai-model.json> <overrides.json> [--apply]
//! overrides.json: {"skip": ["merchant", ...], "set": {"merchant": "Category name", ...}}
use slaybudget_core::categories;
use slaybudget_core::categorize::recategorize;
use slaybudget_core::import::ft_model::{self, FtChoice, FtTarget};
use std::collections::{BTreeMap, BTreeSet};

#[derive(serde::Deserialize)]
struct Overrides {
    #[serde(default)]
    skip: BTreeSet<String>,
    #[serde(default)]
    set: BTreeMap<String, String>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let conn = slaybudget_core::db::open_db(std::path::Path::new(&args[1])).unwrap();
    let model = std::fs::read_to_string(&args[2]).unwrap();
    let o: Overrides = serde_json::from_str(&std::fs::read_to_string(&args[3]).unwrap()).unwrap();
    let cats = categories::list(&conn).unwrap();
    let id_of = |name: &str| {
        cats.iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("no category {name}"))
            .id
    };
    let mut choices = Vec::new();
    for p in ft_model::preview(&conn, &model).unwrap() {
        if o.skip.contains(&p.merchant) {
            continue;
        }
        let target = match o.set.get(&p.merchant) {
            Some(name) => FtTarget::Existing(id_of(name)),
            None => p.target,
        };
        choices.push(FtChoice {
            merchant: p.merchant,
            target,
        });
    }
    println!(
        "choices {} (skipped {}, re-targeted {})",
        choices.len(),
        o.skip.len(),
        o.set.len()
    );
    println!("other before {}", recategorize::other_count(&conn).unwrap());
    if args.iter().any(|a| a == "--apply") {
        let r = ft_model::apply(&conn, &choices).unwrap();
        println!(
            "applied {r:?}; other after {}",
            recategorize::other_count(&conn).unwrap()
        );
    }
}
