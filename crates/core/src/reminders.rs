//! Derive the notifications worth surfacing today: upcoming recurring charges,
//! budgets already over, and budgets on pace to blow past their limit.

use crate::analytics::budgets::month_status;
use crate::analytics::recurring::upcoming;
use crate::error::Result;
use crate::profiles::ProfileId;
use chrono::{Duration, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReminderKind {
    UpcomingBill,
    BudgetOver,
    BudgetProjectedOver,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub kind: ReminderKind,
    /// Stable id so a surface can avoid re-notifying (e.g. "bill:netflix:2026-12-15").
    pub key: String,
    pub title: String,
    pub body: String,
    /// The category this concerns, when applicable.
    pub category_id: Option<i64>,
}

/// Notifications due as of `today`. Bills within `horizon_days` are included.
pub fn due(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    today: NaiveDate,
    horizon_days: i64,
) -> Result<Vec<Reminder>> {
    let mut out = Vec::new();

    let horizon = today + Duration::days(horizon_days);
    for r in upcoming(conn, profile_id, today)? {
        if r.next_date <= horizon {
            let dollars = r.typical_amount_cents as f64 / 100.0;
            out.push(Reminder {
                kind: ReminderKind::UpcomingBill,
                key: format!("bill:{}:{}", r.merchant, r.next_date),
                title: format!("{} due soon", r.merchant),
                body: format!("About ${dollars:.2} on {}", r.next_date),
                category_id: r.category_id,
            });
        }
    }

    for b in month_status(conn, profile_id, today)? {
        if b.over_budget {
            out.push(Reminder {
                kind: ReminderKind::BudgetOver,
                key: format!("over:{}:{}", b.category_id, today.format("%Y-%m")),
                title: "Over budget".into(),
                body: format!(
                    "${:.2} over this month",
                    (b.spent_cents - b.budget_cents) as f64 / 100.0
                ),
                category_id: Some(b.category_id),
            });
        } else if b.projected_cents > b.budget_cents {
            out.push(Reminder {
                kind: ReminderKind::BudgetProjectedOver,
                key: format!("proj:{}:{}", b.category_id, today.format("%Y-%m")),
                title: "On pace to overspend".into(),
                body: format!(
                    "Projected ${:.2} vs ${:.2} budget",
                    b.projected_cents as f64 / 100.0,
                    b.budget_cents as f64 / 100.0
                ),
                category_id: Some(b.category_id),
            });
        }
    }

    Ok(out)
}
