//! Budget status for the current calendar month: spent, remaining, and a
//! straight-line projection to month end.

use crate::analytics::aggregate::{category_totals, DateRange};
use crate::categories::{self, Category};
use crate::error::Result;
use crate::profiles::ProfileId;
use chrono::{Datelike, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub category_id: i64,
    pub budget_cents: i64,
    pub spent_cents: i64,
    pub remaining_cents: i64,
    /// Spend extrapolated to month end at the current daily pace.
    pub projected_cents: i64,
    pub over_budget: bool,
}

fn first_of_month(d: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap()
}

fn days_in_month(d: NaiveDate) -> i64 {
    let (y, m) = (d.year(), d.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let next = NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    (next - first_of_month(d)).num_days()
}

/// Budget status for every category with a budget, for the month containing `today`.
pub fn month_status(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    today: NaiveDate,
) -> Result<Vec<BudgetStatus>> {
    let range = DateRange {
        from: Some(first_of_month(today)),
        to: Some(today),
    };
    let spent: HashMap<Option<i64>, i64> = category_totals(conn, profile_id, range)?
        .into_iter()
        .map(|c| (c.category_id, c.total_cents))
        .collect();

    let day = today.day() as i64;
    let total_days = days_in_month(today);

    // This month's budgets (overrides win; members of a shared group budget are left out).
    let month = today.format("%Y-%m").to_string();
    let budgets: HashMap<i64, i64> = crate::budgets::effective_budgets(conn, &month)?
        .into_iter()
        .collect();
    let mut out = Vec::new();
    for cat in categories::list(conn)? {
        let Category { id, excluded, .. } = cat;
        let Some(&budget) = budgets.get(&id) else {
            continue;
        };
        if excluded || budget <= 0 {
            continue;
        }
        let spent_cents = *spent.get(&Some(id)).unwrap_or(&0);
        let projected_cents = if day > 0 {
            spent_cents * total_days / day
        } else {
            spent_cents
        };
        out.push(BudgetStatus {
            category_id: id,
            budget_cents: budget,
            spent_cents,
            remaining_cents: budget - spent_cents,
            projected_cents,
            over_budget: spent_cents > budget,
        });
    }
    out.sort_by_key(|b| std::cmp::Reverse(b.spent_cents));
    Ok(out)
}
