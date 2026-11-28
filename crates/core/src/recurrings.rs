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
    /// Other names it matches the same way (its statement name changed over time).
    #[serde(default)]
    pub also_matches: Vec<String>,
    /// Names of credits that pay it back; `None` = never decided, empty = not paid back.
    #[serde(default)]
    pub paid_back_by: Option<Vec<String>>,
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
    pub also_matches: Vec<String>,
    pub paid_back_by: Option<Vec<String>>,
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
    let also: String = r.get(12)?;
    let credits: Option<String> = r.get(13)?;
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
        also_matches: split_names(&also),
        paid_back_by: credits.as_deref().map(split_names),
    })
}

/// Names stored one per line.
fn split_names(s: &str) -> Vec<String> {
    s.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// Names cleaned for storing: trimmed, lowercased, no blanks or repeats, one per line.
pub(crate) fn join_names(names: &[String]) -> String {
    let mut out: Vec<String> = Vec::new();
    for n in names
        .iter()
        .map(|n| n.trim().to_lowercase())
        .filter(|n| !n.is_empty())
    {
        if !out.contains(&n) {
            out.push(n);
        }
    }
    out.join("\n")
}

const COLS: &str = "id, name, category_id, match_kind, pattern, min_cents, max_cents, frequency, day_of_month, status, created_at, every_years, also_names, credit_names";

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
    std::iter::once(&s.pattern)
        .chain(&s.also_matches)
        .any(|p| one_name_fits(s.match_kind, p, c))
}

fn one_name_fits(kind: MatchKind, pattern: &str, c: &Candidate) -> bool {
    match kind {
        MatchKind::Merchant => c.merchant.trim().to_lowercase() == pattern.trim().to_lowercase(),
        MatchKind::Contains => {
            normalize_description(&c.description).contains(&normalize_description(pattern))
        }
    }
}

fn fits(r: &NewRecurring, c: &Candidate) -> bool {
    let size = -c.amount_cents;
    if size < r.min_cents || size > r.max_cents {
        return false;
    }
    let name_ok = std::iter::once(&r.pattern)
        .chain(&r.also_matches)
        .any(|p| one_name_fits(r.match_kind, p, c));
    if !name_ok {
        return false;
    }
    match r.day_of_month {
        None => true,
        Some(day) => days_from_due(c.posted_on, day) <= DAY_WINDOW,
    }
}

/// Whether the charge is the bill's by who it's to. Always, except a payment app's charge (Venmo, Zelle, PayPal): one
/// of the bill's names that fits it has to name the person (a word other than the app's, like "sam"), because the
/// app's name alone is on a payment to anyone.
pub(crate) fn names_the_payee(
    names: impl IntoIterator<Item = (MatchKind, String)>,
    c: &Candidate,
) -> bool {
    use crate::categorize::merchant::is_payment_platform;
    if !is_payment_platform(&c.merchant) && !is_payment_platform(&c.description) {
        return true;
    }
    names.into_iter().any(|(kind, name)| {
        one_name_fits(kind, &name, c)
            && name.split(|ch: char| !ch.is_ascii_alphabetic()).any(|w| {
                w.len() >= 3
                    && !is_payment_platform(w)
                    && !["debit", "card", "purchase"].contains(&w)
            })
    })
}

fn rule_names(r: &NewRecurring) -> Vec<(MatchKind, String)> {
    std::iter::once(&r.pattern)
        .chain(&r.also_matches)
        .map(|n| (r.match_kind, n.to_lowercase()))
        .collect()
}

/// The rule but any day: a charge with the right name and amount, wherever it falls in the month. A payment app's charge
/// only when the bill names the person.
fn fits_any_day(r: &NewRecurring, c: &Candidate) -> bool {
    r.day_of_month.is_some()
        && names_the_payee(rule_names(r), c)
        && fits(
            &NewRecurring {
                day_of_month: None,
                ..r.clone()
            },
            c,
        )
}

/// The due date a charge pays: the nearest one (last, this or next month; the earlier on a tie).
fn due_paid(date: NaiveDate, day: u32) -> NaiveDate {
    use crate::analytics::aggregate::{add_months, sub_months};
    let first = date.with_day(1).unwrap_or(date);
    [sub_months(first, 1), first, add_months(first, 1)]
        .iter()
        .filter_map(|m| {
            let last = add_months(*m, 1).pred_opt()?.day();
            m.with_day(day.min(last))
        })
        .min_by_key(|due| ((date - *due).num_days().abs(), *due))
        .unwrap_or(date)
}

/// Whether two charges fall in the same billing period, so the bill already has its charge for `date`. A monthly bill
/// with a due day: they pay the same due date. Otherwise: within half a period of each other.
fn same_period(date: NaiveDate, other: NaiveDate, frequency: Cadence, day: Option<u32>) -> bool {
    if let (Cadence::Monthly, Some(d)) = (frequency, day) {
        return due_paid(date, d) == due_paid(other, d);
    }
    let start = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap_or_default();
    let half = (frequency.next_after(start) - start).num_days() / 2;
    (date - other).num_days().abs() < half
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
        also_matches: s.also_matches.clone(),
        paid_back_by: s.paid_back_by.clone(),
    }
}

/// How many unlinked charges a rule would claim.
pub fn preview_count(conn: &Connection, r: &NewRecurring) -> Result<i64> {
    Ok(preview_matches(conn, r)?.len() as i64)
}

/// The unlinked charges a rule would claim, oldest first.
pub fn preview_matches(conn: &Connection, r: &NewRecurring) -> Result<Vec<TransactionId>> {
    let mut fits_rule: Vec<Candidate> = candidates(conn, None)?
        .into_iter()
        .filter(|c| c.recurring_id.is_none() && fits(r, c))
        .collect();
    fits_rule.sort_by_key(|c| (c.posted_on, c.id));
    Ok(fits_rule.into_iter().map(|c| c.id).collect())
}

/// Create a bill, leaving out charges you unticked: they're marked "not recurring", so no bill claims them again.
pub fn create_except(
    conn: &Connection,
    r: &NewRecurring,
    exclude: &[TransactionId],
) -> Result<i64> {
    crate::db::atomically(conn, |c| {
        let id = create(c, r)?;
        for tx in exclude {
            unlink(c, *tx)?;
        }
        Ok(id)
    })
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
    let mut after: BTreeSet<TransactionId> = all
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
    // A charge off its usual day still belongs to the bill when that period has no other charge.
    let mut dates: Vec<NaiveDate> = all
        .iter()
        .filter(|c| after.contains(&c.id))
        .map(|c| c.posted_on)
        .collect();
    let mut off_day: Vec<&Candidate> = all
        .iter()
        .filter(|c| {
            !after.contains(&c.id)
                && (c.recurring_id.is_none() || c.recurring_id == Some(id))
                && fits_any_day(&rule, c)
        })
        .collect();
    off_day.sort_by_key(|c| (c.posted_on, c.id));
    for c in off_day {
        if !dates
            .iter()
            .any(|d| same_period(*d, c.posted_on, rule.frequency, rule.day_of_month))
        {
            after.insert(c.id);
            dates.push(c.posted_on);
        }
    }
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
        "INSERT INTO recurrings (name, category_id, match_kind, pattern, min_cents, max_cents, frequency, day_of_month, every_years,
            also_names, credit_names)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            r.name.trim(),
            r.category_id,
            match r.match_kind { MatchKind::Merchant => "merchant", MatchKind::Contains => "contains" },
            r.pattern.trim().to_lowercase(),
            r.min_cents,
            r.max_cents,
            r.frequency.stored().0,
            r.day_of_month,
            r.frequency.stored().1,
            join_names(&r.also_matches),
            r.paid_back_by.as_deref().map(join_names)
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
            max_cents = ?6, frequency = ?7, day_of_month = ?8, every_years = ?10, also_names = ?11,
            credit_names = ?12 WHERE id = ?9",
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
            r.frequency.stored().1,
            join_names(&r.also_matches),
            r.paid_back_by.as_deref().map(join_names)
        ],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("recurring {id}")));
    }
    rematch(conn, id)
}

/// After you recategorize charges: each of their bills takes its latest charge's category.
pub fn follow_charges(conn: &Connection, ids: &[TransactionId]) -> Result<()> {
    for id in ids {
        conn.execute(
            "UPDATE recurrings SET category_id = latest.category_id
             FROM (SELECT t.category_id FROM transactions t
                   WHERE t.recurring_id = (SELECT recurring_id FROM transactions WHERE id = ?1)
                   ORDER BY t.posted_on DESC, t.id DESC LIMIT 1) AS latest
             WHERE recurrings.id = (SELECT recurring_id FROM transactions WHERE id = ?1)
               AND latest.category_id IS NOT NULL",
            [id],
        )?;
    }
    Ok(())
}

/// Whether a charge is the bill's by who it's to (see `names_the_payee`).
pub(crate) fn payee_fits(s: &SavedRecurring, c: &Candidate) -> bool {
    names_the_payee(rule_names(&rule_of(s)), c)
}

/// Which credits pay a bill back (`None` = undecided, empty = not paid back). Its charges are left alone.
pub fn set_paid_back_by(conn: &Connection, id: i64, names: Option<Vec<String>>) -> Result<()> {
    let n = conn.execute(
        "UPDATE recurrings SET credit_names = ?1 WHERE id = ?2",
        params![names.as_deref().map(join_names), id],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("recurring {id}")));
    }
    Ok(())
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
    let mut fresh: Vec<Candidate> = candidates(conn, Some(tx_ids))?
        .into_iter()
        .filter(|c| c.recurring_id.is_none())
        .collect();
    fresh.sort_by_key(|c| (c.posted_on, c.id));
    // Each bill's charges so far, to tell whether a period already has one.
    let mut dates: std::collections::HashMap<i64, Vec<NaiveDate>> =
        std::collections::HashMap::new();
    for c in candidates(conn, None)? {
        if let Some(bill) = c.recurring_id {
            dates.entry(bill).or_default().push(c.posted_on);
        }
    }
    let mut linked = 0;
    let link =
        |conn: &Connection, s: &SavedRecurring, c: &Candidate, linked: &mut usize| -> Result<()> {
            conn.execute(
                "UPDATE transactions SET recurring_id = ?1 WHERE id = ?2",
                params![s.id, c.id],
            )?;
            if s.status == Status::Paused {
                set_status(conn, s.id, Status::Active)?;
            }
            *linked += 1;
            Ok(())
        };
    // Charges on the usual day first, so a one-off earlier in the month can't take the period.
    let mut taken: HashSet<TransactionId> = HashSet::new();
    for c in &fresh {
        if let Some(s) = saved.iter().find(|s| fits(&rule_of(s), c)) {
            link(conn, s, c, &mut linked)?;
            dates.entry(s.id).or_default().push(c.posted_on);
            taken.insert(c.id);
        }
    }
    for c in fresh.iter().filter(|c| !taken.contains(&c.id)) {
        let fits_off_day = |s: &&SavedRecurring| {
            fits_any_day(&rule_of(s), c)
                && !dates.get(&s.id).is_some_and(|ds| {
                    ds.iter()
                        .any(|d| same_period(*d, c.posted_on, s.frequency, s.day_of_month))
                })
        };
        if let Some(s) = saved.iter().find(fits_off_day) {
            link(conn, s, c, &mut linked)?;
            dates.entry(s.id).or_default().push(c.posted_on);
        }
    }
    Ok(linked)
}

/// Link every charge no bill has yet (after an import, and when the app opens, so better rules reach old charges).
pub fn link_unlinked(conn: &Connection) -> Result<usize> {
    let ids: Vec<TransactionId> = candidates(conn, None)?
        .into_iter()
        .filter(|c| c.recurring_id.is_none())
        .map(|c| c.id)
        .collect();
    match_new(conn, &ids)
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
        also_matches: Vec::new(),
        paid_back_by: None,
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
        // A bill whose charges wander around the month keeps "any day": most charges should be near its due day.
        let on_day = match rule.day_of_month {
            None => r.occurrences,
            Some(day) => {
                let mut stmt =
                    conn.prepare("SELECT posted_on FROM transactions WHERE recurring_id = ?1")?;
                let dates = stmt.query_map([id], |row| row.get::<_, String>(0))?;
                let mut n = 0;
                for d in dates {
                    let d = NaiveDate::parse_from_str(&d?, "%Y-%m-%d").unwrap_or_default();
                    if days_from_due(d, day) <= DAY_WINDOW {
                        n += 1;
                    }
                }
                n
            }
        };
        if rule.day_of_month.is_some() && (on_day as f64) < (r.occurrences as f64) * 0.8 {
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
    link_unlinked(conn)?;
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

/// Who a payment app's charge went to: the words after the app's name ("VENMO *SAM RIVERA 8555550100" gives "sam
/// rivera"), or None when the statement doesn't say or it isn't a payment app.
pub(crate) fn payee_of(description: &str) -> Option<String> {
    // Apps that pay people (not gas stations or wires, which the payment-app list also holds).
    const PERSON_APPS: [&str; 6] = [
        "venmo",
        "zelle",
        "paypal",
        "cashapp",
        "cash app",
        "apple cash",
    ];
    let lower = description.to_lowercase();
    let at = PERSON_APPS
        .iter()
        .filter_map(|p| lower.find(p).map(|i| i + p.len()))
        .min()?;
    let words: Vec<&str> = lower[at..]
        .split(|c: char| c.is_whitespace() || c == '*')
        .filter(|w| !w.is_empty() && !["to", "from", "payment", "inst", "xfer"].contains(w))
        .take_while(|w| {
            w.chars()
                .all(|c| c.is_ascii_alphabetic() || c == '.' || c == '\'')
        })
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
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
    // A payment app's charge can be to anyone: the bill matches the person it went to.
    let (name, match_kind, pattern) = match payee_of(&t.description) {
        Some(payee) => (title_case(&payee), MatchKind::Contains, payee),
        None => (
            title_case(&t.merchant),
            MatchKind::Merchant,
            t.merchant.clone(),
        ),
    };
    Ok(NewRecurring {
        name,
        category_id: t.category_id,
        match_kind,
        pattern,
        min_cents: (size as f64 * 0.8).round() as i64,
        max_cents: (size as f64 * 1.2).round() as i64,
        frequency,
        day_of_month: day_for(frequency, t.posted_on),
        also_matches: Vec::new(),
        paid_back_by: None,
    })
}
