//! Cash flow over a window with a comparison to the preceding window of equal length.

use crate::analytics::aggregate::{DateRange, INCOME_SUM, NOT_EXCLUDED, SPEND_SUM};
use crate::error::Result;
use crate::profiles::ProfileId;
use chrono::{Duration, NaiveDate};
use rusqlite::{types::Value, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    pub income_cents: i64,
    pub expense_cents: i64,
    pub net_cents: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlow {
    pub current: Flow,
    pub previous: Flow,
    /// current.net - previous.net.
    pub net_delta_cents: i64,
}

fn flow_between(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Flow> {
    let mut clauses = vec![
        "parent_id IS NULL".to_string(),
        NOT_EXCLUDED.to_string(),
        "posted_on >= ?".to_string(),
        "posted_on <= ?".to_string(),
    ];
    let mut args: Vec<Value> = vec![Value::from(from.to_string()), Value::from(to.to_string())];
    if let Some(p) = profile_id {
        clauses.push("profile_id = ?".to_string());
        args.push(Value::from(p));
    }
    let sql = format!(
        "SELECT {INCOME_SUM}, {SPEND_SUM} FROM transactions WHERE {}",
        clauses.join(" AND ")
    );
    let (income, expense): (i64, i64) =
        conn.query_row(&sql, rusqlite::params_from_iter(args), |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;
    Ok(Flow {
        income_cents: income,
        expense_cents: expense,
        net_cents: income - expense,
    })
}

/// Cash flow for `range` (both bounds required) vs the preceding equal-length window.
pub fn cash_flow(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    range: DateRange,
) -> Result<CashFlow> {
    // An open range ("All") spans the data itself: first to last transaction.
    let (first, last): (Option<String>, Option<String>) = conn.query_row(
        "SELECT min(posted_on), max(posted_on) FROM transactions
         WHERE parent_id IS NULL AND (?1 IS NULL OR profile_id = ?1)",
        [profile_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let parse = |d: Option<String>| d.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok());
    let to = range.to.or_else(|| parse(last.clone())).unwrap_or_default();
    let from = range.from.or_else(|| parse(first)).unwrap_or(to);
    let span = (to - from).num_days();
    let prev_to = from - Duration::days(1);
    let prev_from = prev_to - Duration::days(span);

    let current = flow_between(conn, profile_id, from, to)?;
    let previous = flow_between(conn, profile_id, prev_from, prev_to)?;
    Ok(CashFlow {
        current,
        previous,
        net_delta_cents: current.net_cents - previous.net_cents,
    })
}
