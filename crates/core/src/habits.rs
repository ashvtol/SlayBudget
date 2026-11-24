//! Everything "Your money habits" needs from all of history, in one read: income, spending, needs and money moved
//! to savings per month; flexible spending per category and month; this month's spending per day; frequent
//! merchants; bills that went up. The app turns this into stats, a suggested budget and tips.

use crate::analytics::aggregate::{INCOME_SUM, NOT_EXCLUDED, SPEND_SUM};
use crate::error::Result;
use crate::profiles::ProfileId;
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{types::Value, Connection};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitMonth {
    pub month: String,
    pub income_cents: i64,
    pub spend_cents: i64,
    pub essential_cents: i64,
    pub to_savings_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlexMonth {
    pub category_id: i64,
    pub month: String,
    pub cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySpend {
    pub day: String,
    pub cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantStat {
    pub name: String,
    pub visits: i64,
    pub total_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitsData {
    pub first_month: Option<String>,
    pub current_month: String,
    pub months: Vec<HabitMonth>,
    pub flexible: Vec<FlexMonth>,
    pub days_this_month: Vec<DaySpend>,
    pub merchants: Vec<MerchantStat>,
    pub bills_raised_last_12: i64,
}

/// A frequent merchant: this many visits or more in the last year.
pub const MIN_VISITS: i64 = 24;

/// Rows linked to an active bill.
const ON_BILL: &str = "(recurring_id IS NOT NULL AND recurring_id IN (SELECT id FROM recurrings WHERE status = 'active'))";
/// Leaf rows: a split parent's amount is counted through its children.
const LEAF: &str = "t.id NOT IN (SELECT parent_id FROM transactions WHERE parent_id IS NOT NULL)";

fn profile_clause(profile_id: Option<ProfileId>, args: &mut Vec<Value>) -> String {
    match profile_id {
        Some(p) => {
            args.push(Value::from(p));
            " AND profile_id = ?".to_string()
        }
        None => String::new(),
    }
}

fn month_after(ym: &str) -> String {
    let (y, m): (i32, u32) = (
        ym[..4].parse().unwrap_or(1970),
        ym[5..7].parse().unwrap_or(1),
    );
    if m == 12 {
        format!("{:04}-01", y + 1)
    } else {
        format!("{y:04}-{:02}", m + 1)
    }
}

pub fn money_habits(
    conn: &Connection,
    profile_id: Option<ProfileId>,
    today: &str,
) -> Result<HabitsData> {
    let today_date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map_err(|e| crate::CoreError::Invalid(format!("bad date {today}: {e}")))?;
    let current_month = format!("{:04}-{:02}", today_date.year(), today_date.month());

    let mut args = Vec::new();
    let pc = profile_clause(profile_id, &mut args);
    let first_month: Option<String> = conn.query_row(
        &format!("SELECT min(substr(posted_on, 1, 7)) FROM transactions WHERE posted_on <= '{today}'{pc}"),
        rusqlite::params_from_iter(args.clone()),
        |r| r.get(0),
    )?;

    let mut months = Vec::new();
    if let Some(first) = &first_month {
        // Income and spending as the Cash flow page counts them (top-level rows).
        let totals = query_map(
            conn,
            &format!(
                "SELECT substr(posted_on, 1, 7), {INCOME_SUM}, {SPEND_SUM} FROM transactions
                 WHERE parent_id IS NULL AND {NOT_EXCLUDED} AND posted_on <= '{today}'{pc} GROUP BY 1"
            ),
            &args,
            |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))),
        )?;
        let needs = query_map(
            conn,
            &format!(
                "SELECT substr(posted_on, 1, 7), COALESCE(SUM(-display_cents(amount_cents, currency, posted_on)), 0)
                 FROM transactions t
                 WHERE type = 'regular' AND {NOT_EXCLUDED} AND {LEAF} AND posted_on <= '{today}'{pc}
                   AND (category_id IN (SELECT id FROM categories WHERE essential = 1) OR {ON_BILL})
                 GROUP BY 1"
            ),
            &args,
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )?;
        let saved = query_map(
            conn,
            &format!(
                "SELECT substr(posted_on, 1, 7), COALESCE(SUM(display_cents(amount_cents, currency, posted_on)), 0)
                 FROM transactions
                 WHERE parent_id IS NULL AND type = 'transfer' AND amount_cents > 0 AND posted_on <= '{today}'{pc}
                   AND source_id IN (SELECT id FROM sources WHERE account_type = 'savings')
                 GROUP BY 1"
            ),
            &args,
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )?;
        let find = |v: &Vec<(String, i64)>, m: &str| {
            v.iter().find(|(k, _)| k == m).map(|(_, c)| *c).unwrap_or(0)
        };
        let mut m = first.clone();
        while m <= current_month {
            let (income, spend) = totals
                .iter()
                .find(|(k, _)| *k == m)
                .map(|(_, v)| *v)
                .unwrap_or((0, 0));
            months.push(HabitMonth {
                month: m.clone(),
                income_cents: income,
                spend_cents: spend,
                essential_cents: find(&needs, &m),
                to_savings_cents: find(&saved, &m),
            });
            m = month_after(&m);
        }
    }

    let flexible = query_map(
        conn,
        &format!(
            "SELECT category_id, substr(posted_on, 1, 7), COALESCE(SUM(-display_cents(amount_cents, currency, posted_on)), 0)
             FROM transactions t
             WHERE type = 'regular' AND {LEAF} AND posted_on <= '{today}'{pc} AND NOT {ON_BILL}
               AND category_id IN (SELECT id FROM categories WHERE kind = 'expense' AND excluded = 0 AND essential = 0)
             GROUP BY 1, 2 HAVING SUM(-amount_cents) <> 0 ORDER BY 2, 1"
        ),
        &args,
        |r| Ok(FlexMonth { category_id: r.get(0)?, month: r.get(1)?, cents: r.get(2)? }),
    )?;

    let days_this_month = query_map(
        conn,
        &format!(
            "SELECT posted_on, COALESCE(SUM(-display_cents(amount_cents, currency, posted_on)), 0)
             FROM transactions t
             WHERE type = 'regular' AND {NOT_EXCLUDED} AND {LEAF} AND NOT {ON_BILL}
               AND posted_on >= '{current_month}-01' AND posted_on <= '{today}'{pc}
             GROUP BY 1 ORDER BY 1"
        ),
        &args,
        |r| {
            Ok(DaySpend {
                day: r.get(0)?,
                cents: r.get(1)?,
            })
        },
    )?;

    let year_ago = (today_date - Duration::days(365)).to_string();
    let merchants = query_map(
        conn,
        &format!(
            "SELECT merchant, count(*), COALESCE(SUM(-display_cents(amount_cents, currency, posted_on)), 0) AS total
             FROM transactions t
             WHERE type = 'regular' AND amount_cents < 0 AND {NOT_EXCLUDED} AND {LEAF}
               AND posted_on > '{year_ago}' AND posted_on <= '{today}'{pc} AND merchant <> ''
             GROUP BY merchant HAVING count(*) >= {MIN_VISITS} ORDER BY total DESC LIMIT 10"
        ),
        &args,
        |r| Ok(MerchantStat { name: r.get(0)?, visits: r.get(1)?, total_cents: r.get(2)? }),
    )?;

    let bills_raised_last_12: i64 = conn.query_row(
        "SELECT count(*) FROM recurring_prices WHERE to_cents > from_cents AND changed_on > ?1 AND changed_on <= ?2",
        [&year_ago, today],
        |r| r.get(0),
    )?;

    Ok(HabitsData {
        first_month,
        current_month,
        months,
        flexible,
        days_this_month,
        merchants,
        bills_raised_last_12,
    })
}

fn query_map<T>(
    conn: &Connection,
    sql: &str,
    args: &[Value],
    f: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter().cloned()), f)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
