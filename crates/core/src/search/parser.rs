//! Parse a human query string into structured filters plus free text.
//!
//! Understood fragments (case-insensitive), consumed and removed from the text:
//!   over/above/> $100      → min_abs_cents
//!   under/below/< $50      → max_abs_cents
//!   this/last week|month|year, ytd, year to date → date range
//!   in january[ 2025], in 2025                    → month or year range
//!   income / expenses|spending                     → Income rows / money out on regular rows
//! Everything left over is the full-text query.

use crate::analytics::aggregate::{add_months, sub_months};
use chrono::{Datelike, Duration, NaiveDate};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedQuery {
    pub text: String,
    pub min_abs_cents: Option<i64>,
    pub max_abs_cents: Option<i64>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub income_only: bool,
    pub expense_only: bool,
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

fn parse_money(tok: &str) -> Option<i64> {
    let cleaned: String = tok
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    cleaned
        .parse::<f64>()
        .ok()
        .map(|v| (v * 100.0).round() as i64)
}

fn month_range(year: i32, month1: u32) -> (NaiveDate, NaiveDate) {
    let start = NaiveDate::from_ymd_opt(year, month1, 1).unwrap();
    (start, add_months(start, 1).pred_opt().unwrap())
}

/// Parse `input` relative to `today`.
pub fn parse(input: &str, today: NaiveDate) -> ParsedQuery {
    let lower = input.to_lowercase();
    let tokens: Vec<String> = lower.split_whitespace().map(|s| s.to_string()).collect();
    let mut q = ParsedQuery::default();
    let mut leftover: Vec<String> = Vec::new();

    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].as_str();
        let next = tokens.get(i + 1).map(|s| s.as_str());

        // amount comparisons
        if matches!(t, "over" | "above" | ">" | "more") {
            if let Some(cents) = next.and_then(parse_money) {
                q.min_abs_cents = Some(cents);
                i += 2;
                continue;
            }
        }
        if matches!(t, "under" | "below" | "<" | "less") {
            if let Some(cents) = next.and_then(parse_money) {
                q.max_abs_cents = Some(cents);
                i += 2;
                continue;
            }
        }
        if let Some(rest) = t.strip_prefix('>') {
            if let Some(cents) = parse_money(rest) {
                q.min_abs_cents = Some(cents);
                i += 1;
                continue;
            }
        }
        if let Some(rest) = t.strip_prefix('<') {
            if let Some(cents) = parse_money(rest) {
                q.max_abs_cents = Some(cents);
                i += 1;
                continue;
            }
        }

        // sign filters
        if t == "income" {
            q.income_only = true;
            i += 1;
            continue;
        }
        if matches!(t, "expenses" | "expense" | "spending") {
            q.expense_only = true;
            i += 1;
            continue;
        }

        // relative periods
        if let (true, Some(period)) = (matches!(t, "this" | "last"), next) {
            let back = t == "last";
            match period {
                "week" => {
                    let end = if back {
                        today - Duration::days(7)
                    } else {
                        today
                    };
                    q.from = Some(end - Duration::days(6));
                    q.to = Some(if back {
                        today - Duration::days(1)
                    } else {
                        today
                    });
                    if back {
                        q.from = Some(today - Duration::days(13));
                        q.to = Some(today - Duration::days(7));
                    }
                    i += 2;
                    continue;
                }
                "month" => {
                    let anchor = if back { sub_months(today, 1) } else { today };
                    let (s, e) = month_range(anchor.year(), anchor.month());
                    q.from = Some(s);
                    q.to = Some(e);
                    i += 2;
                    continue;
                }
                "year" => {
                    let y = if back { today.year() - 1 } else { today.year() };
                    q.from = NaiveDate::from_ymd_opt(y, 1, 1);
                    q.to = NaiveDate::from_ymd_opt(y, 12, 31);
                    i += 2;
                    continue;
                }
                _ => {}
            }
        }
        if t == "ytd" || (t == "year" && next == Some("to")) {
            q.from = NaiveDate::from_ymd_opt(today.year(), 1, 1);
            q.to = Some(today);
            i += if t == "ytd" { 1 } else { 3 }; // "year to date"
            continue;
        }

        // "in <month>" or "in <year>"
        if t == "in" {
            if let Some(n) = next {
                if let Some(idx) = MONTHS.iter().position(|m| m.starts_with(n) && n.len() >= 3) {
                    // optional trailing year
                    let (year, consumed) =
                        match tokens.get(i + 2).and_then(|y| y.parse::<i32>().ok()) {
                            Some(y) if (2000..=2100).contains(&y) => (y, 3),
                            _ => (today.year(), 2),
                        };
                    let (s, e) = month_range(year, idx as u32 + 1);
                    q.from = Some(s);
                    q.to = Some(e);
                    i += consumed;
                    continue;
                }
                if let Ok(y) = n.parse::<i32>() {
                    if (2000..=2100).contains(&y) {
                        q.from = NaiveDate::from_ymd_opt(y, 1, 1);
                        q.to = NaiveDate::from_ymd_opt(y, 12, 31);
                        i += 2;
                        continue;
                    }
                }
            }
        }

        leftover.push(tokens[i].clone());
        i += 1;
    }

    q.text = leftover.join(" ");
    q
}
