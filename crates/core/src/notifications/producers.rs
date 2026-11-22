//! Producers: look at the data and create notifications for events worth knowing about. They run over all
//! profiles at once; each notification carries the profile whose data it is about (None = household-wide).
//! Every event has a stable key, so re-running never repeats one.

use super::config::{self, Config};
use super::{add_if_new, prune, Kind, NewNotification, Notification};
use crate::error::Result;
use crate::recurrings::{self, Status};
use crate::settings;
use crate::{budgets as plan, categories};
use chrono::NaiveDate;
use chrono::{Datelike, Duration};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

const BASELINED_KEY: &str = "notifications.baselined_at";
/// After this long without a charge, a bill is "not seen lately" (likely cancelled), not missed.
const MISSED_WINDOW_DAYS: i64 = 35;

/// Create notifications for today's events and return the new ones. In baseline mode (the first run, or after the
/// settings change) everything already true is stored as read, without banners, so nothing from the past floods in.
pub fn refresh(
    conn: &Connection,
    today: NaiveDate,
    now: &str,
    baseline: bool,
) -> Result<Vec<Notification>> {
    let baseline = baseline || settings::get(conn, BASELINED_KEY)?.is_none();
    let config = config::load(conn)?;
    let mut fresh = Vec::new();
    for n in candidates(conn, &config, today)? {
        if !config.bell(kind_key(n.kind)) {
            continue;
        }
        if let Some(saved) = add_if_new(conn, &n, now, baseline)? {
            if !baseline {
                fresh.push(saved);
            }
        }
    }
    if baseline {
        settings::set(conn, BASELINED_KEY, now)?;
    }
    prune(conn, now)?;
    Ok(fresh)
}

fn kind_key(kind: Kind) -> &'static str {
    match kind {
        Kind::Update => "update",
        Kind::BillUpcoming => "billUpcoming",
        Kind::BillMissed => "billMissed",
        Kind::PriceUp => "priceUp",
        Kind::DoubleCharge => "doubleCharge",
        Kind::LargeTransaction => "largeTransaction",
        Kind::OverBudget => "overBudget",
        Kind::MonthlyRecap => "monthlyRecap",
        Kind::ReviewDigest => "reviewDigest",
        Kind::MoneyIn => "moneyIn",
        Kind::PossibleDuplicates => "possibleDuplicates",
    }
}

/// Every event that is true today (dedupe happens on insert).
pub fn candidates(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
) -> Result<Vec<NewNotification>> {
    let mut out = Vec::new();
    bills(conn, config, today, &mut out)?;
    price_ups(conn, config, today, &mut out)?;
    double_charges(conn, config, today, &mut out)?;
    large_transactions(conn, config, today, &mut out)?;
    money_in(conn, config, today, &mut out)?;
    possible_duplicates(conn, &mut out)?;
    budgets(conn, config, today, &mut out)?;
    recap(conn, today, &mut out)?;
    review_digest(conn, config, today, &mut out)?;
    Ok(out)
}

/// "$1,234.56" from cents.
pub fn money(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let c = cents.abs();
    let dollars = (c / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in dollars.chars().enumerate() {
        if i > 0 && (dollars.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("{sign}${grouped}.{:02}", c % 100)
}

/// "Sat, Dec 5".
fn day(d: NaiveDate) -> String {
    d.format("%a, %b %-d").to_string()
}

/// Whether the bill's account has a transaction after `due`: statements are imported by hand, so a missing charge
/// only means "missed" once the account's data runs past the due date.
fn statement_covers(conn: &Connection, recurring_id: i64, due: NaiveDate) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM transactions t WHERE t.posted_on > ?2 AND t.source_id =
           (SELECT source_id FROM transactions WHERE recurring_id = ?1 ORDER BY posted_on DESC, id DESC LIMIT 1))",
        params![recurring_id, due.to_string()],
        |r| r.get(0),
    )?)
}

fn last_charge_profile(conn: &Connection, recurring_id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT profile_id FROM transactions WHERE recurring_id = ?1 ORDER BY posted_on DESC, id DESC LIMIT 1",
            params![recurring_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Upcoming (N days before, and on the due day) and missed (no charge after the grace period) saved bills.
fn bills(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    for view in recurrings::views(conn, None)? {
        let Some(saved) = view.saved.as_ref() else {
            continue;
        };
        if saved.status != Status::Active {
            continue;
        }
        let due = view.next_date;
        let until = (due - today).num_days();
        let profile = last_charge_profile(conn, saved.id)?;
        let target = json!({ "kind": "recurring", "id": saved.id });
        let about = format!("About {} on {}", money(view.typical_amount_cents), day(due));
        let mut push = |key: String, kind: Kind, title: String, body: String| {
            out.push(NewNotification {
                key,
                kind,
                title,
                body,
                target: target.clone(),
                profile_id: profile,
            });
        };
        if until > 0 && until <= config.bill_lead_days {
            let when = if until == 1 {
                "tomorrow".to_string()
            } else {
                format!("in {until} days")
            };
            push(
                format!("bill:{}:{due}", saved.id),
                Kind::BillUpcoming,
                format!("{} is due {when}", saved.name),
                about.clone(),
            );
        } else if until == 0 && config.bill_due_day {
            push(
                format!("billdue:{}:{due}", saved.id),
                Kind::BillUpcoming,
                format!("{} is due today", saved.name),
                about.clone(),
            );
        } else if until < 0
            && -until >= config.missed_grace_days
            && -until <= MISSED_WINDOW_DAYS
            && statement_covers(conn, saved.id, due)?
        {
            push(
                format!("missed:{}:{due}", saved.id),
                Kind::BillMissed,
                format!("{} looks missed", saved.name),
                format!(
                    "Expected about {} on {}, and no charge has come in yet.",
                    money(view.typical_amount_cents),
                    day(due)
                ),
            );
        }
    }
    Ok(())
}

/// Only recent transactions notify (a statement imported weeks late shouldn't alert about old charges).
const RECENT_DAYS: i64 = 7;
/// A bill's price change is noticed up to this long after the new charge.
const PRICE_WINDOW_DAYS: i64 = 45;

/// "apple store" -> "Apple Store".
fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn since(today: NaiveDate, days: i64) -> String {
    (today - chrono::Duration::days(days)).to_string()
}

/// Regular spending we count: not transfers, income or split parents.
const REGULAR: &str = "t.type = 'regular' AND t.parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM transactions c WHERE c.parent_id = t.id)";

/// A bill whose latest charge is at least the set percent and amount above the one before.
fn price_ups(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    for s in recurrings::list(conn)? {
        if s.status != Status::Active {
            continue;
        }
        let mut stmt = conn.prepare(
            "SELECT posted_on, -amount_cents, profile_id FROM transactions
             WHERE recurring_id = ?1 AND amount_cents < 0 ORDER BY posted_on DESC, id DESC LIMIT 3",
        )?;
        let last2: Vec<(String, i64, i64)> = stmt
            .query_map([s.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<_, _>>()?;
        // A price went up only if it had been steady: the two charges before agree within 1%.
        let [(date, now_cents, profile), (_, before, _), (_, earlier, _)] = last2.as_slice() else {
            continue;
        };
        if *date < since(today, PRICE_WINDOW_DAYS)
            || *before <= 0
            || (before - earlier).abs() > (earlier / 100).max(1)
        {
            continue;
        }
        let rise = now_cents - before;
        if rise < config.price_up_min_cents.max(1)
            || (rise as f64) * 100.0 < config.price_up_percent * (*before as f64)
        {
            continue;
        }
        let pct = ((rise as f64) * 100.0 / (*before as f64)).round();
        out.push(NewNotification {
            key: format!("price:{}:{date}", s.id),
            kind: Kind::PriceUp,
            title: format!("{} went up", s.name),
            body: format!("From {} to {} (+{pct}%)", money(*before), money(*now_cents)),
            target: json!({ "kind": "recurring", "id": s.id }),
            profile_id: Some(*profile),
        });
    }
    Ok(())
}

/// Two charges for the same amount at the same merchant within the window (bills excluded: they repeat by design).
fn double_charges(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.id, t.id, t.merchant, -t.amount_cents, t.posted_on, t.profile_id
         FROM transactions t
         JOIN transactions a ON a.merchant = t.merchant AND a.amount_cents = t.amount_cents AND a.id < t.id
              AND a.profile_id = t.profile_id AND a.type = 'regular' AND a.recurring_id IS NULL AND a.parent_id IS NULL
              AND abs(julianday(t.posted_on) - julianday(a.posted_on)) <= ?2
         WHERE {REGULAR} AND t.amount_cents < 0 AND t.recurring_id IS NULL AND t.posted_on >= ?1 AND t.posted_on <= ?3
         ORDER BY a.id, t.id"
    ))?;
    let rows: Vec<(i64, i64, String, i64, String, i64)> = stmt
        .query_map(
            params![
                since(today, RECENT_DAYS),
                config.double_charge_days,
                today.to_string()
            ],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )?
        .collect::<std::result::Result<_, _>>()?;
    for (a, b, merchant, cents, posted, profile) in rows {
        let name = title_case(&merchant);
        let on = NaiveDate::parse_from_str(&posted, "%Y-%m-%d")
            .map(day)
            .unwrap_or(posted);
        out.push(NewNotification {
            key: format!("dup:{a}:{b}"),
            kind: Kind::DoubleCharge,
            title: "Possible double charge".into(),
            body: format!("Two charges of {} at {name} around {on}", money(cents)),
            target: json!({ "kind": "transactions", "filter": "search", "text": name }),
            profile_id: Some(profile),
        });
    }
    Ok(())
}

/// id, merchant, amount, posted_on, profile, is a refund.
type RecentRow = (i64, String, i64, String, i64, bool);

fn recent_rows(
    conn: &Connection,
    today: NaiveDate,
    condition: &str,
    bind: i64,
) -> Result<Vec<RecentRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.merchant, t.amount_cents, t.posted_on, t.profile_id, t.refund_of IS NOT NULL
         FROM transactions t WHERE t.posted_on >= ?1 AND t.posted_on <= ?2 AND t.parent_id IS NULL AND ({condition})
         ORDER BY t.posted_on, t.id"
    ))?;
    let rows = stmt
        .query_map(
            params![since(today, RECENT_DAYS), today.to_string(), bind],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

fn large_transactions(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    let condition = format!("{REGULAR} AND -t.amount_cents >= ?3");
    for (id, merchant, cents, posted, profile, _) in
        recent_rows(conn, today, &condition, config.large_cents)?
    {
        let on = NaiveDate::parse_from_str(&posted, "%Y-%m-%d")
            .map(day)
            .unwrap_or(posted);
        out.push(NewNotification {
            key: format!("large:{id}"),
            kind: Kind::LargeTransaction,
            title: "Large transaction".into(),
            body: format!("{} at {} on {on}", money(-cents), title_case(&merchant)),
            target: json!({ "kind": "transaction", "id": id }),
            profile_id: Some(profile),
        });
    }
    Ok(())
}

fn money_in(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    let condition = "t.amount_cents > 0 AND t.amount_cents >= ?3 AND (t.type = 'income' OR t.refund_of IS NOT NULL)";
    for (id, merchant, cents, _, profile, is_refund) in
        recent_rows(conn, today, condition, config.money_in_min_cents)?
    {
        let (wanted, title) = if is_refund {
            (config.money_in_refunds, "Refund received")
        } else {
            (config.money_in_paychecks, "Paycheck arrived")
        };
        if !wanted {
            continue;
        }
        out.push(NewNotification {
            key: format!("in:{id}"),
            kind: Kind::MoneyIn,
            title: title.into(),
            body: format!("{} from {}", money(cents), title_case(&merchant)),
            target: json!({ "kind": "transaction", "id": id }),
            profile_id: Some(profile),
        });
    }
    Ok(())
}

/// One item per import that still has open possible-duplicate flags.
fn possible_duplicates(conn: &Connection, out: &mut Vec<NewNotification>) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT f.import_id, i.file_name, count(*), min(t.profile_id) FROM duplicate_flags f
         JOIN imports i ON i.id = f.import_id JOIN transactions t ON t.id = f.tx_id
         WHERE f.resolution IS NULL GROUP BY f.import_id ORDER BY f.import_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    for row in rows {
        let (import_id, file, n, profile) = row?;
        let what = if n == 1 {
            "1 possible duplicate".to_string()
        } else {
            format!("{n} possible duplicates")
        };
        out.push(NewNotification {
            key: format!("duplicates:{import_id}"),
            kind: Kind::PossibleDuplicates,
            title: format!("{what} from {file}"),
            body: "They look like transactions you already had, and are tagged Possible duplicate to review."
                .into(),
            target: json!({ "kind": "transactions", "filter": "duplicates" }),
            profile_id: Some(profile),
        });
    }
    Ok(())
}

fn month_bounds(any_day: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = any_day.with_day(1).unwrap_or(any_day);
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    }
    .unwrap_or(first);
    (first, next - Duration::days(1))
}

/// Net regular spending per category between two days (inclusive), in positive cents.
fn spending_by_category(
    conn: &Connection,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.category_id, -sum(t.amount_cents) FROM transactions t
         WHERE {REGULAR} AND t.category_id IS NOT NULL AND t.posted_on >= ?1 AND t.posted_on <= ?2
           AND t.category_id NOT IN (SELECT id FROM categories WHERE excluded = 1)
         GROUP BY t.category_id"
    ))?;
    let rows = stmt
        .query_map(params![from.to_string(), to.to_string()], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

/// The part of each category's spending that came from saved recurring bills.
fn bill_spending_by_category(
    conn: &Connection,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.category_id, -sum(t.amount_cents) FROM transactions t
         WHERE {REGULAR} AND t.recurring_id IS NOT NULL AND t.category_id IS NOT NULL
           AND t.posted_on >= ?1 AND t.posted_on <= ?2
         GROUP BY t.category_id"
    ))?;
    let rows = stmt
        .query_map(params![from.to_string(), to.to_string()], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

fn category_names(conn: &Connection) -> Result<std::collections::HashMap<i64, String>> {
    Ok(categories::list(conn)?
        .into_iter()
        .map(|c| (c.id, c.name))
        .collect())
}

/// Over budget (at the warn percent) or, after the first week, on pace to overspend, per budgeted category.
fn budgets(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    let (first, last) = month_bounds(today);
    let ym = today.format("%Y-%m").to_string();
    let month_name = today.format("%B").to_string();
    let bills: std::collections::HashMap<i64, i64> = bill_spending_by_category(conn, first, today)?
        .into_iter()
        .collect();
    let spent: std::collections::HashMap<i64, i64> = spending_by_category(conn, first, today)?
        .into_iter()
        .collect();
    let names = category_names(conn)?;
    for (cat, budget) in plan::effective_budgets(conn, &ym)? {
        if budget <= 0 {
            continue;
        }
        let s = spent.get(&cat).copied().unwrap_or(0);
        let name = names
            .get(&cat)
            .cloned()
            .unwrap_or_else(|| "A category".into());
        let target = json!({ "kind": "category", "id": cat, "month": ym });
        let body = format!("{} of {} spent in {month_name}", money(s), money(budget));
        if s > budget {
            out.push(NewNotification {
                key: format!("over:{cat}:{ym}"),
                kind: Kind::OverBudget,
                title: format!("{name} is over budget"),
                body,
                target,
                profile_id: None,
            });
        } else if config.budget_warn_percent < 100 && s * 100 >= budget * config.budget_warn_percent
        {
            out.push(NewNotification {
                key: format!("near:{cat}:{ym}"),
                kind: Kind::OverBudget,
                title: format!("{name} has used {}% of its budget", s * 100 / budget),
                body,
                target,
                profile_id: None,
            });
        } else if s < budget && config.budget_on_pace && today.day() >= 8 {
            // Bills are paid once a month: count them as they are and project only everyday spending.
            let billed = bills.get(&cat).copied().unwrap_or(0).min(s);
            let pace = billed + (s - billed) * i64::from(last.day()) / i64::from(today.day());
            if pace > budget {
                out.push(NewNotification {
                    key: format!("pace:{cat}:{ym}"),
                    kind: Kind::OverBudget,
                    title: format!("{name} is on pace to overspend"),
                    body: format!(
                        "On pace for {} of {} in {month_name}",
                        money(pace),
                        money(budget)
                    ),
                    target,
                    profile_id: None,
                });
            }
        }
    }
    Ok(())
}

/// On days 1 to 3: last month's spending against its budget, and the top category.
fn recap(conn: &Connection, today: NaiveDate, out: &mut Vec<NewNotification>) -> Result<()> {
    if today.day() > 3 {
        return Ok(());
    }
    let (first, last) = month_bounds(today.with_day(1).unwrap_or(today) - Duration::days(1));
    let ym = first.format("%Y-%m").to_string();
    let spent = spending_by_category(conn, first, last)?;
    let total: i64 = spent.iter().map(|(_, c)| c).sum();
    if total <= 0 {
        return Ok(());
    }
    let budget: i64 = plan::effective_budgets(conn, &ym)?
        .iter()
        .map(|(_, b)| b)
        .sum();
    let names = category_names(conn)?;
    let top = spent
        .iter()
        .max_by_key(|(_, c)| *c)
        .and_then(|(id, _)| names.get(id).cloned());
    let mut body = if budget > 0 {
        let diff = budget - total;
        let how = if diff >= 0 {
            format!("{} under", money(diff))
        } else {
            format!("{} over", money(-diff))
        };
        format!(
            "Spent {} of {} budgeted ({how}).",
            money(total),
            money(budget)
        )
    } else {
        format!("Spent {}.", money(total))
    };
    if let Some(top) = top {
        body.push_str(&format!(" Top category: {top}."));
    }
    out.push(NewNotification {
        key: format!("recap:{ym}"),
        kind: Kind::MonthlyRecap,
        title: format!("Your {} recap", first.format("%B")),
        body,
        target: json!({ "kind": "category", "id": null, "month": ym }),
        profile_id: None,
    });
    Ok(())
}

/// On the chosen weekday, when enough transactions wait for review.
fn review_digest(
    conn: &Connection,
    config: &Config,
    today: NaiveDate,
    out: &mut Vec<NewNotification>,
) -> Result<()> {
    if i64::from(today.weekday().num_days_from_sunday()) != config.digest_weekday {
        return Ok(());
    }
    let waiting: i64 = conn.query_row(
        "SELECT count(*) FROM transactions WHERE reviewed = 0 AND parent_id IS NULL",
        [],
        |r| r.get(0),
    )?;
    if waiting < config.digest_min {
        return Ok(());
    }
    out.push(NewNotification {
        key: format!("digest:{today}"),
        kind: Kind::ReviewDigest,
        title: format!("{waiting} transactions to review"),
        body: "A quick review keeps your categories and budgets accurate.".into(),
        target: json!({ "kind": "transactions", "filter": "review" }),
        profile_id: None,
    });
    Ok(())
}
