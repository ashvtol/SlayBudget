//! Foreign-exchange rates and conversion.
//!
//! Rates are stored as "units of `quote` per 1 unit of `base`" on a date. The
//! app converts each transaction at the rate in effect on (or most recently
//! before) its date, so historical spend keeps its period-accurate value.

use crate::error::{CoreError, Result};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FxRate {
    pub base: String,
    pub quote: String,
    pub as_of: NaiveDate,
    pub rate: f64,
}

/// Insert or update one daily rate.
pub fn upsert(
    conn: &Connection,
    base: &str,
    quote: &str,
    as_of: NaiveDate,
    rate: f64,
) -> Result<()> {
    if rate <= 0.0 {
        return Err(CoreError::Invalid("fx rate must be positive".into()));
    }
    conn.execute(
        "INSERT INTO fx_rates (base, quote, as_of, rate) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (base, quote, as_of) DO UPDATE SET rate = excluded.rate",
        params![base, quote, as_of.to_string(), rate],
    )?;
    Ok(())
}

/// Insert many rates in one transaction.
pub fn upsert_many(conn: &mut Connection, rates: &[FxRate]) -> Result<usize> {
    let tx = conn.transaction()?;
    for r in rates {
        if r.rate <= 0.0 {
            continue;
        }
        tx.execute(
            "INSERT INTO fx_rates (base, quote, as_of, rate) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (base, quote, as_of) DO UPDATE SET rate = excluded.rate",
            params![r.base, r.quote, r.as_of.to_string(), r.rate],
        )?;
    }
    let n = rates.iter().filter(|r| r.rate > 0.0).count();
    tx.commit()?;
    Ok(n)
}

/// The rate for `base`→`quote` on or most recently before `on`.
pub fn rate_on(conn: &Connection, base: &str, quote: &str, on: NaiveDate) -> Result<Option<f64>> {
    if base == quote {
        return Ok(Some(1.0));
    }
    let direct: Option<f64> = conn
        .query_row(
            "SELECT rate FROM fx_rates WHERE base = ?1 AND quote = ?2 AND as_of <= ?3
             ORDER BY as_of DESC LIMIT 1",
            params![base, quote, on.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(r) = direct {
        return Ok(Some(r));
    }
    // Fall back to the inverse pair if only the other direction is stored.
    let inverse: Option<f64> = conn
        .query_row(
            "SELECT rate FROM fx_rates WHERE base = ?1 AND quote = ?2 AND as_of <= ?3
             ORDER BY as_of DESC LIMIT 1",
            params![quote, base, on.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(inverse.map(|r| 1.0 / r))
}

/// The most recent stored rate for `base`→`quote`, regardless of date.
pub fn latest(conn: &Connection, base: &str, quote: &str) -> Result<Option<f64>> {
    if base == quote {
        return Ok(Some(1.0));
    }
    Ok(conn
        .query_row(
            "SELECT rate FROM fx_rates WHERE base = ?1 AND quote = ?2 ORDER BY as_of DESC LIMIT 1",
            params![base, quote],
            |r| r.get(0),
        )
        .optional()?)
}

/// Average rate across a calendar month (`YYYY-MM`), or None if none stored.
pub fn month_average(
    conn: &Connection,
    base: &str,
    quote: &str,
    year_month: &str,
) -> Result<Option<f64>> {
    if base == quote {
        return Ok(Some(1.0));
    }
    let avg: Option<f64> = conn.query_row(
        "SELECT AVG(rate) FROM fx_rates WHERE base = ?1 AND quote = ?2 AND substr(as_of, 1, 7) = ?3",
        params![base, quote, year_month],
        |r| r.get(0),
    )?;
    Ok(avg)
}

/// Convert integer cents from `base` to `quote` at the rate in effect on `on`.
/// Returns None when no rate is available (caller shows the original amount).
pub fn convert_cents(
    conn: &Connection,
    cents: i64,
    base: &str,
    quote: &str,
    on: NaiveDate,
) -> Result<Option<i64>> {
    Ok(rate_on(conn, base, quote, on)?.map(|rate| (cents as f64 * rate).round() as i64))
}
