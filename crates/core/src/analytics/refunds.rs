//! Refund matching, ported from Financial-Tracker's `findMatchingRefunds`.
//!
//! A charge (money out) is matched to the closest credit (money in) of the same
//! absolute amount within 90 days when the merchant keys agree or either side
//! mentions "refund". Each credit pairs with at most one charge: the closest.

use crate::error::Result;
use crate::profiles::ProfileId;
use crate::transactions::{self, Transaction, TransactionFilter};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const WINDOW_DAYS: i64 = 90;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefundMatch {
    pub charge_id: i64,
    pub refund_id: i64,
    pub amount_cents: i64,
    pub days_between: i64,
}

/// Pure matcher over an in-memory list; `transactions` may be in any order.
pub fn find_matches(transactions: &[Transaction]) -> Vec<RefundMatch> {
    let charges: Vec<&Transaction> = transactions.iter().filter(|t| t.amount_cents < 0).collect();
    let credits: Vec<&Transaction> = transactions.iter().filter(|t| t.amount_cents > 0).collect();

    // Every candidate pair, closest first, so each credit goes to its nearest charge.
    let mut pairs: Vec<(i64, &Transaction, &Transaction)> = Vec::new();
    for charge in &charges {
        let mentions_refund = charge.description.to_lowercase().contains("refund");
        for credit in &credits {
            if credit.amount_cents != -charge.amount_cents {
                continue;
            }
            let days = (credit.posted_on - charge.posted_on).num_days().abs();
            if days > WINDOW_DAYS {
                continue;
            }
            let related = credit.merchant == charge.merchant
                || mentions_refund
                || credit.description.to_lowercase().contains("refund");
            if related {
                pairs.push((days, charge, credit));
            }
        }
    }
    pairs.sort_by_key(|(days, charge, credit)| (*days, charge.id, credit.id));

    let mut charge_taken: HashMap<i64, ()> = HashMap::new();
    let mut credit_taken: HashMap<i64, ()> = HashMap::new();
    let mut out = Vec::new();
    for (days, charge, credit) in pairs {
        if charge_taken.contains_key(&charge.id) || credit_taken.contains_key(&credit.id) {
            continue;
        }
        charge_taken.insert(charge.id, ());
        credit_taken.insert(credit.id, ());
        out.push(RefundMatch {
            charge_id: charge.id,
            refund_id: credit.id,
            amount_cents: -charge.amount_cents,
            days_between: days,
        });
    }
    out.sort_by_key(|m| m.charge_id);
    out
}

/// Recompute refund links for a profile (or all profiles) and store them in `refund_of`.
pub fn rematch(conn: &Connection, profile_id: Option<ProfileId>) -> Result<Vec<RefundMatch>> {
    let filter = TransactionFilter {
        profile_id,
        ..Default::default()
    };
    let all = transactions::list(conn, &filter)?;
    let matches = find_matches(&all);
    match profile_id {
        Some(p) => conn.execute(
            "UPDATE transactions SET refund_of = NULL WHERE profile_id = ?1",
            [p],
        )?,
        None => conn.execute("UPDATE transactions SET refund_of = NULL", [])?,
    };
    for m in &matches {
        conn.execute(
            "UPDATE transactions SET refund_of = ?1 WHERE id = ?2",
            params![m.charge_id, m.refund_id],
        )?;
    }
    Ok(matches)
}
