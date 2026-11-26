//! Credits that pay charges back: a card's statement credit for a bill (Amex Platinum's Walmart+ credit), or a refund
//! matched to its purchase. Each one is filed in the category of the charge it paid back, so spending nets out in every
//! total (Categories, Cash flow, budgets) with no special cases. A credit you filed yourself, by hand or with a rule,
//! or locked, is left alone.

use crate::categorize::rules::normalize_description;
use crate::error::Result;
use crate::transactions::type_of_category_sql;
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use std::collections::HashSet;

/// A credit pays back a charge up to this many days before or after it (as the Recurrings screen pairs them).
pub const CREDIT_WINDOW_DAYS: i64 = 10;

#[derive(Debug, Clone)]
struct Charge {
    id: i64,
    profile_id: i64,
    posted_on: NaiveDate,
    cents: i64,
}

#[derive(Debug, Clone)]
struct Credit {
    id: i64,
    profile_id: i64,
    posted_on: NaiveDate,
    cents: i64,
    merchant: String,
    description: String,
}

/// (charge id, credit id, why), one credit per charge and one charge per credit.
type Pair = (i64, i64, String);

fn day(s: String) -> NaiveDate {
    NaiveDate::parse_from_str(&s, "%Y-%m-%d").unwrap_or_default()
}

/// "Nov 13".
fn short_date(d: NaiveDate) -> String {
    d.format("%b %-d").to_string()
}

/// Whether a credit carries one of these names: its merchant key is the name, or its description contains it.
fn carries(credit: &Credit, names: &[String]) -> bool {
    let merchant = credit.merchant.trim().to_lowercase();
    let description = normalize_description(&credit.description);
    names.iter().any(|n| {
        let n = n.trim().to_lowercase();
        !n.is_empty() && (merchant == n || description.contains(&normalize_description(&n)))
    })
}

/// Bills' credits paired with their charges, every bill at once, so a credit two bills could claim goes to one charge
/// only: the nearest, then the closest amount. A credit is never bigger than its charge, and both are in one profile.
fn bill_pairs(conn: &Connection) -> Result<Vec<Pair>> {
    let mut bills = conn.prepare(
        "SELECT id, name, credit_names FROM recurrings WHERE credit_names IS NOT NULL AND trim(credit_names) != ''",
    )?;
    let bills: Vec<(i64, String, Vec<String>)> = bills
        .query_map([], |r| {
            let names: String = r.get(2)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                names
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect(),
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    if bills.is_empty() {
        return Ok(Vec::new());
    }
    let mut credits = conn.prepare(
        "SELECT id, profile_id, posted_on, amount_cents, merchant, description FROM transactions
         WHERE amount_cents > 0 AND parent_id IS NULL",
    )?;
    let credits: Vec<Credit> = credits
        .query_map([], |r| {
            Ok(Credit {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                posted_on: day(r.get(2)?),
                cents: r.get(3)?,
                merchant: r.get(4)?,
                description: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    let mut charges = conn.prepare(
        "SELECT id, profile_id, posted_on, amount_cents FROM transactions
         WHERE recurring_id = ?1 AND amount_cents < 0 AND parent_id IS NULL",
    )?;

    // (days apart, amount gap, charge, credit, bill name)
    let mut options: Vec<(i64, i64, Charge, &Credit, &str)> = Vec::new();
    for (id, name, names) in &bills {
        let own: Vec<&Credit> = credits.iter().filter(|c| carries(c, names)).collect();
        if own.is_empty() {
            continue;
        }
        let bill_charges: Vec<Charge> = charges
            .query_map([id], |r| {
                Ok(Charge {
                    id: r.get(0)?,
                    profile_id: r.get(1)?,
                    posted_on: day(r.get(2)?),
                    cents: -r.get::<_, i64>(3)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        for charge in &bill_charges {
            for credit in &own {
                let days = (credit.posted_on - charge.posted_on).num_days().abs();
                if credit.profile_id == charge.profile_id
                    && days <= CREDIT_WINDOW_DAYS
                    && credit.cents <= charge.cents
                {
                    options.push((
                        days,
                        charge.cents - credit.cents,
                        charge.clone(),
                        credit,
                        name,
                    ));
                }
            }
        }
    }
    options.sort_by_key(|(days, gap, charge, credit, _)| (*days, *gap, charge.id, credit.id));
    let mut taken_charges = HashSet::new();
    let mut taken_credits = HashSet::new();
    let mut pairs = Vec::new();
    for (_, _, charge, credit, name) in options {
        if taken_charges.contains(&charge.id) || taken_credits.contains(&credit.id) {
            continue;
        }
        taken_charges.insert(charge.id);
        taken_credits.insert(credit.id);
        pairs.push((
            charge.id,
            credit.id,
            format!("Pays back {name} ({})", short_date(charge.posted_on)),
        ));
    }
    Ok(pairs)
}

/// Refunds already matched to their purchase (`refund_of`).
fn refund_pairs(conn: &Connection) -> Result<Vec<Pair>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, r.id, c.merchant, c.posted_on FROM transactions r JOIN transactions c ON c.id = r.refund_of
         WHERE r.amount_cents > 0",
    )?;
    let pairs = stmt
        .query_map([], |r| {
            let merchant: String = r.get(2)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                format!(
                    "Refund of {} ({})",
                    title(&merchant),
                    short_date(day(r.get(3)?))
                ),
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(pairs)
}

fn title(key: &str) -> String {
    key.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// File each credit in the category of the charge it paid back. Runs when the app opens, after an import, and when a
/// bill's credits change; a charge that moves category takes its credit along next time. Returns how many moved.
pub fn follow_charges(conn: &Connection) -> Result<usize> {
    let mut pairs = bill_pairs(conn)?;
    let billed: HashSet<i64> = pairs.iter().map(|(_, credit, _)| *credit).collect();
    pairs.extend(
        refund_pairs(conn)?
            .into_iter()
            .filter(|(_, credit, _)| !billed.contains(credit)),
    );
    crate::db::atomically(conn, |c| {
        let sql = format!(
            "UPDATE transactions
             SET category_id = (SELECT category_id FROM transactions WHERE id = ?1),
                 type = {ty}, category_source = 'credit', category_reason = ?3,
                 suggested_category_id = NULL, suggested_reason = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2 AND category_locked = 0 AND category_source NOT IN ('user', 'rule')
               AND (SELECT category_id FROM transactions WHERE id = ?1) IS NOT NULL
               AND category_id IS NOT (SELECT category_id FROM transactions WHERE id = ?1)",
            ty = type_of_category_sql("(SELECT category_id FROM transactions WHERE id = ?1)")
        );
        let mut moved = 0;
        for (charge, credit, why) in &pairs {
            moved += c.execute(&sql, params![charge, credit, why])?;
        }
        Ok(moved)
    })
}
