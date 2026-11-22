//! Recurring-charge detection: group by merchant, find a regular cadence and a
//! stable amount band, and project the next expected date.

use crate::analytics::aggregate::add_months;
use crate::error::Result;
use crate::profiles::ProfileId;
use crate::transactions::{self, Transaction, TransactionFilter};
use chrono::{Duration, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cadence {
    Weekly,
    Biweekly,
    Monthly,
    Quarterly,
    Yearly,
}

impl Cadence {
    pub fn as_str(self) -> &'static str {
        match self {
            Cadence::Weekly => "weekly",
            Cadence::Biweekly => "biweekly",
            Cadence::Monthly => "monthly",
            Cadence::Quarterly => "quarterly",
            Cadence::Yearly => "yearly",
        }
    }
    pub fn parse(s: &str) -> Cadence {
        match s {
            "weekly" => Cadence::Weekly,
            "biweekly" => Cadence::Biweekly,
            "quarterly" => Cadence::Quarterly,
            "yearly" => Cadence::Yearly,
            _ => Cadence::Monthly,
        }
    }
    /// The date one period after `from`.
    pub fn next_after(self, from: NaiveDate) -> NaiveDate {
        match self {
            Cadence::Weekly => from + Duration::days(7),
            Cadence::Biweekly => from + Duration::days(14),
            Cadence::Monthly => add_months(from, 1),
            Cadence::Quarterly => add_months(from, 3),
            Cadence::Yearly => add_months(from, 12),
        }
    }
    fn classify(median_gap: i64) -> Option<Cadence> {
        match median_gap {
            5..=9 => Some(Cadence::Weekly),
            12..=16 => Some(Cadence::Biweekly),
            26..=33 => Some(Cadence::Monthly),
            83..=97 => Some(Cadence::Quarterly),
            350..=380 => Some(Cadence::Yearly),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurring {
    pub merchant: String,
    pub category_id: Option<i64>,
    pub typical_amount_cents: i64,
    pub cadence: Cadence,
    pub last_date: NaiveDate,
    pub next_date: NaiveDate,
    pub occurrences: usize,
    /// The saved bill behind this view; `None` for a detected (suggested) series.
    #[serde(default)]
    pub saved: Option<crate::recurrings::SavedRecurring>,
}

fn median(mut xs: Vec<i64>) -> i64 {
    xs.sort_unstable();
    let n = xs.len();
    if n == 0 {
        return 0;
    }
    if n % 2 == 1 {
        xs[n / 2]
    } else {
        (xs[n / 2 - 1] + xs[n / 2]) / 2
    }
}

/// Mode of category ids among a series (most common; ties resolved by first seen).
fn dominant_category(txs: &[&Transaction]) -> Option<i64> {
    let mut counts: HashMap<Option<i64>, usize> = HashMap::new();
    for t in txs {
        *counts.entry(t.category_id).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by_key(|&(_, n)| n)
        .and_then(|(c, _)| c)
}

/// Detect recurring series in a transaction list. Pure; order-independent.
pub fn detect(transactions: &[Transaction]) -> Vec<Recurring> {
    let mut by_merchant: HashMap<&str, Vec<&Transaction>> = HashMap::new();
    for t in transactions.iter().filter(|t| {
        t.amount_cents < 0
            && !t.merchant.is_empty()
            && t.tx_type == crate::transactions::TxType::Regular
    }) {
        by_merchant.entry(t.merchant.as_str()).or_default().push(t);
    }

    let mut out = Vec::new();
    for (merchant, mut series) in by_merchant {
        if series.len() < 3 {
            continue;
        }
        series.sort_by_key(|t| (t.posted_on, t.id));
        // The same charge twice on one day (a re-import, a retry) counts once:
        // a zero-day gap would otherwise break the cadence.
        series.dedup_by(|b, a| b.posted_on == a.posted_on && b.amount_cents == a.amount_cents);
        if series.len() < 3 {
            continue;
        }

        let gaps: Vec<i64> = series
            .windows(2)
            .map(|w| (w[1].posted_on - w[0].posted_on).num_days())
            .collect();
        let median_gap = median(gaps.clone());
        let Some(cadence) = Cadence::classify(median_gap) else {
            continue;
        };

        // Regularity: most gaps near the median.
        let tol = (median_gap / 4).max(4);
        let regular = gaps
            .iter()
            .filter(|&&g| (g - median_gap).abs() <= tol)
            .count();
        if (regular as f64) < (gaps.len() as f64) * 0.6 {
            continue;
        }

        // Amount stability: median magnitude, with most within a 35% band.
        let amounts: Vec<i64> = series.iter().map(|t| -t.amount_cents).collect();
        let typical = median(amounts.clone());
        if typical <= 0 {
            continue;
        }
        let band = (typical / 100 * 35).max(500);
        let stable = amounts
            .iter()
            .filter(|&&a| (a - typical).abs() <= band)
            .count();
        if (stable as f64) < (amounts.len() as f64) * 0.6 {
            continue;
        }

        let last = series.last().unwrap();
        let next_date = cadence.next_after(last.posted_on);
        out.push(Recurring {
            merchant: merchant.to_string(),
            category_id: dominant_category(&series),
            typical_amount_cents: typical,
            cadence,
            last_date: last.posted_on,
            next_date,
            occurrences: series.len(),
            saved: None,
        });
    }
    out.sort_by(|a, b| {
        a.next_date
            .cmp(&b.next_date)
            .then(a.merchant.cmp(&b.merchant))
    });
    out
}

/// The saved recurring bills (every status), as views built from their linked charges.
pub fn list_recurring(conn: &Connection, profile_id: Option<ProfileId>) -> Result<Vec<Recurring>> {
    crate::recurrings::views(conn, profile_id)
}

/// Detect recurring series for a profile (or combined), over all history.
pub fn detect_for(conn: &Connection, profile_id: Option<ProfileId>) -> Result<Vec<Recurring>> {
    let filter = TransactionFilter {
        profile_id,
        ..Default::default()
    };
    let txs = transactions::list(conn, &filter)?;
    Ok(detect(&txs))
}

/// Active saved bills whose next expected date is on or after `today`.
pub fn upcoming(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    today: NaiveDate,
) -> Result<Vec<Recurring>> {
    Ok(list_recurring(conn, profile_id)?
        .into_iter()
        .filter(|r| r.next_date >= today)
        .filter(|r| {
            r.saved
                .as_ref()
                .is_none_or(|s| s.status == crate::recurrings::Status::Active)
        })
        .collect())
}
