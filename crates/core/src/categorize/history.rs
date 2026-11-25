//! Sorting history once after updating, and answering suggestions. The pass uses what you already taught: merchants
//! you categorized move their other rows, transfers between your accounts are paired, and the classifier fixes what
//! it is sure of (only once you have categorized something yourself) and suggests the rest.

use super::model::{self, Band};
use super::{learning, starter, transfers};
use crate::error::Result;
use crate::profiles::ProfileId;
use crate::settings;
use crate::transactions::{self, type_of_category_sql, TransactionId, TransactionPatch};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const DONE_KEY: &str = "smart_history_done";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReport {
    /// Rows that moved to a better category.
    pub moved: usize,
    /// Rows with a category to check.
    pub suggested: usize,
    /// Transfers between your accounts that were paired.
    pub transfers: usize,
}

/// Rows automatic changes may touch: top-level, not yours, not locked.
const OPEN: &str = "parent_id IS NULL AND category_locked = 0 AND category_source != 'user'";

const LEARNED_KEY: &str = "model_learned_yours";

/// Teach the classifier the starter list and every category you chose, once. Kept out of the undoable pass: undoing
/// what the pass moved must not make SlayBudget forget what it learned.
pub fn prepare(conn: &Connection) -> Result<()> {
    crate::db::atomically(conn, |c| {
        starter::seed(c)?;
        if settings::get(c, LEARNED_KEY)?.is_none() {
            learn_from_yours(c)?;
            settings::set(c, LEARNED_KEY, "1")?;
        }
        Ok(())
    })
}

/// The one-time pass; None when it already ran.
pub fn run_once(conn: &Connection) -> Result<Option<HistoryReport>> {
    if settings::get(conn, DONE_KEY)?.is_some() {
        return Ok(None);
    }
    crate::db::atomically(conn, |c| {
        let mut report = HistoryReport::default();
        prepare(c)?;
        let yours: i64 = c.query_row(
            "SELECT count(*) FROM transactions WHERE parent_id IS NULL AND category_source = 'user'",
            [],
            |r| r.get(0),
        )?;

        // Merchants you categorized: their other rows follow.
        for rule in learning::list(c)? {
            let name = crate::categories::get(c, rule.category_id)?.name;
            report.moved += c.execute(
                &format!(
                    "UPDATE transactions SET category_id = ?1, type = {ty}, category_source = 'learned', category_reason = ?3,
                        suggested_category_id = NULL, suggested_reason = NULL
                     WHERE {OPEN} AND merchant = ?2 AND category_id IS NOT ?1 AND transfer_pair_id IS NULL
                       AND (?4 IS NULL OR profile_id = ?4)",
                    ty = type_of_category_sql("?1")
                ),
                params![
                    rule.category_id,
                    rule.merchant,
                    format!("You put {} in {name}", model::title(&rule.merchant)),
                    rule.profile_id
                ],
            )?;
        }

        // Money moved between your own accounts.
        let window = crate::import::pipeline::transfer_window(c)?;
        for p in crate::profiles::list(c)? {
            let pairs = transfers::find_pairs(c, p.id, None, window)?;
            let (applied, suggested) = transfers::apply_pairs(c, &pairs)?;
            report.transfers += applied;
            report.suggested += suggested * 2;
        }

        // The classifier over the rest.
        let auto = yours > 0 && settings::get(c, "auto_categorize")?.as_deref() != Some("0");
        let mut stmt = c.prepare(&format!(
            "SELECT id, description, merchant, amount_cents, source_id, category_id FROM transactions
             WHERE {OPEN} AND category_source IN ('model', 'bank', 'keyword') AND transfer_pair_id IS NULL
               AND suggested_category_id IS NULL"
        ))?;
        type Row = (TransactionId, String, String, i64, i64, Option<i64>);
        let rows: Vec<Row> = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })?
            .collect::<std::result::Result<_, _>>()?;
        for (id, description, merchant, cents, source, current) in rows {
            let account = crate::accounts::account_kind(c, source)?;
            let f = model::features(&description, &merchant, cents, account);
            let Some(p) = model::classify(c, &merchant, &f)? else {
                continue;
            };
            if Some(p.category_id) == current {
                continue;
            }
            let reason = model::explain(c, &merchant, p.category_id)?;
            // Gas stations and payment apps differ payment to payment: never moved, only suggested.
            let platform =
                super::is_payment_platform(&merchant) || super::is_payment_platform(&description);
            match model::band(&p) {
                Band::Auto if auto && !platform => {
                    c.execute(
                        &format!(
                            "UPDATE transactions SET category_id = ?1, type = {ty}, category_source = 'model',
                                category_reason = ?2 WHERE id = ?3",
                            ty = type_of_category_sql("?1")
                        ),
                        params![p.category_id, reason, id],
                    )?;
                    report.moved += 1;
                }
                Band::None => {}
                // A guess that is not sure enough only helps where there is no category yet.
                _ if in_other(c, current)? => {
                    c.execute(
                        "UPDATE transactions SET suggested_category_id = ?1, suggested_reason = ?2 WHERE id = ?3",
                        params![p.category_id, reason, id],
                    )?;
                    report.suggested += 1;
                }
                _ => {}
            }
        }
        settings::set(c, DONE_KEY, "1")?;
        Ok(Some(report))
    })
}

/// No category, or Other.
pub(crate) fn in_other(conn: &Connection, category: Option<i64>) -> Result<bool> {
    let Some(id) = category else { return Ok(true) };
    Ok(conn
        .query_row(
            "SELECT legacy_name = 'Other' FROM categories WHERE id = ?1",
            [id],
            |r| r.get::<_, Option<bool>>(0),
        )
        .optional()?
        .flatten()
        .unwrap_or(false))
}

/// Teach the classifier every category you chose (weight 3). Returns how many rows.
fn learn_from_yours(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT description, merchant, amount_cents, source_id, category_id FROM transactions
         WHERE parent_id IS NULL AND category_source = 'user' AND category_id IS NOT NULL",
    )?;
    let rows: Vec<(String, String, i64, i64, i64)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<std::result::Result<_, _>>()?;
    for (description, merchant, cents, source, category) in &rows {
        let account = crate::accounts::account_kind(conn, *source)?;
        model::train(
            conn,
            &model::features(description, merchant, *cents, account),
            *category,
            3.0,
        )?;
    }
    Ok(rows.len())
}

/// The suggestion on a row and the other side of a suggested transfer, if any.
fn suggestion(
    conn: &Connection,
    id: TransactionId,
) -> Result<Option<(i64, Option<TransactionId>)>> {
    Ok(conn
        .query_row(
            "SELECT suggested_category_id, transfer_pair_id FROM transactions
             WHERE id = ?1 AND suggested_category_id IS NOT NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

fn features_of(conn: &Connection, id: TransactionId) -> Result<model::Features> {
    let t = transactions::get(conn, id)?;
    let account = crate::accounts::account_kind(conn, t.source_id)?;
    Ok(model::features(
        &t.description,
        &t.merchant,
        t.amount_cents,
        account,
    ))
}

/// Take the suggested category: the row becomes yours and the classifier learns it (weight 3). The other side of a
/// suggested transfer is accepted with it. Returns how many rows changed.
pub fn accept(conn: &Connection, ids: &[TransactionId]) -> Result<usize> {
    crate::db::atomically(conn, |c| {
        let mut done = 0;
        let mut queue: Vec<TransactionId> = ids.to_vec();
        while let Some(id) = queue.pop() {
            let Some((category, pair)) = suggestion(c, id)? else {
                continue;
            };
            transactions::update(
                c,
                id,
                &TransactionPatch {
                    category_id: Some(Some(category)),
                    reviewed: Some(true),
                    ..Default::default()
                },
            )?;
            model::train(c, &features_of(c, id)?, category, 3.0)?;
            done += 1;
            if let Some(other) = pair {
                queue.push(other);
            }
        }
        Ok(done)
    })
}

/// Keep the current category: the suggestion goes, the row becomes yours (so it is not suggested again), and the
/// classifier learns it was wrong. A suggested transfer is unlinked on both sides. Returns how many rows changed.
pub fn reject(conn: &Connection, ids: &[TransactionId]) -> Result<usize> {
    crate::db::atomically(conn, |c| {
        let mut done = 0;
        let mut queue: Vec<TransactionId> = ids.to_vec();
        while let Some(id) = queue.pop() {
            let Some((category, pair)) = suggestion(c, id)? else {
                continue;
            };
            c.execute(
                "UPDATE transactions SET suggested_category_id = NULL, suggested_reason = NULL, category_source = 'user',
                    reviewed = 1, transfer_pair_id = CASE WHEN ?2 IS NULL THEN transfer_pair_id ELSE NULL END
                 WHERE id = ?1",
                params![id, pair],
            )?;
            model::train(c, &features_of(c, id)?, category, -3.0)?;
            done += 1;
            if let Some(other) = pair {
                queue.push(other);
            }
        }
        Ok(done)
    })
}

/// Rows with a category to check, in one profile or all.
pub fn suggestion_count(conn: &Connection, profile_id: Option<ProfileId>) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM transactions WHERE parent_id IS NULL AND suggested_category_id IS NOT NULL
           AND (?1 IS NULL OR profile_id = ?1)",
        [profile_id],
        |r| r.get(0),
    )?)
}

/// Forget what SlayBudget learned: the merchants and the classifier, then the starter list again.
pub fn reset_learning(conn: &Connection) -> Result<()> {
    crate::db::atomically(conn, |c| {
        learning::reset(c)?;
        model::reset(c)?;
        c.execute("DELETE FROM settings WHERE key = 'starter_seeded'", [])?;
        starter::seed(c)?;
        Ok(())
    })
}
