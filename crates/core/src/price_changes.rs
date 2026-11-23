//! Recurring bills that change price. After an import, a charge whose name fits a bill but whose amount is outside the
//! bill's range (higher or lower) is asked about once: "Is this the same subscription at a new price?". Answers move
//! the bill to the new price (with a price history), note a one-off, or start a separate bill.

use crate::error::{CoreError, Result};
use crate::recurrings::{self, MatchKind, NewRecurring, SavedRecurring, Status};
use crate::transactions::{self, TransactionId};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceCheck {
    pub id: i64,
    pub tx_id: TransactionId,
    pub recurring_id: i64,
    /// What the bill cost (its latest charge), and this charge (positive cents).
    pub old_cents: i64,
    pub new_cents: i64,
    pub direction: Direction,
    pub answered: bool,
}

/// A check stops asking once its charge joins a bill some other way.
const UNLINKED: &str = "tx_id IN (SELECT id FROM transactions WHERE recurring_id IS NULL)";

const COLS: &str = "id, tx_id, recurring_id, old_cents, new_cents, answer IS NOT NULL";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PriceCheck> {
    let (old, new): (i64, i64) = (r.get(3)?, r.get(4)?);
    Ok(PriceCheck {
        id: r.get(0)?,
        tx_id: r.get(1)?,
        recurring_id: r.get(2)?,
        old_cents: old,
        new_cents: new,
        direction: if new >= old {
            Direction::Up
        } else {
            Direction::Down
        },
        answered: r.get(5)?,
    })
}

/// The bill's latest linked charge (date, positive cents).
fn last_charge(conn: &Connection, bill: i64) -> Result<Option<(String, i64)>> {
    Ok(conn
        .query_row(
            "SELECT posted_on, -amount_cents FROM transactions WHERE recurring_id = ?1 ORDER BY posted_on DESC, id DESC LIMIT 1",
            [bill],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// Find charges that may be a bill at a new price, and ask about each once (marked to review). Returns how many.
pub fn detect(conn: &Connection) -> Result<usize> {
    let bills: Vec<SavedRecurring> = recurrings::list(conn)?
        .into_iter()
        .filter(|s| s.status != Status::Archived)
        .collect();
    if bills.is_empty() {
        return Ok(0);
    }
    let mut asked = 0;
    for c in recurrings::candidates(conn, None)?
        .into_iter()
        .filter(|c| c.recurring_id.is_none())
    {
        let size = -c.amount_cents;
        let Some(bill) = bills
            .iter()
            .find(|b| recurrings::name_fits(b, &c) && (size < b.min_cents || size > b.max_cents))
        else {
            continue;
        };
        let last = last_charge(conn, bill.id)?;
        let not_before = last
            .as_ref()
            .map(|(d, _)| d.clone())
            .unwrap_or_else(|| bill.created_on.clone());
        if c.posted_on.to_string() < not_before {
            continue;
        }
        let old = last
            .map(|(_, cents)| cents)
            .unwrap_or((bill.min_cents + bill.max_cents) / 2);
        let made = conn.execute(
            "INSERT OR IGNORE INTO price_checks (tx_id, recurring_id, old_cents, new_cents) VALUES (?1, ?2, ?3, ?4)",
            params![c.id, bill.id, old, size],
        )?;
        if made > 0 {
            conn.execute("UPDATE transactions SET reviewed = 0 WHERE id = ?1", [c.id])?;
            asked += 1;
        }
    }
    Ok(asked)
}

/// Price checks waiting for an answer, newest first.
pub fn open_checks(conn: &Connection) -> Result<Vec<PriceCheck>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM price_checks WHERE answer IS NULL AND {UNLINKED} ORDER BY id DESC"
    ))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// The open price check about a charge, if any.
pub fn for_transaction(conn: &Connection, tx_id: TransactionId) -> Result<Option<PriceCheck>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLS} FROM price_checks WHERE tx_id = ?1 AND answer IS NULL AND {UNLINKED}"),
            [tx_id],
            row,
        )
        .optional()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<PriceCheck> {
    conn.query_row(
        &format!("SELECT {COLS} FROM price_checks WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("price check {id}")))
}

/// Your answer to "Is this the same subscription at a new price?".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Answer {
    /// The bill now costs this: the charge joins it, and its range and due day move.
    NewPrice,
    /// An extra charge: nothing changes.
    OneOff,
    /// Another subscription: make it its own bill.
    Separate,
}

impl Answer {
    fn as_str(self) -> &'static str {
        match self {
            Answer::NewPrice => "new_price",
            Answer::OneOff => "one_off",
            Answer::Separate => "separate",
        }
    }
}

/// One change in a bill's price (positive cents), on the day of the first charge at the new price.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceChange {
    pub changed_on: String,
    pub from_cents: i64,
    pub to_cents: i64,
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

fn close(conn: &Connection, id: i64, answer: Answer) -> Result<()> {
    conn.execute(
        &format!("UPDATE price_checks SET answer = ?1, answered_at = {NOW} WHERE id = ?2"),
        params![answer.as_str(), id],
    )?;
    Ok(())
}

/// Answer a price check (once). "Separate" returns the prefilled form for the charge's own bill.
pub fn answer(conn: &Connection, id: i64, answer: Answer) -> Result<Option<NewRecurring>> {
    let check = get(conn, id)?;
    if check.answered {
        return Err(CoreError::Invalid(
            "this charge was already answered".into(),
        ));
    }
    crate::db::atomically(conn, |c| {
        close(c, id, answer)?;
        match answer {
            Answer::NewPrice => {
                new_price(c, &check)?;
                Ok(None)
            }
            Answer::OneOff => Ok(None),
            Answer::Separate => Ok(Some(recurrings::draft_from_transaction(c, check.tx_id)?)),
        }
    })
}

fn new_price(conn: &Connection, check: &PriceCheck) -> Result<()> {
    let bill = recurrings::get(conn, check.recurring_id)?;
    let charge = transactions::get(conn, check.tx_id)?;
    let (min, max) = recurrings::band_around(check.new_cents);
    let day = recurrings::day_for(bill.frequency, charge.posted_on).or(bill.day_of_month);
    conn.execute(
        "UPDATE recurrings SET min_cents = ?1, max_cents = ?2, day_of_month = ?3, status = 'active' WHERE id = ?4",
        params![min, max, day, bill.id],
    )?;
    conn.execute(
        "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
        params![bill.id, check.tx_id],
    )?;
    conn.execute(
        "INSERT INTO recurring_prices (recurring_id, changed_on, from_cents, to_cents) VALUES (?1, ?2, ?3, ?4)",
        params![bill.id, charge.posted_on.to_string(), check.old_cents, check.new_cents],
    )?;
    // Other charges waiting on this bill that fit the new price are settled with it.
    let others: Vec<PriceCheck> = open_checks(conn)?
        .into_iter()
        .filter(|o| o.recurring_id == bill.id)
        .collect();
    let ids: Vec<TransactionId> = others.iter().map(|o| o.tx_id).collect();
    recurrings::match_new(conn, &ids)?;
    for o in others {
        if transactions::get(conn, o.tx_id)?.recurring_id.is_some() {
            close(conn, o.id, Answer::NewPrice)?;
        }
    }
    Ok(())
}

/// A bill's price changes, newest first.
pub fn history(conn: &Connection, bill: i64) -> Result<Vec<PriceChange>> {
    let mut stmt = conn.prepare(
        "SELECT changed_on, from_cents, to_cents FROM recurring_prices WHERE recurring_id = ?1
         ORDER BY changed_on DESC, id DESC",
    )?;
    let rows = stmt.query_map([bill], |r| {
        Ok(PriceChange {
            changed_on: r.get(0)?,
            from_cents: r.get(1)?,
            to_cents: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Each bill's latest price change, as (bill, change), by bill.
pub fn latest_changes(conn: &Connection) -> Result<Vec<(i64, PriceChange)>> {
    let mut stmt = conn.prepare(
        "SELECT p.recurring_id, p.changed_on, p.from_cents, p.to_cents FROM recurring_prices p
         WHERE p.id = (SELECT q.id FROM recurring_prices q WHERE q.recurring_id = p.recurring_id
                       ORDER BY q.changed_on DESC, q.id DESC LIMIT 1)
         ORDER BY p.recurring_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get(0)?,
            PriceChange {
                changed_on: r.get(1)?,
                from_cents: r.get(2)?,
                to_cents: r.get(3)?,
            },
        ))
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Older bill first: (created, id).
fn older(a: &SavedRecurring, b: &SavedRecurring) -> bool {
    (&a.created_on, a.id) <= (&b.created_on, b.id)
}

/// Pairs of bills (older first) that look like the same subscription: the same merchant, or one's rule fits the
/// other's charges. Pairs you kept apart aren't suggested.
pub fn look_alikes(conn: &Connection) -> Result<Vec<(i64, i64)>> {
    let mut bills: Vec<SavedRecurring> = recurrings::list(conn)?
        .into_iter()
        .filter(|s| s.status != Status::Archived)
        .collect();
    bills.sort_by(|a, b| (&a.created_on, a.id).cmp(&(&b.created_on, b.id)));
    let mut charges: HashMap<i64, Vec<recurrings::Candidate>> = HashMap::new();
    for c in recurrings::candidates(conn, None)? {
        if let Some(bill) = c.recurring_id {
            charges.entry(bill).or_default().push(c);
        }
    }
    let apart: HashSet<(i64, i64)> = {
        let mut stmt = conn.prepare("SELECT a, b FROM recurring_apart")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let fits_charges_of = |rule: &SavedRecurring, other: &SavedRecurring| {
        charges
            .get(&other.id)
            .is_some_and(|cs| cs.iter().any(|c| recurrings::name_fits(rule, c)))
    };
    let mut out = Vec::new();
    for (i, a) in bills.iter().enumerate() {
        for b in &bills[i + 1..] {
            if apart.contains(&(a.id.min(b.id), a.id.max(b.id))) {
                continue;
            }
            let same_merchant = a.match_kind == MatchKind::Merchant
                && b.match_kind == MatchKind::Merchant
                && a.pattern == b.pattern;
            if same_merchant || fits_charges_of(a, b) || fits_charges_of(b, a) {
                out.push((a.id, b.id));
            }
        }
    }
    Ok(out)
}

/// "Not the same subscription": never suggest merging these two.
pub fn keep_apart(conn: &Connection, a: i64, b: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO recurring_apart (a, b) VALUES (?1, ?2)",
        params![a.min(b), a.max(b)],
    )?;
    Ok(())
}

/// Merge two bills into the older one (its name, category and rule). It takes every charge, and the price and due
/// day of whichever was charged last; a price that moved is added to its history. Returns the bill kept.
pub fn merge(conn: &Connection, a: i64, b: i64) -> Result<i64> {
    if a == b {
        return Err(CoreError::Invalid("pick two different bills".into()));
    }
    let (x, y) = (recurrings::get(conn, a)?, recurrings::get(conn, b)?);
    let (keep, other) = if older(&x, &y) { (x, y) } else { (y, x) };
    let keep_last = last_charge(conn, keep.id)?;
    let other_last = last_charge(conn, other.id)?;
    crate::db::atomically(conn, |c| {
        let other_newer = match (&keep_last, &other_last) {
            (_, None) => false,
            (None, Some(_)) => true,
            (Some((k, _)), Some((o, _))) => o > k,
        };
        if other_newer {
            c.execute(
                "UPDATE recurrings SET min_cents = ?1, max_cents = ?2, day_of_month = ?3 WHERE id = ?4",
                params![other.min_cents, other.max_cents, other.day_of_month, keep.id],
            )?;
            if let (Some((since, from)), Some((_, to))) = (&keep_last, &other_last) {
                if *to < keep.min_cents || *to > keep.max_cents {
                    let changed_on: String = c.query_row(
                        "SELECT MIN(posted_on) FROM transactions WHERE recurring_id = ?1 AND posted_on > ?2",
                        params![other.id, since],
                        |r| r.get(0),
                    )?;
                    c.execute(
                        "INSERT INTO recurring_prices (recurring_id, changed_on, from_cents, to_cents) VALUES (?1, ?2, ?3, ?4)",
                        params![keep.id, changed_on, from, to],
                    )?;
                }
            }
        }
        if other.status == Status::Active {
            c.execute(
                "UPDATE recurrings SET status = 'active' WHERE id = ?1",
                [keep.id],
            )?;
        }
        for table in ["transactions", "price_checks", "recurring_prices"] {
            c.execute(
                &format!("UPDATE {table} SET recurring_id = ?1 WHERE recurring_id = ?2"),
                params![keep.id, other.id],
            )?;
        }
        c.execute(
            "DELETE FROM recurring_apart WHERE a = ?1 OR b = ?1",
            [other.id],
        )?;
        c.execute("DELETE FROM recurrings WHERE id = ?1", [other.id])?;
        Ok(keep.id)
    })
}
