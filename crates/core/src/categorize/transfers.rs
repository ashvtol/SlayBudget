//! Money moved between your own accounts: two transactions in different accounts, opposite amounts of the same size,
//! a few days apart. They are a transfer (or a card payment), not spending or income. Pairs where both descriptions say
//! "transfer" are applied; the rest are suggestions to check.

use crate::error::Result;
use crate::profiles::ProfileId;
use crate::transactions::{type_of_category_sql, TransactionId};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use std::collections::HashSet;

/// Words that make a pair certain enough to apply without asking.
const TRANSFER_WORDS: &[&str] = &[
    "transfer",
    "xfer",
    "autopay",
    "auto pay",
    "payment thank you",
    "epayment",
    "online pmt",
    "credit crd",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pair {
    /// The side money left.
    pub out_id: TransactionId,
    /// The side money arrived.
    pub in_id: TransactionId,
    /// Applied without asking: both sides say "transfer" or "payment", and not card to card.
    pub auto: bool,
    /// Payment when either account is a card, otherwise Transfer.
    pub category_id: i64,
}

struct Row {
    id: TransactionId,
    day: NaiveDate,
    cents: i64,
    description: String,
    source_id: i64,
    card: bool,
}

/// Pairs among rows that nothing you set or taught decided (not user, rule or learned; not locked; not paired yet),
/// closest dates first, each row used once. `among` limits one side of each pair to those rows (new imports).
pub fn find_pairs(
    conn: &Connection,
    profile_id: ProfileId,
    among: Option<&[TransactionId]>,
    window_days: i64,
) -> Result<Vec<Pair>> {
    let id_of = |legacy: &str| -> Result<Option<i64>> {
        Ok(crate::categories::find_by_legacy_name(conn, legacy)?.map(|c| c.id))
    };
    let (Some(transfer), Some(payment)) = (id_of("Transfer")?, id_of("Payment")?) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT t.id, t.posted_on, t.amount_cents, t.description, t.source_id, coalesce(s.account_type = 'card', 0)
         FROM transactions t JOIN sources s ON s.id = t.source_id
         WHERE t.profile_id = ?1 AND t.parent_id IS NULL AND t.category_locked = 0 AND t.transfer_pair_id IS NULL
           AND t.amount_cents != 0 AND t.category_source NOT IN ('user', 'rule', 'learned')",
    )?;
    let rows: Vec<Row> = stmt
        .query_map([profile_id], |r| {
            let day: String = r.get(1)?;
            Ok(Row {
                id: r.get(0)?,
                day: NaiveDate::parse_from_str(&day, "%Y-%m-%d").unwrap_or_default(),
                cents: r.get(2)?,
                description: r.get::<_, String>(3)?.to_lowercase(),
                source_id: r.get(4)?,
                card: r.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    let wanted: Option<HashSet<TransactionId>> = among.map(|ids| ids.iter().copied().collect());
    let worded = |r: &Row| TRANSFER_WORDS.iter().any(|w| r.description.contains(w));
    // Both sides saying "transfer" or "payment" is what makes a pair certain; those come before any closer date.
    let mut candidates: Vec<(bool, i64, &Row, &Row)> = Vec::new();
    for o in rows.iter().filter(|r| r.cents < 0) {
        for i in rows
            .iter()
            .filter(|r| r.cents == -o.cents && r.source_id != o.source_id)
        {
            if let Some(w) = &wanted {
                if !w.contains(&o.id) && !w.contains(&i.id) {
                    continue;
                }
            }
            let gap = (i.day - o.day).num_days().abs();
            if gap <= window_days {
                candidates.push((!(worded(o) && worded(i)), gap, o, i));
            }
        }
    }
    candidates.sort_by_key(|(unworded, gap, o, i)| (*unworded, *gap, o.id, i.id));
    let mut used = HashSet::new();
    let mut pairs = Vec::new();
    for (unworded, _, o, i) in candidates {
        if used.contains(&o.id) || used.contains(&i.id) {
            continue;
        }
        used.insert(o.id);
        used.insert(i.id);
        pairs.push(Pair {
            out_id: o.id,
            in_id: i.id,
            // Card to card is never certain (a balance transfer, or two unrelated charges).
            auto: !unworded && !(o.card && i.card),
            category_id: if o.card || i.card { payment } else { transfer },
        });
    }
    Ok(pairs)
}

/// Apply the automatic pairs and store the rest as suggestions; both link the two sides. Returns (applied, suggested).
pub fn apply_pairs(conn: &Connection, pairs: &[Pair]) -> Result<(usize, usize)> {
    crate::db::atomically(conn, |c| {
        let (mut applied, mut suggested) = (0, 0);
        for p in pairs {
            let out = side(c, p.out_id)?;
            let inn = side(c, p.in_id)?;
            if p.auto {
                let sql = format!(
                    "UPDATE transactions SET category_id = ?1, type = {ty}, category_source = 'transfer',
                        category_reason = ?2, transfer_pair_id = ?3, suggested_category_id = NULL,
                        suggested_reason = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE id = ?4",
                    ty = type_of_category_sql("?1")
                );
                c.execute(
                    &sql,
                    params![
                        p.category_id,
                        format!("Transfer to {}", inn.account),
                        p.in_id,
                        p.out_id
                    ],
                )?;
                c.execute(
                    &sql,
                    params![
                        p.category_id,
                        format!("Transfer from {}", out.account),
                        p.out_id,
                        p.in_id
                    ],
                )?;
                applied += 1;
            } else {
                let sql = "UPDATE transactions SET suggested_category_id = ?1, suggested_reason = ?2, transfer_pair_id = ?3
                           WHERE id = ?4";
                let to = format!(
                    "Matches {} into {} on {}",
                    money(inn.cents),
                    inn.account,
                    day(inn.day)
                );
                let from = format!(
                    "Matches {} from {} on {}",
                    money(out.cents),
                    out.account,
                    day(out.day)
                );
                c.execute(sql, params![p.category_id, to, p.in_id, p.out_id])?;
                c.execute(sql, params![p.category_id, from, p.out_id, p.in_id])?;
                suggested += 1;
            }
        }
        Ok((applied, suggested))
    })
}

struct Side {
    account: String,
    cents: i64,
    day: NaiveDate,
}

fn side(conn: &Connection, id: TransactionId) -> Result<Side> {
    Ok(conn.query_row(
        "SELECT s.name, t.amount_cents, t.posted_on FROM transactions t JOIN sources s ON s.id = t.source_id
         WHERE t.id = ?1",
        [id],
        |r| {
            let d: String = r.get(2)?;
            Ok(Side {
                account: r.get(0)?,
                cents: r.get(1)?,
                day: NaiveDate::parse_from_str(&d, "%Y-%m-%d").unwrap_or_default(),
            })
        },
    )?)
}

/// "+$1,250.00" / "−$500.00".
fn money(cents: i64) -> String {
    let sign = if cents < 0 { "−" } else { "+" };
    let abs = cents.unsigned_abs();
    let dollars = (abs / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in dollars.chars().enumerate() {
        if i > 0 && (dollars.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("{sign}${grouped}.{:02}", abs % 100)
}

fn day(d: NaiveDate) -> String {
    d.format("%b %-d").to_string()
}
