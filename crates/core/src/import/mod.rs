//! Statement import: parsers produce `ParsedRow`s, the pipeline categorizes and stores them.

pub mod clues;
pub mod csv;
pub mod ft_model;
pub mod legacy;
pub mod ofx;
pub mod pdf;
pub mod pipeline;
pub mod plaid;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// One transaction as read from a statement, before categorization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedRow {
    pub posted_on: NaiveDate,
    pub description: String,
    /// Negative is money out, positive is money in.
    pub amount_cents: i64,
    /// Index among identical (date, description, amount) rows in the same file.
    pub occurrence: u32,
    pub pending: bool,
    /// Category text the bank supplied, if any. Informational only.
    pub raw_category: Option<String>,
    /// Other statement columns as (label, value), shown on the transaction.
    #[serde(default)]
    pub details: Vec<(String, String)>,
}

/// Names of folders that are banks, used to tell `User/Bank/file` from `Bank/file`.
const BANK_WORDS: &[&str] = &[
    "citi",
    "chase",
    "amex",
    "american-express",
    "americanexpress",
    "wells",
    "fargo",
    "wellsfargo",
    "bank",
    "capital",
    "capitalone",
    "discover",
    "usbank",
    "pnc",
    "td",
    "barclays",
    "hsbc",
    "costco",
    "amazon",
    "apple",
    "synchrony",
    "credit",
    "visa",
    "mastercard",
    "checking",
    "savings",
];

fn looks_like_bank(name: &str) -> bool {
    let lower: String = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect();
    BANK_WORDS.iter().any(|w| lower.contains(w))
}

/// Infer `(user, source)` from a path laid out as `Statements/<User>/<Bank>/<file>`.
/// Falls back to `<Bank>/<file>` (no user) and to "Imported" for a bare file.
pub fn source_from_path(path: &str) -> (Option<String>, String) {
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        return (None, "Imported".to_string());
    }
    let bank = parts[parts.len() - 2].to_string();
    if parts.len() >= 3 {
        let user = parts[parts.len() - 3];
        let is_root = matches!(user.to_lowercase().as_str(), "statements" | "statments");
        if !is_root && !looks_like_bank(user) {
            return (Some(user.to_string()), bank);
        }
    }
    (None, bank)
}

/// Parse a money string ("1,234.56", "-12.00", "(12.00)", "$5") into cents.
pub fn parse_cents(raw: &str) -> Option<i64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let negative = s.starts_with('-') || (s.starts_with('(') && s.ends_with(')'));
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let (whole, frac) = cleaned.split_once('.').unwrap_or((&cleaned, ""));
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    let frac_digits: String = frac.chars().take(2).collect();
    let frac: i64 = match frac_digits.len() {
        0 => 0,
        1 => frac_digits.parse::<i64>().ok()? * 10,
        _ => frac_digits.parse().ok()?,
    };
    let cents = whole * 100 + frac;
    Some(if negative { -cents } else { cents })
}

/// Parse the date formats banks use: `MM/DD/YYYY`, `YYYY-MM-DD`, `M/D/YY`.
pub fn parse_date(raw: &str) -> Option<NaiveDate> {
    let s = raw.trim();
    // chrono's %Y accepts a two-digit year as year 26, so use the two-digit form only
    // for the M/D/YY shape (three numeric fields, short first field, two-digit last).
    let parts: Vec<&str> = s.split(['/', '-']).collect();
    let two_digit_year = parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        && parts[0].len() <= 2
        && parts[2].len() == 2;
    let formats: &[&str] = if two_digit_year {
        &["%m/%d/%y", "%m-%d-%y"]
    } else {
        &["%m/%d/%Y", "%Y-%m-%d", "%Y/%m/%d", "%d-%b-%Y", "%m-%d-%Y"]
    };
    for fmt in formats {
        if let Ok(d) = NaiveDate::parse_from_str(s, fmt) {
            return Some(d);
        }
    }
    None
}

/// Assign `occurrence` indexes so identical rows within one file stay distinct.
pub fn number_occurrences(rows: &mut [ParsedRow]) {
    let mut seen: std::collections::HashMap<(NaiveDate, String, i64), u32> =
        std::collections::HashMap::new();
    for row in rows.iter_mut() {
        let key = (
            row.posted_on,
            row.description.to_lowercase(),
            row.amount_cents,
        );
        let n = seen.entry(key).or_insert(0);
        row.occurrence = *n;
        *n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_parsing() {
        assert_eq!(parse_cents("1,234.56"), Some(123_456));
        assert_eq!(parse_cents("-12.00"), Some(-1200));
        assert_eq!(parse_cents("(12.5)"), Some(-1250));
        assert_eq!(parse_cents("$5"), Some(500));
        assert_eq!(parse_cents(""), None);
        assert_eq!(parse_cents("abc"), None);
    }

    #[test]
    fn date_parsing() {
        assert_eq!(
            parse_date("06/27/2026"),
            Some(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())
        );
        assert_eq!(
            parse_date("2026-06-27"),
            Some(NaiveDate::from_ymd_opt(2026, 6, 27).unwrap())
        );
        assert_eq!(
            parse_date("6/7/26"),
            Some(NaiveDate::from_ymd_opt(2026, 6, 7).unwrap())
        );
        assert_eq!(parse_date("nope"), None);
    }
}
