//! CSV statement parsing for the layouts SlayBudget knows, plus a generic fallback.

use super::{number_occurrences, parse_cents, parse_date, ParsedRow};
use crate::error::{CoreError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CsvLayout {
    /// `Date,Description,Amount,...`: positive is a charge.
    Amex,
    /// `Date,Description,Debit,Credit,...`, optionally with `Status` first and a report preamble.
    CitiCostco,
    /// Any file with a recognizable date, description and amount (or debit/credit) column.
    Generic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedStatement {
    pub layout: CsvLayout,
    pub rows: Vec<ParsedRow>,
    /// Rows with no date or a zero amount.
    pub skipped: usize,
}

const HEADER_STARTS: &[&str] = &[
    "date",
    "status",
    "transaction date",
    "posted date",
    "post date",
];

/// Drop metadata lines (e.g. Citi's "Time period of report") before the header row.
pub(crate) fn strip_preamble(text: &str) -> &str {
    for (offset, line) in text.split_inclusive('\n').scan(0usize, |pos, line| {
        let start = *pos;
        *pos += line.len();
        Some((start, line))
    }) {
        let lower = line.trim().trim_start_matches('"').to_lowercase();
        if HEADER_STARTS.iter().any(|h| lower.starts_with(h)) && lower.contains(',') {
            return &text[offset..];
        }
    }
    text
}

struct Columns {
    date: usize,
    description: usize,
    amount: Option<usize>,
    debit: Option<usize>,
    credit: Option<usize>,
    status: Option<usize>,
    category: Option<usize>,
}

fn find(headers: &[String], names: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|h| names.contains(&h.trim().to_lowercase().as_str()))
}

fn detect(headers: &[String]) -> Result<(CsvLayout, Columns)> {
    let date = find(
        headers,
        &["date", "transaction date", "posted date", "post date"],
    );
    let description = find(
        headers,
        &[
            "description",
            "memo",
            "transaction description",
            "payee",
            "name",
        ],
    );
    let amount = find(headers, &["amount"]);
    let debit = find(headers, &["debit"]);
    let credit = find(headers, &["credit"]);
    let (Some(date), Some(description)) = (date, description) else {
        return Err(CoreError::Invalid(
            "CSV has no date and description columns".into(),
        ));
    };
    if amount.is_none() && debit.is_none() && credit.is_none() {
        return Err(CoreError::Invalid(
            "CSV has no amount, debit or credit column".into(),
        ));
    }
    let columns = Columns {
        date,
        description,
        amount,
        debit,
        credit,
        status: find(headers, &["status"]),
        category: find(headers, &["category"]),
    };
    let lower: Vec<String> = headers.iter().map(|h| h.trim().to_lowercase()).collect();
    let layout = if lower.iter().any(|h| h == "appears on your statement as")
        || lower.iter().any(|h| h == "extended details")
    {
        CsvLayout::Amex
    } else if debit.is_some() && credit.is_some() {
        CsvLayout::CitiCostco
    } else {
        CsvLayout::Generic
    };
    Ok((layout, columns))
}

/// "Extended Details" -> "Extended details": headers as sentence-case labels.
fn label(header: &str) -> String {
    let lower = header.trim().to_lowercase();
    let mut chars = lower.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

pub fn parse_csv(text: &str) -> Result<ParsedStatement> {
    parse_csv_from(text, false)
}

/// Parse, knowing whether the file came from an Amex account. Amex's basic export
/// (`Date,Description,Amount`) looks generic, but lists charges as positive amounts.
pub fn parse_csv_from(text: &str, amex_account: bool) -> Result<ParsedStatement> {
    let text = strip_preamble(text.trim_start_matches('\u{feff}'));
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| CoreError::Invalid(format!("CSV header: {e}")))?
        .iter()
        .map(str::to_string)
        .collect();
    let (mut layout, cols) = detect(&headers)?;
    if amex_account && layout == CsvLayout::Generic && cols.amount.is_some() {
        layout = CsvLayout::Amex;
    }
    // Every other column is kept as a statement detail.
    let used = [
        Some(cols.date),
        Some(cols.description),
        cols.amount,
        cols.debit,
        cols.credit,
    ];
    let extra: Vec<(usize, String)> = headers
        .iter()
        .enumerate()
        .filter(|(i, h)| !used.contains(&Some(*i)) && !h.trim().is_empty())
        .map(|(i, h)| (i, label(h)))
        .collect();

    let mut rows = Vec::new();
    let mut skipped = 0usize;
    for record in reader.records() {
        let record = record.map_err(|e| CoreError::Invalid(format!("CSV row: {e}")))?;
        let get = |i: Option<usize>| i.and_then(|i| record.get(i)).unwrap_or("").trim();
        let Some(posted_on) = parse_date(get(Some(cols.date))) else {
            skipped += 1;
            continue;
        };
        let description = get(Some(cols.description)).to_string();
        let amount_cents = match layout {
            CsvLayout::Amex => parse_cents(get(cols.amount)).map(|c| -c),
            CsvLayout::CitiCostco => {
                let debit = parse_cents(get(cols.debit));
                let credit = parse_cents(get(cols.credit));
                match (debit, credit) {
                    (Some(d), _) if d != 0 => Some(-d.abs()),
                    (_, Some(c)) if c != 0 => Some(c.abs()),
                    _ => None,
                }
            }
            CsvLayout::Generic => {
                let debit = parse_cents(get(cols.debit));
                let credit = parse_cents(get(cols.credit));
                match (parse_cents(get(cols.amount)), debit, credit) {
                    (Some(a), _, _) => Some(a),
                    (None, Some(d), _) if d != 0 => Some(-d.abs()),
                    (None, _, Some(c)) if c != 0 => Some(c.abs()),
                    _ => None,
                }
            }
        };
        let Some(amount_cents) = amount_cents.filter(|c| *c != 0) else {
            skipped += 1;
            continue;
        };
        if description.is_empty() {
            skipped += 1;
            continue;
        }
        let pending = get(cols.status).eq_ignore_ascii_case("pending");
        let raw_category = Some(get(cols.category).to_string()).filter(|c| !c.is_empty());
        let details: Vec<(String, String)> = extra
            .iter()
            .filter_map(|(i, name)| {
                let value = get(Some(*i)).trim_matches('\'').trim();
                // Empty, or just the statement line again: nothing to add.
                (!value.is_empty() && !value.eq_ignore_ascii_case(&description))
                    .then(|| (name.clone(), value.to_string()))
            })
            .collect();
        rows.push(ParsedRow {
            posted_on,
            description,
            amount_cents,
            occurrence: 0,
            pending,
            raw_category,
            details,
        });
    }
    number_occurrences(&mut rows);
    Ok(ParsedStatement {
        layout,
        rows,
        skipped,
    })
}
