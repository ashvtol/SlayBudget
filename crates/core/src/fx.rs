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

/// The built-in monthly average rates (the European Central Bank's, units of each currency per euro), so the app never
/// goes online for rates. `scripts/fx-rates.ts` refreshes `data/fx-monthly.csv` when a release is cut.
pub struct BuiltinRates {
    months: Vec<String>,
    currencies: Vec<String>,
    /// per_euro[currency][month index]
    per_euro: std::collections::HashMap<String, Vec<Option<f64>>>,
}

impl BuiltinRates {
    fn parse(csv: &str) -> BuiltinRates {
        let mut lines = csv.lines();
        let header: Vec<String> = lines
            .next()
            .unwrap_or("")
            .split(',')
            .skip(1)
            .map(str::to_string)
            .collect();
        let mut months = Vec::new();
        let mut per_euro: std::collections::HashMap<String, Vec<Option<f64>>> =
            header.iter().map(|c| (c.clone(), Vec::new())).collect();
        for line in lines.filter(|l| !l.trim().is_empty()) {
            let mut cells = line.split(',');
            months.push(cells.next().unwrap_or("").to_string());
            for (c, cell) in header.iter().zip(cells.chain(std::iter::repeat(""))) {
                per_euro
                    .get_mut(c)
                    .expect("from the header")
                    .push(cell.parse::<f64>().ok().filter(|r| *r > 0.0));
            }
        }
        let mut currencies: Vec<String> = header;
        currencies.push("EUR".into());
        currencies.sort();
        BuiltinRates {
            months,
            currencies,
            per_euro,
        }
    }

    /// The last month the built-in rates cover ("2026-10").
    pub fn latest_month(&self) -> &str {
        self.months.last().map(String::as_str).unwrap_or("")
    }

    /// Currencies with rates (the euro included), sorted.
    pub fn currencies(&self) -> Vec<String> {
        self.currencies.clone()
    }

    /// Units of `currency` per euro in `month` ("YYYY-MM"). A month after the data uses the latest rate; a month
    /// before a currency's first rate uses its first.
    pub fn per_euro(&self, currency: &str, month: &str) -> Option<f64> {
        if currency == "EUR" {
            return Some(1.0);
        }
        let series = self.per_euro.get(currency)?;
        let at = self.months.partition_point(|m| m.as_str() <= month);
        // The latest rate at or before the month, else the first one after it.
        series[..at]
            .iter()
            .rev()
            .flatten()
            .next()
            .or_else(|| series[at..].iter().flatten().next())
            .copied()
    }

    /// The first month with a rate for `currency`.
    fn first_month(&self, currency: &str) -> Option<&str> {
        if currency == "EUR" {
            return self.months.first().map(String::as_str);
        }
        let series = self.per_euro.get(currency)?;
        series
            .iter()
            .position(Option::is_some)
            .map(|i| self.months[i].as_str())
    }

    /// Units of `to` per unit of `from` in `month`, both read in the same month (before either has data: the first
    /// month both do).
    pub fn rate(&self, from: &str, to: &str, month: &str) -> Option<f64> {
        if from == to {
            return Some(1.0);
        }
        let start = self.first_month(from)?.max(self.first_month(to)?);
        let month = if month < start { start } else { month };
        Some(self.per_euro(to, month)? / self.per_euro(from, month)?)
    }
}

/// The rates built into the app.
pub fn builtin() -> &'static BuiltinRates {
    static RATES: std::sync::LazyLock<BuiltinRates> =
        std::sync::LazyLock::new(|| BuiltinRates::parse(include_str!("../data/fx-monthly.csv")));
    &RATES
}

// ---------- Showing amounts in your display currency ----------

/// Which rate converts an amount: its own month's average, or the latest month's for everything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Basis {
    Month,
    Latest,
}

/// The currency amounts are shown in, and how they're converted. Data keeps its own currency.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub currency: String,
    pub basis: Basis,
}

impl Display {
    fn plain(currency: &str) -> Display {
        Display {
            currency: currency.to_string(),
            basis: Basis::Month,
        }
    }
    fn month_for(&self, on: &str) -> String {
        match self.basis {
            Basis::Month => on.get(..7).unwrap_or(on).to_string(),
            Basis::Latest => builtin().latest_month().to_string(),
        }
    }
    /// Units of the display currency per unit of `currency` for a date ("YYYY-MM-DD"); None when unknown.
    fn rate(&self, currency: &str, on: &str) -> Option<f64> {
        builtin().rate(currency, &self.currency, &self.month_for(on))
    }
}

/// The currency budgets (and other amounts you type) are stored in: the one your statements were in at first.
pub fn base_currency(conn: &Connection) -> String {
    crate::settings::get(conn, "base_currency")
        .ok()
        .flatten()
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "USD".into())
}

/// An amount in the display currency (unchanged when it's already in it, or its currency has no rate).
pub fn to_display(display: &Display, cents: i64, currency: &str, on: NaiveDate) -> i64 {
    match display.rate(currency, &on.to_string()) {
        Some(rate) if currency != display.currency => (cents as f64 * rate).round() as i64,
        _ => cents,
    }
}

/// The reverse: an amount you typed in the display currency, in `currency`.
pub fn from_display(display: &Display, cents: i64, currency: &str, on: NaiveDate) -> i64 {
    match display.rate(currency, &on.to_string()) {
        Some(rate) if currency != display.currency && rate > 0.0 => {
            (cents as f64 / rate).round() as i64
        }
        _ => cents,
    }
}

type Shared = std::sync::Arc<std::sync::RwLock<Display>>;
/// Each connection's display setting, read by its `display_cents()` SQL function.
static DISPLAYS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<usize, Shared>>> =
    std::sync::LazyLock::new(Default::default);

fn key(conn: &Connection) -> usize {
    // The connection's SQLite handle identifies it for as long as it's open.
    (unsafe { conn.handle() }) as usize
}

/// Register `display_cents(amount_cents, currency, posted_on)` on a connection: the amount in the display currency,
/// converted at that row's month (or the latest month). Sums use it row by row.
pub(crate) fn register(conn: &Connection) -> Result<()> {
    use rusqlite::functions::FunctionFlags;
    let shared: Shared = std::sync::Arc::new(std::sync::RwLock::new(Display::plain("USD")));
    DISPLAYS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(key(conn), shared.clone());
    conn.create_scalar_function("display_cents", 3, FunctionFlags::SQLITE_UTF8, move |ctx| {
        let cents: i64 = ctx.get(0)?;
        let currency: Option<String> = ctx.get(1)?;
        let on: Option<String> = ctx.get(2)?;
        let display = shared.read().unwrap_or_else(|p| p.into_inner());
        let (Some(currency), Some(on)) = (currency, on) else {
            return Ok(cents);
        };
        Ok(match display.rate(&currency, &on) {
            Some(rate) if currency != display.currency => (cents as f64 * rate).round() as i64,
            _ => cents,
        })
    })?;
    Ok(())
}

/// The display setting in effect for this connection.
pub fn display(conn: &Connection) -> Display {
    DISPLAYS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&key(conn))
        .map(|d| d.read().unwrap_or_else(|p| p.into_inner()).clone())
        .unwrap_or_else(|| Display::plain(&base_currency(conn)))
}

/// Read the display currency and basis from settings (call after changing them).
pub fn refresh_display(conn: &Connection) -> Result<()> {
    let currency = crate::settings::get(conn, "display_currency")?
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| base_currency(conn));
    let basis = match crate::settings::get(conn, "fx_basis")?.as_deref() {
        Some("latest") => Basis::Latest,
        _ => Basis::Month,
    };
    if let Some(shared) = DISPLAYS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&key(conn))
    {
        *shared.write().unwrap_or_else(|p| p.into_inner()) = Display { currency, basis };
    }
    Ok(())
}

/// The currency budgets are kept in (they follow you when you set one while showing another currency).
pub fn budget_currency(conn: &Connection) -> String {
    crate::settings::get(conn, "budget_currency")
        .ok()
        .flatten()
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| base_currency(conn))
}

/// Converting what the screens show: transactions at their own month, budgets and bill amounts at the latest month.
#[derive(Debug, Clone)]
pub struct Shown {
    pub display: Display,
    pub budget_currency: String,
    pub base_currency: String,
}

impl Shown {
    pub fn of(conn: &Connection) -> Shown {
        Shown {
            display: display(conn),
            budget_currency: budget_currency(conn),
            base_currency: base_currency(conn),
        }
    }
    /// Nothing to convert: budgets and statements are already in the display currency.
    pub fn is_plain(&self) -> bool {
        self.display.currency == self.budget_currency && self.display.currency == self.base_currency
    }
    fn latest(&self, cents: i64, from: &str, to: &str) -> i64 {
        match builtin().rate(from, to, builtin().latest_month()) {
            Some(rate) if from != to => (cents as f64 * rate).round() as i64,
            _ => cents,
        }
    }
    pub fn transaction(&self, cents: i64, currency: &str, on: NaiveDate) -> i64 {
        to_display(&self.display, cents, currency, on)
    }
    /// A stored budget, shown.
    pub fn budget(&self, cents: i64) -> i64 {
        self.latest(cents, &self.budget_currency, &self.display.currency)
    }
    /// A bill amount (in your statements' currency), shown.
    pub fn charge(&self, cents: i64) -> i64 {
        self.latest(cents, &self.base_currency, &self.display.currency)
    }
    /// A bill amount you typed, stored.
    pub fn charge_back(&self, cents: i64) -> i64 {
        self.latest(cents, &self.display.currency, &self.base_currency)
    }
}

/// "$1,234.56", "₹1,234.56", "€1,234.56"; other currencies as "CHF 1,234.56".
pub fn format_money(cents: i64, currency: &str) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let c = cents.abs();
    let units = (c / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in units.chars().enumerate() {
        if i > 0 && (units.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    let symbol = match currency {
        "USD" => "$".to_string(),
        "INR" => "₹".to_string(),
        "EUR" => "€".to_string(),
        "GBP" => "£".to_string(),
        "JPY" | "CNY" => "¥".to_string(),
        other => format!("{other} "),
    };
    format!("{sign}{symbol}{grouped}.{:02}", c % 100)
}
