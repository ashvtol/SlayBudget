//! How well smart categorization does on your own data, measured on a copy of the database:
//! `cargo run -p slaybudget-core --example evaluate -- <copy.db>`
//! `cargo run -p slaybudget-core --example evaluate -- <copy.db> --pass` shows what the one-time pass would change.
//!
//! Trains on a fixed 80% of the rows you categorized, predicts the other 20%, and compares with what imports did
//! before (learned merchants, then keywords). It changes the copy it is given; never point it at the real database.

use slaybudget_core::accounts::account_kind;
use slaybudget_core::categories;
use slaybudget_core::categorize::model::{self, Band};
use slaybudget_core::categorize::{heuristics, learning, starter};
use slaybudget_core::db::open_db;
use std::path::PathBuf;

struct Row {
    description: String,
    merchant: String,
    cents: i64,
    source: i64,
    category: i64,
}

#[derive(Default)]
struct Tally {
    n: usize,
    right: usize,
}

impl Tally {
    fn add(&mut self, ok: bool) {
        self.n += 1;
        self.right += ok as usize;
    }
    fn show(&self, what: &str) {
        let pct = if self.n == 0 {
            0.0
        } else {
            100.0 * self.right as f64 / self.n as f64
        };
        println!("{what:<42} {:>5} rows  {:>5.1}% right", self.n, pct);
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path: PathBuf = std::env::args()
        .nth(1)
        .ok_or("usage: evaluate <copy of slaybudget.db>")?
        .into();
    let conn = open_db(&path)?;
    if std::env::args().any(|a| a == "--pass") {
        return pass(&conn);
    }
    conn.execute_batch("BEGIN")?;
    learning::reset(&conn)?;
    model::reset(&conn)?;
    conn.execute("DELETE FROM settings WHERE key = 'starter_seeded'", [])?;
    starter::seed(&conn)?;

    let mut stmt = conn.prepare(
        "SELECT description, merchant, amount_cents, source_id, category_id FROM transactions
         WHERE parent_id IS NULL AND category_source = 'user' AND category_id IS NOT NULL ORDER BY id",
    )?;
    let mut rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                description: r.get(0)?,
                merchant: r.get(1)?,
                cents: r.get(2)?,
                source: r.get(3)?,
                category: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);
    // A fixed shuffle, so runs compare.
    let mut seed: u64 = 0x5eed;
    for i in (1..rows.len()).rev() {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        rows.swap(i, (seed >> 33) as usize % (i + 1));
    }
    let cut = rows.len() * 4 / 5;
    let (train, test) = rows.split_at(cut);
    for r in train {
        learning::learn(&conn, &r.merchant, r.category, None)?;
        let f = model::features(
            &r.description,
            &r.merchant,
            r.cents,
            account_kind(&conn, r.source)?,
        );
        model::train(&conn, &f, r.category, 3.0)?;
    }

    let (mut learned, mut auto, mut suggest, mut automatic, mut new_all, mut old_all) = (
        Tally::default(),
        Tally::default(),
        Tally::default(),
        Tally::default(),
        Tally::default(),
        Tally::default(),
    );
    let keyword = |r: &Row| -> Result<Option<i64>, Box<dyn std::error::Error>> {
        let legacy = if r.cents > 0 {
            heuristics::income_category(&r.description)
        } else {
            heuristics::spending_category(&r.description)
        };
        Ok(categories::find_by_legacy_name(&conn, legacy)?.map(|c| c.id))
    };
    let verbose = std::env::var("EVAL_VERBOSE").is_ok();
    let name = |id: i64| {
        categories::get(&conn, id)
            .map(|c| c.name)
            .unwrap_or_default()
    };
    for r in test {
        let truth = Some(r.category);
        // Before: learned merchant (exact or similar), then keywords.
        let old = match learning::suggest(&conn, &r.merchant, None)? {
            Some(s) => Some(s.category_id),
            None => keyword(r)?,
        };
        old_all.add(old == truth);
        // Now: exact learned merchant, then the classifier when sure, then keywords.
        let exact = learning::suggest(&conn, &r.merchant, None)?.filter(|s| s.score >= 1.0);
        let now = if let Some(s) = exact {
            learned.add(Some(s.category_id) == truth);
            automatic.add(Some(s.category_id) == truth);
            Some(s.category_id)
        } else {
            let f = model::features(
                &r.description,
                &r.merchant,
                r.cents,
                account_kind(&conn, r.source)?,
            );
            match model::classify(&conn, &r.merchant, &f)? {
                Some(p) if model::band(&p) == Band::Auto => {
                    if verbose && Some(p.category_id) != truth {
                        println!(
                            "auto wrong: {:<40} -> {} (was {}) p={:.2} m={:.2}",
                            r.description,
                            name(p.category_id),
                            name(r.category),
                            p.probability,
                            p.margin
                        );
                    }
                    auto.add(Some(p.category_id) == truth);
                    automatic.add(Some(p.category_id) == truth);
                    Some(p.category_id)
                }
                Some(p) if model::band(&p) == Band::Suggest => {
                    if verbose {
                        println!(
                            "suggest {}: {:<40} -> {} (was {}) p={:.2} m={:.2}",
                            if Some(p.category_id) == truth {
                                "ok "
                            } else {
                                "bad"
                            },
                            r.description,
                            name(p.category_id),
                            name(r.category),
                            p.probability,
                            p.margin
                        );
                    }
                    suggest.add(Some(p.category_id) == truth);
                    keyword(r)?
                }
                _ => keyword(r)?,
            }
        };
        new_all.add(now == truth);
    }
    conn.execute_batch("ROLLBACK")?;

    println!(
        "{} rows you categorized: trained on {}, tested on {}\n",
        rows.len(),
        train.len(),
        test.len()
    );
    learned.show("Exact learned merchant (automatic)");
    auto.show("Classifier, sure (automatic)");
    automatic.show("All automatic choices");
    suggest.show("Classifier, suggestions (if accepted)");
    println!();
    old_all.show("Before: learned merchants, then keywords");
    new_all.show("Now: categories as imported");
    Ok(())
}

/// The one-time pass on the copy (rolled back after): what moves, what is suggested, and the change in Other.
fn pass(conn: &rusqlite::Connection) -> Result<(), Box<dyn std::error::Error>> {
    let other = |c: &rusqlite::Connection| -> rusqlite::Result<i64> {
        c.query_row(
            "SELECT count(*) FROM transactions WHERE parent_id IS NULL AND (category_id IS NULL OR category_id IN
               (SELECT id FROM categories WHERE legacy_name = 'Other'))",
            [],
            |r| r.get(0),
        )
    };
    let spending = |c: &rusqlite::Connection| -> rusqlite::Result<i64> {
        c.query_row(
            "SELECT count(*) FROM transactions WHERE parent_id IS NULL AND type = 'regular'",
            [],
            |r| r.get(0),
        )
    };
    conn.execute_batch("BEGIN")?;
    let (other_before, spending_before) = (other(conn)?, spending(conn)?);
    let report = slaybudget_core::categorize::history::run_once(conn)?
        .ok_or("the pass already ran on this copy")?;
    println!("{report:?}");
    println!("In Other: {other_before} -> {}", other(conn)?);
    println!(
        "Counted as spending or income: {spending_before} -> {}",
        spending(conn)?
    );
    for (what, sql) in [
        ("moved by source", "SELECT category_source || ': ' || count(*) FROM transactions WHERE category_source IN ('learned','model','transfer') GROUP BY category_source"),
        ("suggestions on rows in Other", "SELECT count(*) FROM transactions WHERE suggested_category_id IS NOT NULL AND category_id IN (SELECT id FROM categories WHERE legacy_name = 'Other')"),
        ("suggestions on other rows", "SELECT count(*) FROM transactions WHERE suggested_category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM categories WHERE legacy_name = 'Other')"),
    ] {
        let mut q = conn.prepare(sql)?;
        let v: Vec<String> = q.query_map([], |r| r.get::<_, rusqlite::types::Value>(0))?.map(|v| format!("{:?}", v.unwrap())).collect();
        println!("{what}: {}", v.join(", "));
    }
    let mut stmt = conn.prepare(
        "SELECT t.description, c.name, t.category_source, coalesce(t.category_reason, '') FROM transactions t
         JOIN categories c ON c.id = t.category_id WHERE t.category_source IN ('model', 'transfer')
         ORDER BY t.category_source, t.id LIMIT 60",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })? {
        let (d, c, s, why) = row?;
        println!("  {s:<8} {d:<44} -> {c:<20} {why}");
    }
    conn.execute_batch("ROLLBACK")?;
    Ok(())
}
