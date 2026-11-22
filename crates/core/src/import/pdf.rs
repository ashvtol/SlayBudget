//! PDF statement structuring. The webview extracts positioned text with pdf.js
//! and hands it here; this module turns it into rows. Ported from Financial-Tracker.

use super::{number_occurrences, parse_cents, ParsedRow};
use crate::error::{CoreError, Result};
use chrono::{Datelike, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfItem {
    pub x: i32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfLine {
    pub y: i32,
    pub items: Vec<PdfItem>,
}

impl PdfLine {
    fn text(&self) -> String {
        self.items
            .iter()
            .map(|i| i.text.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfText {
    /// Top to bottom, each line's items left to right.
    pub lines: Vec<PdfLine>,
    pub filename: String,
    /// Used for the "no future dates" sanity check. Injected for testability.
    pub today: NaiveDate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PdfStatementKind {
    CitiCard,
    CitiChecking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedPdf {
    pub kind: PdfStatementKind,
    pub billing_period: Option<String>,
    pub rows: Vec<ParsedRow>,
}

pub fn parse_pdf(doc: &PdfText) -> Result<ParsedPdf> {
    let full: Vec<String> = doc.lines.iter().map(PdfLine::text).collect();
    let lower = full.join("\n").to_lowercase();
    let is_citi = lower.contains("citi");
    if is_citi && (lower.contains("checking activity") || lower.contains("deposit accounts")) {
        return parse_citi_checking(doc, &full);
    }
    if is_citi {
        return parse_citi_card(doc, &full);
    }
    Err(CoreError::Invalid(
        "unrecognized PDF statement layout".into(),
    ))
}

fn make_date(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, month, day)
}

fn year_from_filename(name: &str) -> Option<i32> {
    static SHORT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\w+\s+\d{1,2},?\s*(\d{2})\.pdf$").unwrap());
    static FULL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(20\d{2})").unwrap());
    if let Some(c) = SHORT.captures(name) {
        return c[1].parse::<i32>().ok().map(|y| 2000 + y);
    }
    FULL.captures(name).and_then(|c| c[1].parse().ok())
}

/// Year for a MM/DD transaction date: statements that end in Jan/Feb put Nov/Dec in
/// the previous year, and no transaction may land after `today`.
fn resolve_year(
    month: u32,
    statement_year: i32,
    statement_end_month: u32,
    today: NaiveDate,
) -> i32 {
    let mut year = statement_year;
    if statement_end_month <= 2 && month >= 11 {
        year -= 1;
    }
    if year == today.year() && month > today.month() {
        year -= 1;
    }
    year
}

// ---------- Citi credit card: text based ----------

static BILLING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)Billing Period[:\s]*(\d{1,2}/\d{1,2}/\d{2,4})\s*[-–]\s*(\d{1,2}/\d{1,2}/\d{2,4})",
    )
    .unwrap()
});
static TX_WITH_AMOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{1,2}/\d{1,2})(?:\s+(\d{1,2}/\d{1,2}))?\s+(.+?)\s+(-?\s*\$[\d,]+\.\d{2})$")
        .unwrap()
});
static AMOUNT_ONLY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(-?\s*\$[\d,]+\.\d{2})$").unwrap());
static DATE_DESC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{1,2}/\d{1,2})(?:\s+(\d{1,2}/\d{1,2}))?\s+(.+)$").unwrap());
static SKIP: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)^Page \d",
        r"(?i)www\.citicards\.com",
        r"(?i)Customer Service",
        r"(?i)Account Summary",
        r"(?i)Interest Charge",
        r"(?i)Annual percentage",
        r"APR",
        r"(?i)Rewards",
        r"(?i)^TOTAL",
        r"(?i)Fees Charged",
        r"(?i)Interest Charged",
        r"(?i)Credit Limit",
        r"(?i)CARDHOLDER",
        r"(?i)Card ending",
        r"(?i)New Charges",
        r"(?i)Standard Purchases",
        r"(?i)Payments, Credits",
        r"(?i)Sale\s+Post",
        r"(?i)Date\s+Date",
        r"(?i)Description\s+Amount",
        r"(?i)^\d{4} totals",
        r"(?i)Balance type",
        r"(?i)Balance subject",
        r"PURCHASES$",
        r"ADVANCES$",
        r"^\(TTY",
        r"(?i)Important:",
        r"©\d{4}",
        r"(?i)Citi,? Citi",
        r"(?i)Visa is a registered",
        r"(?i)Visit Citi\.com",
        r"(?i)PHONE NUMBER",
        r"(?i)FOLIO NUMBER",
        r"(?i)ARRIVE:",
        r"(?i)DEPART:",
    ]
    .iter()
    .map(|p| Regex::new(p).unwrap())
    .collect()
});

fn month_day(s: &str) -> Option<(u32, u32)> {
    let (m, d) = s.split_once('/')?;
    Some((m.parse().ok()?, d.parse().ok()?))
}

fn parse_citi_card(doc: &PdfText, lines: &[String]) -> Result<ParsedPdf> {
    let joined = lines.join("\n");
    let mut statement_year = doc.today.year();
    let mut end_month = 12u32;
    let mut billing_period = None;
    if let Some(c) = BILLING.captures(&joined) {
        billing_period = Some(format!("{} - {}", &c[1], &c[2]));
        let end = &c[2];
        if let Some(y) = end.rsplit('/').next().and_then(|y| y.parse::<i32>().ok()) {
            statement_year = if end.rsplit('/').next().map(str::len) == Some(2) {
                2000 + y
            } else {
                y
            };
        }
        if let Some((m, _)) = month_day(end) {
            end_month = m;
        }
    } else if let Some(y) = year_from_filename(&doc.filename) {
        statement_year = y;
    }

    let mut rows = Vec::new();
    let mut pending: Option<(NaiveDate, String)> = None;
    let push =
        |rows: &mut Vec<ParsedRow>, date: NaiveDate, description: String, amount_text: &str| {
            let cleaned: String = amount_text.chars().filter(|c| !c.is_whitespace()).collect();
            if let Some(cents) = parse_cents(&cleaned) {
                // Positive on a card statement is a charge: money out.
                rows.push(ParsedRow {
                    posted_on: date,
                    description,
                    amount_cents: -cents,
                    occurrence: 0,
                    pending: false,
                    raw_category: None,
                    details: Vec::new(),
                });
            }
        };
    let date_for = |s: &str| -> Option<NaiveDate> {
        let (m, d) = month_day(s)?;
        make_date(resolve_year(m, statement_year, end_month, doc.today), m, d)
    };

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        i += 1;
        if line.is_empty() {
            continue;
        }
        if let Some((date, desc)) = pending.take() {
            if let Some(c) = AMOUNT_ONLY.captures(line) {
                push(&mut rows, date, desc, &c[1]);
                continue;
            }
        }
        if SKIP.iter().any(|r| r.is_match(line)) {
            continue;
        }
        if let Some(c) = TX_WITH_AMOUNT.captures(line) {
            let post = c.get(2).map(|m| m.as_str()).unwrap_or(&c[1]);
            if let Some(date) = date_for(post) {
                push(&mut rows, date, c[3].trim().to_string(), &c[4]);
            }
            continue;
        }
        if let Some(c) = DATE_DESC.captures(line) {
            let post = c.get(2).map(|m| m.as_str()).unwrap_or(&c[1]);
            if let Some(date) = date_for(post) {
                pending = Some((date, c[3].trim().to_string()));
            }
        }
    }
    number_occurrences(&mut rows);
    Ok(ParsedPdf {
        kind: PdfStatementKind::CitiCard,
        billing_period,
        rows,
    })
}

// ---------- Citi checking: position based ----------

static PERIOD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Period\s+(\w+\s+\d{1,2})\s*[-–]\s*(\w+\s+\d{1,2},?\s*\d{4})").unwrap()
});
static START_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{1,2}/\d{1,2})").unwrap());
static NUMBER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\d,]+\.\d{2}$").unwrap());
static BOILERPLATE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"(?i)statement\s*period",
        r"(?i)account\s*\d+",
        r"(?i)customer\s*service",
        r"(?i)www\.",
        r"(?i)http",
        r"(?i)you\s*can\s*call",
        r"(?i)telephone",
        r"(?i)tty",
        r"(?i)monthly\s*service\s*fee",
        r"(?i)atm\s*fee",
        r"(?i)relationship\s*tier",
        r"(?i)total\s*(subtracted|added)",
        r"(?i)citi\s*priority",
    ]
    .iter()
    .map(|p| Regex::new(p).unwrap())
    .collect()
});

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn month_index(word: &str) -> Option<usize> {
    let w = word.to_lowercase();
    MONTHS.iter().position(|m| w.starts_with(m))
}

fn parse_citi_checking(doc: &PdfText, texts: &[String]) -> Result<ParsedPdf> {
    let joined = texts.join("\n");
    let mut end_year = doc.today.year();
    let mut spans_years = false;
    let mut billing_period = None;
    if let Some(c) = PERIOD.captures(&joined) {
        billing_period = Some(format!("{} - {}", &c[1], &c[2]));
        if let Some(y) = Regex::new(r"(\d{4})")
            .unwrap()
            .captures(&c[2])
            .and_then(|m| m[1].parse().ok())
        {
            end_year = y;
        }
        let start = c[1].split_whitespace().next().and_then(month_index);
        let end = c[2].split_whitespace().next().and_then(month_index);
        if let (Some(s), Some(e)) = (start, end) {
            spans_years = s > e;
        }
    }

    // Find the Checking Activity section and the transaction start lines in it.
    let mut in_section = false;
    let mut starts: Vec<(usize, String)> = Vec::new();
    let mut section_end = doc.lines.len();
    for (i, text) in texts.iter().enumerate() {
        let lower = text.to_lowercase();
        if lower.contains("checking activity") {
            in_section = true;
            continue;
        }
        if in_section && (lower.starts_with("savings") || lower.starts_with("summary")) {
            section_end = i;
            break;
        }
        if !in_section {
            continue;
        }
        if let Some(c) = START_DATE.captures(text) {
            starts.push((i, c[1].to_string()));
        }
    }

    let is_boilerplate = |s: &str| BOILERPLATE.iter().any(|r| r.is_match(s));
    let mut rows = Vec::new();
    for (n, (start_idx, date_str)) in starts.iter().enumerate() {
        let next_start = starts.get(n + 1).map(|(i, _)| *i).unwrap_or(section_end);
        let max_line = (start_idx + 2).min(next_start);
        let mut amounts: Vec<(i64, i32)> = Vec::new();
        let mut description = String::new();
        for line in &doc.lines[*start_idx..max_line] {
            if is_boilerplate(&line.text()) {
                break;
            }
            for item in &line.items {
                let t = item.text.trim();
                if t.is_empty() || is_boilerplate(t) {
                    continue;
                }
                if NUMBER.is_match(t) {
                    if let Some(c) = parse_cents(t) {
                        amounts.push((c, item.x));
                    }
                } else if item.x >= 70
                    && item.x < 350
                    && START_DATE.captures(t).map(|c| c[0].len()) != Some(t.len())
                {
                    description.push_str(t);
                    description.push(' ');
                }
            }
        }
        amounts.sort_by_key(|(_, x)| *x);
        let (subtracted, added) = match amounts.as_slice() {
            [] => (0, 0),
            [(a, x)] if *x < 430 => (*a, 0),
            [(a, x)] if *x < 520 => (0, *a),
            [_] => (0, 0),
            [(a, x), _] => {
                if *x < 430 {
                    (*a, 0)
                } else {
                    (0, *a)
                }
            }
            [(a, _), (b, _), ..] => (*a, *b),
        };
        let description = description.trim().to_string();
        if description.is_empty() {
            continue;
        }
        let Some((month, day)) = month_day(date_str) else {
            continue;
        };
        let mut year = end_year;
        if spans_years && month >= 10 {
            year -= 1;
        }
        if year == doc.today.year() && month > doc.today.month() {
            year -= 1;
        }
        let Some(posted_on) = make_date(year, month, day) else {
            continue;
        };
        let amount_cents = if added > 0 {
            added
        } else if subtracted > 0 {
            -subtracted
        } else {
            continue;
        };
        rows.push(ParsedRow {
            posted_on,
            description,
            amount_cents,
            occurrence: 0,
            pending: false,
            raw_category: None,
            details: Vec::new(),
        });
    }
    number_occurrences(&mut rows);
    Ok(ParsedPdf {
        kind: PdfStatementKind::CitiChecking,
        billing_period,
        rows,
    })
}
