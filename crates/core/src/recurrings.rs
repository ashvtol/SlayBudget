//! Saved recurring bills (Copilot's Recurrings): rules that claim matching charges, with a status.
//! Detection (`analytics::recurring::detect`) seeds them once and then only feeds Suggestions.

use crate::analytics::recurring::{self, Cadence, Recurring};
use crate::categorize::rules::normalize_description;
use crate::error::{CoreError, Result};
use crate::profiles::ProfileId;
use crate::settings;
use crate::transactions::{self, TransactionId};
use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    /// The merchant key equals the pattern.
    Merchant,
    /// The normalized description contains the pattern.
    Contains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Active,
    Paused,
    Archived,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Active => "active",
            Status::Paused => "paused",
            Status::Archived => "archived",
        }
    }
    fn parse(s: &str) -> Status {
        match s {
            "paused" => Status::Paused,
            "archived" => Status::Archived,
            _ => Status::Active,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRecurring {
    pub name: String,
    pub category_id: Option<i64>,
    pub match_kind: MatchKind,
    pub pattern: String,
    /// Bounds on the charge's size (positive cents).
    pub min_cents: i64,
    pub max_cents: i64,
    pub frequency: Cadence,
    /// Expected day of the month (±3 days); `None` = any day.
    pub day_of_month: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecurring {
    pub id: i64,
    pub name: String,
    pub category_id: Option<i64>,
    pub match_kind: MatchKind,
    pub pattern: String,
    pub min_cents: i64,
    pub max_cents: i64,
    pub frequency: Cadence,
    pub day_of_month: Option<u32>,
    pub status: Status,
    /// "YYYY-MM-DD".
    pub created_on: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReport {
    pub added: usize,
    pub removed: usize,
}

const DAY_WINDOW: i64 = 3;
const SEEDED_KEY: &str = "recurrings_seeded";

fn validate(r: &NewRecurring) -> Result<()> {
    if r.name.trim().is_empty() {
        return Err(CoreError::Invalid("a recurring needs a name".into()));
    }
    if normalize_description(&r.pattern).is_empty() {
        return Err(CoreError::Invalid(
            "a recurring needs a name to match".into(),
        ));
    }
    if r.min_cents < 0 || r.max_cents < r.min_cents {
        return Err(CoreError::Invalid("the amount range is not valid".into()));
    }
    if r.day_of_month.is_some_and(|d| !(1..=31).contains(&d)) {
        return Err(CoreError::Invalid(
            "the day of the month must be 1 to 31".into(),
        ));
    }
    Ok(())
}

fn row_to_saved(r: &rusqlite::Row<'_>) -> rusqlite::Result<SavedRecurring> {
    let kind: String = r.get(3)?;
    let freq: String = r.get(7)?;
    let status: String = r.get(9)?;
    let created: String = r.get(10)?;
    let years: u32 = r.get(11)?;
    Ok(SavedRecurring {
        id: r.get(0)?,
        name: r.get(1)?,
        category_id: r.get(2)?,
        match_kind: if kind == "contains" {
            MatchKind::Contains
        } else {
            MatchKind::Merchant
        },
        pattern: r.get(4)?,
        min_cents: r.get(5)?,
        max_cents: r.get(6)?,
        frequency: Cadence::from_stored(&freq, years),
        day_of_month: r.get(8)?,
        status: Status::parse(&status),
        created_on: created.get(..10).unwrap_or(&created).to_string(),
    })
}

const COLS: &str = "id, name, category_id, match_kind, pattern, min_cents, max_cents, frequency, day_of_month, status, created_at, every_years";

pub fn list(conn: &Connection) -> Result<Vec<SavedRecurring>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM recurrings ORDER BY id"))?;
    let rows = stmt.query_map([], row_to_saved)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<SavedRecurring> {
    conn.query_row(
        &format!("SELECT {COLS} FROM recurrings WHERE id = ?1"),
        [id],
        row_to_saved,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("recurring {id}")))
}

/// A charge the rules can look at.
pub(crate) struct Candidate {
    pub(crate) id: TransactionId,
    pub(crate) merchant: String,
    pub(crate) description: String,
    pub(crate) amount_cents: i64,
    pub(crate) posted_on: NaiveDate,
    pub(crate) recurring_id: Option<i64>,
}

/// Regular top-level charges not opted out, optionally limited to some ids.
pub(crate) fn candidates(
    conn: &Connection,
    only: Option<&[TransactionId]>,
) -> Result<Vec<Candidate>> {
    let mut sql = "SELECT id, merchant, description, amount_cents, posted_on, recurring_id FROM transactions
         WHERE parent_id IS NULL AND type = 'regular' AND amount_cents < 0 AND recurring_optout = 0"
        .to_string();
    if let Some(ids) = only {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        sql.push_str(&format!(
            " AND id IN ({})",
            ids.iter()
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(",")
        ));
    }
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        let date: String = r.get(4)?;
        Ok(Candidate {
            id: r.get(0)?,
            merchant: r.get(1)?,
            description: r.get(2)?,
            amount_cents: r.get(3)?,
            posted_on: NaiveDate::parse_from_str(&date, "%Y-%m-%d").unwrap_or_default(),
            recurring_id: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// A charge whose name fits a bill's rule (merchant, or "contains"), whatever its amount and day.
pub(crate) fn name_fits(s: &SavedRecurring, c: &Candidate) -> bool {
    match s.match_kind {
        MatchKind::Merchant => c.merchant.trim().to_lowercase() == s.pattern.trim().to_lowercase(),
        MatchKind::Contains => {
            normalize_description(&c.description).contains(&normalize_description(&s.pattern))
        }
    }
}

fn fits(r: &NewRecurring, c: &Candidate) -> bool {
    let size = -c.amount_cents;
    if size < r.min_cents || size > r.max_cents {
        return false;
    }
    let pattern = normalize_description(&r.pattern);
    let name_ok = match r.match_kind {
        MatchKind::Merchant => c.merchant.trim().to_lowercase() == r.pattern.trim().to_lowercase(),
        MatchKind::Contains => normalize_description(&c.description).contains(&pattern),
    };
    if !name_ok {
        return false;
    }
    match r.day_of_month {
        None => true,
        Some(day) => days_from_due(c.posted_on, day) <= DAY_WINDOW,
    }
}

/// Days between `date` and the nearest due date (this, last or next month), with the due day
/// clamped to each month's length (a bill due on the 30th is due Feb 28).
fn days_from_due(date: NaiveDate, day: u32) -> i64 {
    use crate::analytics::aggregate::{add_months, sub_months};
    let first = date.with_day(1).unwrap_or(date);
    [sub_months(first, 1), first, add_months(first, 1)]
        .iter()
        .filter_map(|m| {
            let last = add_months(*m, 1).pred_opt()?.day();
            m.with_day(day.min(last))
        })
        .map(|due| (date - due).num_days().abs())
        .min()
        .unwrap_or(i64::MAX)
}

/// The due date after the one `last` paid. With a due day, a charge pays the nearest due date
/// (a bill due on the 1st paid on Oct 30 covers Nov 1), so the next one is a period after that;
/// without one, a period after the charge.
fn next_due(s: &SavedRecurring, last: NaiveDate) -> NaiveDate {
    use crate::analytics::aggregate::{add_months, sub_months};
    let Some(day) = s.day_of_month else {
        return s.frequency.next_after(last);
    };
    if matches!(s.frequency, Cadence::Weekly | Cadence::Biweekly) {
        return s.frequency.next_after(last);
    }
    let first = last.with_day(1).unwrap_or(last);
    let due_in = |month: NaiveDate| {
        let days = add_months(month, 1)
            .pred_opt()
            .map(|d| d.day())
            .unwrap_or(28);
        month.with_day(day.min(days)).unwrap_or(month)
    };
    let paid = [sub_months(first, 1), first, add_months(first, 1)]
        .into_iter()
        .map(due_in)
        .min_by_key(|due| (last - *due).num_days().abs())
        .unwrap_or(last);
    let next = s.frequency.next_after(paid);
    due_in(next.with_day(1).unwrap_or(next))
}

fn rule_of(s: &SavedRecurring) -> NewRecurring {
    NewRecurring {
        name: s.name.clone(),
        category_id: s.category_id,
        match_kind: s.match_kind,
        pattern: s.pattern.clone(),
        min_cents: s.min_cents,
        max_cents: s.max_cents,
        frequency: s.frequency,
        day_of_month: s.day_of_month,
    }
}

/// How many unlinked charges a rule would claim.
pub fn preview_count(conn: &Connection, r: &NewRecurring) -> Result<i64> {
    Ok(candidates(conn, None)?
        .iter()
        .filter(|c| c.recurring_id.is_none() && fits(r, c))
        .count() as i64)
}

/// Re-apply a recurring's rules to past charges: unlink what no longer fits, link unclaimed fits. Charges from before
/// the bill's last price change keep their link while the name still fits (they were the old price).
pub fn rematch(conn: &Connection, id: i64) -> Result<MatchReport> {
    let saved = get(conn, id)?;
    let rule = rule_of(&saved);
    let changed = last_price_change(conn, id)?;
    let all = candidates(conn, None)?;
    let before: BTreeSet<TransactionId> = all
        .iter()
        .filter(|c| c.recurring_id == Some(id))
        .map(|c| c.id)
        .collect();
    let after: BTreeSet<TransactionId> = all
        .iter()
        .filter(|c| {
            let old_price = c.recurring_id == Some(id)
                && changed
                    .as_ref()
                    .is_some_and(|d| c.posted_on.to_string() < *d)
                && name_fits(&saved, c);
            old_price
                || ((c.recurring_id.is_none() || c.recurring_id == Some(id)) && fits(&rule, c))
        })
        .map(|c| c.id)
        .collect();
    crate::db::atomically(conn, |tx| {
        for gone in before.difference(&after) {
            tx.execute(
                "UPDATE transactions SET recurring_id = NULL WHERE id = ?1",
                [gone],
            )?;
        }
        for new in after.difference(&before) {
            tx.execute(
                "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
                params![id, new],
            )?;
        }
        Ok(())
    })?;
    Ok(MatchReport {
        added: after.difference(&before).count(),
        removed: before.difference(&after).count(),
    })
}

pub fn create(conn: &Connection, r: &NewRecurring) -> Result<i64> {
    validate(r)?;
    conn.execute(
        "INSERT INTO recurrings (name, category_id, match_kind, pattern, min_cents, max_cents, frequency, day_of_month, every_years)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            r.name.trim(),
            r.category_id,
            match r.match_kind { MatchKind::Merchant => "merchant", MatchKind::Contains => "contains" },
            r.pattern.trim().to_lowercase(),
            r.min_cents,
            r.max_cents,
            r.frequency.stored().0,
            r.day_of_month,
            r.frequency.stored().1
        ],
    )?;
    let id = conn.last_insert_rowid();
    rematch(conn, id)?;
    Ok(id)
}

pub fn update(conn: &Connection, id: i64, r: &NewRecurring) -> Result<MatchReport> {
    validate(r)?;
    let n = conn.execute(
        "UPDATE recurrings SET name = ?1, category_id = ?2, match_kind = ?3, pattern = ?4, min_cents = ?5,
            max_cents = ?6, frequency = ?7, day_of_month = ?8, every_years = ?10 WHERE id = ?9",
        params![
            r.name.trim(),
            r.category_id,
            match r.match_kind { MatchKind::Merchant => "merchant", MatchKind::Contains => "contains" },
            r.pattern.trim().to_lowercase(),
            r.min_cents,
            r.max_cents,
            r.frequency.stored().0,
            r.day_of_month,
            id,
            r.frequency.stored().1
        ],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("recurring {id}")));
    }
    rematch(conn, id)
}

pub fn set_status(conn: &Connection, id: i64, status: Status) -> Result<()> {
    conn.execute(
        "UPDATE recurrings SET status = ?1 WHERE id = ?2",
        params![status.as_str(), id],
    )?;
    Ok(())
}

/// Remove a recurring; its transactions keep everything but the link.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    crate::db::atomically(conn, |tx| {
        tx.execute(
            "UPDATE transactions SET recurring_id = NULL WHERE recurring_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM recurrings WHERE id = ?1", [id])?;
        Ok(())
    })
}

/// "Not recurring": unlink a charge so no rule claims it again.
pub fn unlink(conn: &Connection, tx_id: TransactionId) -> Result<()> {
    conn.execute(
        "UPDATE transactions SET recurring_id = NULL, recurring_optout = 1 WHERE id = ?1",
        [tx_id],
    )?;
    Ok(())
}

/// Link newly imported charges to the first fitting active or paused recurring; a payment to a
/// paused recurring makes it active again.
pub fn match_new(conn: &Connection, tx_ids: &[TransactionId]) -> Result<usize> {
    let saved: Vec<SavedRecurring> = list(conn)?
        .into_iter()
        .filter(|s| s.status != Status::Archived)
        .collect();
    let mut linked = 0;
    for c in candidates(conn, Some(tx_ids))?
        .into_iter()
        .filter(|c| c.recurring_id.is_none())
    {
        if let Some(s) = saved.iter().find(|s| fits(&rule_of(s), &c)) {
            conn.execute(
                "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
                params![s.id, c.id],
            )?;
            if s.status == Status::Paused {
                set_status(conn, s.id, Status::Active)?;
            }
            linked += 1;
        }
    }
    Ok(linked)
}

fn title_case(key: &str) -> String {
    key.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The amount range a bill at this price claims: about ±35%, at least $5 either way.
pub(crate) fn band_around(cents: i64) -> (i64, i64) {
    let band = (cents / 100 * 35).max(500);
    ((cents - band).max(0), cents + band)
}

/// When the bill's price last changed ("YYYY-MM-DD"), if it ever did.
pub(crate) fn last_price_change(conn: &Connection, id: i64) -> Result<Option<String>> {
    Ok(conn.query_row(
        "SELECT MAX(changed_on) FROM recurring_prices WHERE recurring_id = ?1",
        [id],
        |r| r.get(0),
    )?)
}

pub(crate) fn day_for(cadence: Cadence, date: NaiveDate) -> Option<u32> {
    match cadence {
        Cadence::Weekly | Cadence::Biweekly => None,
        _ => Some(date.day()),
    }
}

fn from_detected(r: &Recurring) -> NewRecurring {
    let (min_cents, max_cents) = band_around(r.typical_amount_cents);
    NewRecurring {
        name: title_case(&r.merchant),
        category_id: r.category_id,
        match_kind: MatchKind::Merchant,
        pattern: r.merchant.clone(),
        min_cents,
        max_cents,
        frequency: r.cadence,
        day_of_month: day_for(r.cadence, r.last_date),
    }
}

/// Save today's detected bills as recurrings, once per database. Returns how many were saved.
pub fn seed_if_needed(conn: &Connection) -> Result<usize> {
    if settings::get(conn, SEEDED_KEY)?.is_some() {
        return Ok(0);
    }
    // Nothing imported yet: wait, so the first import or migration seeds.
    let any: i64 = conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))?;
    if any == 0 {
        return Ok(0);
    }
    // All bills, their links and the "seeded" flag land together, or none of them do.
    crate::db::atomically(conn, seed_all)
}

fn seed_all(conn: &Connection) -> Result<usize> {
    let covered = covered_merchants(conn)?;
    let detected: Vec<Recurring> = recurring::detect_for(conn, None)?
        .into_iter()
        .filter(|r| !covered.contains(&r.merchant))
        .collect();
    let mut saved = 0;
    for r in &detected {
        let rule = from_detected(r);
        let Ok(id) = create(conn, &rule) else {
            continue; // a merchant key that can't make a valid rule is left to Suggestions
        };
        saved += 1;
        // A bill whose charges wander around the month keeps "any day", or it would claim too few.
        let linked: usize = conn.query_row(
            "SELECT count(*) FROM transactions WHERE recurring_id = ?1",
            [id],
            |row| row.get::<_, i64>(0),
        )? as usize;
        if rule.day_of_month.is_some() && (linked as f64) < (r.occurrences as f64) * 0.8 {
            update(
                conn,
                id,
                &NewRecurring {
                    day_of_month: None,
                    ..rule
                },
            )?;
        }
    }
    settings::set(conn, SEEDED_KEY, "1")?;
    Ok(saved)
}

/// After a bulk import: seed if this is the first data, else link unlinked charges to bills.
pub fn after_import(conn: &Connection) -> Result<()> {
    if seed_if_needed(conn)? > 0 {
        return Ok(());
    }
    let ids: Vec<TransactionId> = candidates(conn, None)?
        .into_iter()
        .filter(|c| c.recurring_id.is_none())
        .map(|c| c.id)
        .collect();
    match_new(conn, &ids)?;
    crate::price_changes::detect(conn)?;
    Ok(())
}

/// Merchants a saved bill already covers (by pattern or linked charges), or that were dismissed.
fn covered_merchants(conn: &Connection) -> Result<HashSet<String>> {
    let covered: HashSet<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT merchant FROM transactions WHERE recurring_id IS NOT NULL
             UNION SELECT pattern FROM recurrings WHERE match_kind = 'merchant'
             UNION SELECT merchant FROM recurring_dismissals",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    Ok(covered)
}

/// Detected series that no saved recurring covers and that weren't dismissed.
pub fn suggestions(conn: &Connection, profile_id: Option<ProfileId>) -> Result<Vec<Recurring>> {
    let covered = covered_merchants(conn)?;
    Ok(recurring::detect_for(conn, profile_id)?
        .into_iter()
        .filter(|r| !covered.contains(&r.merchant))
        .collect())
}

pub fn dismiss(conn: &Connection, merchant: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO recurring_dismissals (merchant) VALUES (?1)",
        [merchant.trim().to_lowercase()],
    )?;
    Ok(())
}

fn median(mut xs: Vec<i64>) -> i64 {
    xs.sort_unstable();
    let n = xs.len();
    match n {
        0 => 0,
        _ if n % 2 == 1 => xs[n / 2],
        _ => (xs[n / 2 - 1] + xs[n / 2]) / 2,
    }
}

/// Each saved recurring as the Recurrings screen's view, built from its linked charges.
pub fn views(conn: &Connection, profile_id: Option<ProfileId>) -> Result<Vec<Recurring>> {
    let mut out = Vec::new();
    for s in list(conn)? {
        let mut stmt = conn.prepare(
            "SELECT posted_on, amount_cents, category_id FROM transactions
             WHERE recurring_id = ?1 AND (?2 IS NULL OR profile_id = ?2) ORDER BY posted_on, id",
        )?;
        let charges: Vec<(String, i64, Option<i64>)> = stmt
            .query_map(params![s.id, profile_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<std::result::Result<_, _>>()?;
        // A profile sees only bills it pays.
        if profile_id.is_some() && charges.is_empty() {
            continue;
        }
        let last_date = charges
            .last()
            .and_then(|(d, _, _)| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            .or_else(|| NaiveDate::parse_from_str(&s.created_on, "%Y-%m-%d").ok())
            .unwrap_or_default();
        // After a price change, the bill costs what it has charged since.
        let since = last_price_change(conn, s.id)?.unwrap_or_default();
        let current: Vec<i64> = charges
            .iter()
            .filter(|(d, _, _)| *d >= since)
            .map(|(_, a, _)| -a)
            .collect();
        let typical = if current.is_empty() {
            (s.min_cents + s.max_cents) / 2
        } else {
            median(current)
        };
        let category_id = s
            .category_id
            .or_else(|| charges.iter().rev().find_map(|(_, _, c)| *c));
        out.push(Recurring {
            merchant: if s.match_kind == MatchKind::Merchant {
                s.pattern.clone()
            } else {
                s.name.to_lowercase()
            },
            category_id,
            typical_amount_cents: typical,
            cadence: s.frequency,
            last_date,
            next_date: next_due(&s, last_date),
            occurrences: charges.len(),
            saved: Some(s),
        });
    }
    out.sort_by(|a, b| {
        a.next_date
            .cmp(&b.next_date)
            .then(a.merchant.cmp(&b.merchant))
    });
    Ok(out)
}

/// A prefilled form for "Make recurring" on a transaction.
pub fn draft_from_transaction(conn: &Connection, tx_id: TransactionId) -> Result<NewRecurring> {
    let t = transactions::get(conn, tx_id)?;
    let size = t.amount_cents.abs();
    let same: Vec<transactions::Transaction> = transactions::list(conn, &Default::default())?
        .into_iter()
        .filter(|x| x.merchant == t.merchant)
        .collect();
    let frequency = recurring::detect(&same)
        .first()
        .map(|r| r.cadence)
        .unwrap_or(Cadence::Monthly);
    Ok(NewRecurring {
        name: title_case(&t.merchant),
        category_id: t.category_id,
        match_kind: MatchKind::Merchant,
        pattern: t.merchant.clone(),
        min_cents: (size as f64 * 0.8).round() as i64,
        max_cents: (size as f64 * 1.2).round() as i64,
        frequency,
        day_of_month: day_for(frequency, t.posted_on),
    })
}
