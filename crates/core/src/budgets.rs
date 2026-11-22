//! Budget plan (Copilot): a category's default budget with per-month overrides, shared group
//! budgets, rollovers, and saving a rebalance. Amounts are integer cents.

use crate::categories::{CategoryId, GroupId};
use crate::error::{CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthBudget {
    pub category_id: CategoryId,
    pub month: String,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupBudget {
    pub group_id: GroupId,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloverStart {
    pub category_id: CategoryId,
    /// First month whose leftover carries forward ('YYYY-MM').
    pub since: String,
}

/// Everything beyond the categories' default budgets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetPlan {
    pub months: Vec<MonthBudget>,
    pub groups: Vec<GroupBudget>,
    pub rollovers: Vec<RolloverStart>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RebalanceScope {
    /// Overrides for the given month only.
    ThisMonth,
    /// New defaults; overrides from the given month on are removed.
    FromNowOn,
}

fn check_month(month: &str) -> Result<()> {
    let ok = month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month[..4].chars().all(|c| c.is_ascii_digit())
        && matches!(month[5..].parse::<u32>(), Ok(1..=12));
    if ok {
        Ok(())
    } else {
        Err(CoreError::Invalid(format!("not a month: {month}")))
    }
}

fn check_amount(amount: Option<i64>) -> Result<()> {
    match amount {
        Some(a) if a < 0 => Err(CoreError::Invalid("a budget can't be negative".into())),
        _ => Ok(()),
    }
}

fn check_category(conn: &Connection, id: CategoryId) -> Result<()> {
    let found: Option<i64> = conn
        .query_row("SELECT id FROM categories WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()?;
    found
        .map(|_| ())
        .ok_or_else(|| CoreError::NotFound(format!("category {id}")))
}

pub fn plan(conn: &Connection) -> Result<BudgetPlan> {
    let mut months = conn.prepare(
        "SELECT category_id, month, amount_cents FROM category_budget_months ORDER BY category_id, month",
    )?;
    let months = months
        .query_map([], |r| {
            Ok(MonthBudget {
                category_id: r.get(0)?,
                month: r.get(1)?,
                amount_cents: r.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut groups = conn.prepare(
        "SELECT id, budget_cents FROM category_groups WHERE budget_cents IS NOT NULL ORDER BY id",
    )?;
    let groups = groups
        .query_map([], |r| {
            Ok(GroupBudget {
                group_id: r.get(0)?,
                amount_cents: r.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut rollovers = conn.prepare(
        "SELECT id, rollover_since FROM categories WHERE rollover_since IS NOT NULL ORDER BY id",
    )?;
    let rollovers = rollovers
        .query_map([], |r| {
            Ok(RolloverStart {
                category_id: r.get(0)?,
                since: r.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(BudgetPlan {
        months,
        groups,
        rollovers,
    })
}

/// Set a category's budget. Without a month: the default for all months, and every override is
/// removed ("Same budget for all months"). With a month: that month's override; `None` removes
/// it so the month falls back to the default.
pub fn set_budget(
    conn: &Connection,
    category_id: CategoryId,
    month: Option<&str>,
    amount_cents: Option<i64>,
) -> Result<()> {
    check_amount(amount_cents)?;
    if let Some(m) = month {
        check_month(m)?;
    }
    check_category(conn, category_id)?;
    match (month, amount_cents) {
        (None, amount) => {
            conn.execute(
                "UPDATE categories SET budget_cents = ?1 WHERE id = ?2",
                params![amount, category_id],
            )?;
            conn.execute(
                "DELETE FROM category_budget_months WHERE category_id = ?1",
                [category_id],
            )?;
        }
        (Some(m), Some(amount)) => {
            conn.execute(
                "INSERT INTO category_budget_months (category_id, month, amount_cents) VALUES (?1, ?2, ?3)
                 ON CONFLICT (category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents",
                params![category_id, m, amount],
            )?;
        }
        (Some(m), None) => {
            conn.execute(
                "DELETE FROM category_budget_months WHERE category_id = ?1 AND month = ?2",
                params![category_id, m],
            )?;
        }
    }
    Ok(())
}

/// The budget a category has in a month: its override, else its default.
pub fn budget_for(conn: &Connection, category_id: CategoryId, month: &str) -> Result<Option<i64>> {
    let over: Option<i64> = conn
        .query_row(
            "SELECT amount_cents FROM category_budget_months WHERE category_id = ?1 AND month = ?2",
            params![category_id, month],
            |r| r.get(0),
        )
        .optional()?;
    if over.is_some() {
        return Ok(over);
    }
    Ok(conn
        .query_row(
            "SELECT budget_cents FROM categories WHERE id = ?1",
            [category_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten())
}

/// A shared budget for a group; `None` goes back to the sum of its categories.
pub fn set_group_budget(
    conn: &Connection,
    group_id: GroupId,
    amount_cents: Option<i64>,
) -> Result<()> {
    check_amount(amount_cents)?;
    let n = conn.execute(
        "UPDATE category_groups SET budget_cents = ?1 WHERE id = ?2",
        params![amount_cents, group_id],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("group {group_id}")));
    }
    Ok(())
}

/// Roll a category's leftover forward from `since`; `None` stops rolling over.
pub fn set_rollover(conn: &Connection, category_id: CategoryId, since: Option<&str>) -> Result<()> {
    if let Some(m) = since {
        check_month(m)?;
    }
    check_category(conn, category_id)?;
    conn.execute(
        "UPDATE categories SET rollover_since = ?1 WHERE id = ?2",
        params![since, category_id],
    )?;
    Ok(())
}

/// Save a rebalance: new amounts for categories in `month`, which must keep their total.
pub fn apply_rebalance(
    conn: &Connection,
    changes: &[(CategoryId, i64)],
    scope: RebalanceScope,
    month: &str,
) -> Result<()> {
    check_month(month)?;
    let mut before = 0;
    let mut after = 0;
    for &(id, amount) in changes {
        check_amount(Some(amount))?;
        before += budget_for(conn, id, month)?.unwrap_or(0);
        after += amount;
    }
    if before != after {
        return Err(CoreError::Invalid(format!(
            "a rebalance must keep the total budget ({before} before, {after} after)"
        )));
    }
    let tx = conn.unchecked_transaction()?;
    for &(id, amount) in changes {
        match scope {
            RebalanceScope::ThisMonth => set_budget(&tx, id, Some(month), Some(amount))?,
            RebalanceScope::FromNowOn => {
                tx.execute(
                    "UPDATE categories SET budget_cents = ?1 WHERE id = ?2",
                    params![amount, id],
                )?;
                tx.execute(
                    "DELETE FROM category_budget_months WHERE category_id = ?1 AND month >= ?2",
                    params![id, month],
                )?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Each category's effective budget in `month`, leaving out categories whose group has a shared
/// budget (that budget is counted once for the group instead).
pub fn effective_budgets(conn: &Connection, month: &str) -> Result<Vec<(CategoryId, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, COALESCE(m.amount_cents, c.budget_cents)
         FROM categories c
         JOIN category_groups g ON g.id = c.group_id
         LEFT JOIN category_budget_months m ON m.category_id = c.id AND m.month = ?1
         WHERE g.budget_cents IS NULL AND COALESCE(m.amount_cents, c.budget_cents) IS NOT NULL",
    )?;
    let rows = stmt.query_map([month], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
