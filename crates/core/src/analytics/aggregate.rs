//! Monthly and category aggregations over a time range, per profile or combined.
//!
//! Split handling: a split parent's amount is spread across its children's
//! categories, so category totals use the children and drop the parent, while
//! monthly income/expense totals use top-level rows (the parent counts once).

use crate::error::Result;
use crate::profiles::ProfileId;
use chrono::{Datelike, NaiveDate};
use rusqlite::{types::Value, Connection};
use serde::{Deserialize, Serialize};

/// A preset reporting window, resolved against a reference "today".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeRange {
    Week,
    Month,
    ThreeMonths,
    SixMonths,
    Ytd,
    Year,
    All,
}

/// An inclusive date window; `None` on a side means unbounded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateRange {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

/// Subtract `n` calendar months from `date`, clamping the day to month length.
pub fn sub_months(date: NaiveDate, n: u32) -> NaiveDate {
    shift_months(date, -(n as i64))
}

/// Add `n` calendar months to `date`, clamping the day to month length.
pub fn add_months(date: NaiveDate, n: u32) -> NaiveDate {
    shift_months(date, n as i64)
}

fn shift_months(date: NaiveDate, delta: i64) -> NaiveDate {
    let total = (date.year() as i64) * 12 + (date.month0() as i64) + delta;
    let year = total.div_euclid(12) as i32;
    let month0 = total.rem_euclid(12) as u32;
    let last = last_day_of_month(year, month0 + 1);
    NaiveDate::from_ymd_opt(year, month0 + 1, date.day().min(last)).unwrap()
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    first_next.pred_opt().unwrap().day()
}

impl TimeRange {
    /// Resolve to a concrete window ending at `today`.
    pub fn range(self, today: NaiveDate) -> DateRange {
        let from = match self {
            TimeRange::Week => Some(today - chrono::Duration::days(6)),
            TimeRange::Month => Some(sub_months(today, 1)),
            TimeRange::ThreeMonths => Some(sub_months(today, 3)),
            TimeRange::SixMonths => Some(sub_months(today, 6)),
            TimeRange::Ytd => NaiveDate::from_ymd_opt(today.year(), 1, 1),
            TimeRange::Year => Some(sub_months(today, 12)),
            TimeRange::All => None,
        };
        let to = match self {
            TimeRange::All => None,
            _ => Some(today),
        };
        DateRange { from, to }
    }
}

/// Income, expense and net for one calendar month (`YYYY-MM`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyTotal {
    pub month: String,
    pub income_cents: i64,
    pub expense_cents: i64,
    pub net_cents: i64,
}

/// Spend in one category over the window. `total_cents` is a positive magnitude.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category_id: Option<i64>,
    pub total_cents: i64,
    pub count: i64,
}

/// SQL condition keeping rows whose category is not excluded from totals
/// (transfers, card payments). Uncategorized rows still count.
/// Income is Income-type rows only.
pub(crate) const INCOME_SUM: &str =
    "COALESCE(SUM(CASE WHEN type = 'income' THEN display_cents(amount_cents, currency, posted_on) ELSE 0 END), 0)";
/// Spending is Regular-type rows, net of refunds (positive Regular rows reduce it).
/// Transfers count in neither.
pub(crate) const SPEND_SUM: &str =
    "COALESCE(SUM(CASE WHEN type = 'regular' THEN -display_cents(amount_cents, currency, posted_on) ELSE 0 END), 0)";

pub(crate) const NOT_EXCLUDED: &str =
    "(category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE excluded = 1))";

fn range_clause(profile_id: Option<ProfileId>, range: DateRange, args: &mut Vec<Value>) -> String {
    let mut clauses = Vec::new();
    if let Some(p) = profile_id {
        clauses.push("profile_id = ?".to_string());
        args.push(Value::from(p));
    }
    if let Some(from) = range.from {
        clauses.push("posted_on >= ?".to_string());
        args.push(Value::from(from.to_string()));
    }
    if let Some(to) = range.to {
        clauses.push("posted_on <= ?".to_string());
        args.push(Value::from(to.to_string()));
    }
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" AND {}", clauses.join(" AND "))
    }
}

/// Monthly income/expense/net over top-level transactions in the window.
pub fn monthly_totals(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    range: DateRange,
) -> Result<Vec<MonthlyTotal>> {
    let mut args: Vec<Value> = Vec::new();
    let where_extra = range_clause(profile_id, range, &mut args);
    let sql = format!(
        "SELECT substr(posted_on, 1, 7) AS ym,
                {INCOME_SUM} AS income,
                {SPEND_SUM} AS expense
         FROM transactions
         WHERE parent_id IS NULL AND {NOT_EXCLUDED}{where_extra}
         GROUP BY ym ORDER BY ym"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), |r| {
        let income: i64 = r.get(1)?;
        let expense: i64 = r.get(2)?;
        Ok(MonthlyTotal {
            month: r.get(0)?,
            income_cents: income,
            expense_cents: expense,
            net_cents: income - expense,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Category spend (Regular rows, net of refunds) over the window, split-aware, largest first.
pub fn category_totals(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    range: DateRange,
) -> Result<Vec<CategoryTotal>> {
    let mut args: Vec<Value> = Vec::new();
    let where_extra = range_clause(profile_id, range, &mut args);
    // Exclude split parents (rows that are a parent of another row); include their
    // children and all other rows. Only Regular rows count; a refund (positive) reduces spend.
    let sql = format!(
        "SELECT category_id,
                COALESCE(SUM(-display_cents(amount_cents, currency, posted_on)), 0) AS total,
                COUNT(*) AS n
         FROM transactions t
         WHERE type = 'regular' AND {NOT_EXCLUDED}{where_extra}
           AND NOT EXISTS (SELECT 1 FROM transactions c WHERE c.parent_id = t.id)
         GROUP BY category_id ORDER BY total DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), |r| {
        Ok(CategoryTotal {
            category_id: r.get(0)?,
            total_cents: r.get(1)?,
            count: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
