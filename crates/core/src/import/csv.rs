//! CSV statement parsing for the layouts SlayBudget knows, plus a generic fallback.

use super::{
    day_comes_first, number_occurrences, parse_cents, parse_date, parse_date_order, ParsedRow,
};
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

/// One line's fields, as the CSV reader would split them.
fn fields(line: &str) -> Vec<String> {
    csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(line.as_bytes())
        .records()
        .next()
        .and_then(|r| r.ok())
        .map(|r| r.iter().map(str::to_string).collect())
        .unwrap_or_default()
}

/// Each line with its byte offset.
fn lines(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.split_inclusive('\n').scan(0usize, |pos, line| {
        let start = *pos;
        *pos += line.len();
        Some((start, line))
    })
}

/// Drop metadata lines before the header row (Citi's "Time period of report", Bank of America's summary, Venmo's
/// title rows): the header is the first line naming a date, a description and an amount (or debit/credit) column.
pub(crate) fn strip_preamble(text: &str) -> &str {
    for (offset, line) in lines(text).take(60) {
        if line.contains(',') && detect(&fields(line)).is_ok() {
            return &text[offset..];
        }
    }
    for (offset, line) in lines(text) {
        let lower = line.trim().trim_start_matches('"').to_lowercase();
        if HEADER_STARTS.iter().any(|h| lower.starts_with(h)) && lower.contains(',') {
            return &text[offset..];
        }
    }
    text
}

/// A file with no header row (Wells Fargo): the columns, read from what the first row's values look like. The date is
/// the first field that reads as a date, the amount the first other field that reads as money, the description the
/// longest remaining field with letters in it.
fn headerless(text: &str) -> Option<Columns> {
    let first = lines(text).map(|(_, l)| l).find(|l| !l.trim().is_empty())?;
    let row = fields(first);
    let date = row.iter().position(|v| parse_date(v).is_some())?;
    let amount = row.iter().enumerate().position(|(i, v)| {
        i != date
            && v.chars().any(|c| c.is_ascii_digit())
            && parse_cents(v).is_some()
            && v.chars()
                .all(|c| c.is_ascii_digit() || "-+$.,() ".contains(c))
    })?;
    let description = row
        .iter()
        .enumerate()
        .filter(|(i, v)| *i != date && *i != amount && v.chars().any(char::is_alphabetic))
        .max_by_key(|(_, v)| v.len())
        .map(|(i, _)| i)?;
    Some(Columns {
        date,
        description,
        amount: Some(amount),
        debit: None,
        credit: None,
        direction: None,
        status: None,
        category: None,
    })
}

struct Columns {
    date: usize,
    description: usize,
    amount: Option<usize>,
    debit: Option<usize>,
    credit: Option<usize>,
    /// A Debit/Credit (DR/CR, D/C) column saying which way an unsigned amount went.
    direction: Option<usize>,
    status: Option<usize>,
    category: Option<usize>,
}

/// Which way a row's money went, from a direction column's value: Some(true) out, Some(false) in, None unknown (a
/// "Type" column can hold "Sale" or "Payment" too, which leaves the amount as it is).
fn money_out(value: &str) -> Option<bool> {
    match value.trim().to_lowercase().as_str() {
        "debit" | "dr" | "d" | "withdrawal" => Some(true),
        "credit" | "cr" | "c" | "deposit" => Some(false),
        _ => None,
    }
}

fn find(headers: &[String], names: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|h| names.contains(&h.trim().to_lowercase().as_str()))
}

fn detect(headers: &[String]) -> Result<(CsvLayout, Columns)> {
    let date = find(
        headers,
        &[
            "date",
            "transaction date",
            "posted date",
            "post date",
            "posting date",
            "trans. date",
            "trans date",
            "date posted",
            "booking date",
            "datetime",
            "started date",
            "completed date",
        ],
    );
    let description = find(
        headers,
        &[
            "description",
            "memo",
            "transaction description",
            "payee",
            "name",
            "note",
        ],
    );
    let amount = find(
        headers,
        &[
            "amount",
            "transaction amount",
            "amt",
            "amount (usd)",
            "transaction amt",
        ],
    )
    // PayPal: what reached the account after fees, else the gross.
    .or_else(|| find(headers, &["net", "net amount"]))
    .or_else(|| find(headers, &["gross"]))
    .or_else(|| {
        // Any other "... amount" column, never a running balance.
        headers.iter().position(|h| {
            let h = h.trim().to_lowercase();
            h.contains("amount") && !h.contains("balance")
        })
    });
    let debit = find(
        headers,
        &[
            "debit",
            "debits",
            "withdrawal",
            "withdrawals",
            "debit amount",
            "money out",
            "paid out",
            "outflow",
        ],
    );
    let credit = find(
        headers,
        &[
            "credit",
            "credits",
            "deposit",
            "deposits",
            "credit amount",
            "money in",
            "paid in",
            "inflow",
        ],
    );
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
        direction: find(
            headers,
            &[
                "transaction type",
                "type",
                "credit/debit",
                "debit/credit",
                "dr/cr",
                "cr/dr",
                "debit/credit indicator",
                "credit/debit indicator",
                "credit debit indicator",
            ],
        ),
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
    let first_line = fields(lines(text).map(|(_, l)| l).next().unwrap_or(""));
    let (headers, mut layout, cols) = match detect(&first_line) {
        Ok((layout, cols)) => (first_line, layout, cols),
        Err(e) => match headerless(text) {
            // No header row: every line is a transaction, with no other columns to name.
            Some(cols) => (Vec::new(), CsvLayout::Generic, cols),
            None => return Err(e),
        },
    };
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(!headers.is_empty())
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes());
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
        cols.direction,
    ];
    let extra: Vec<(usize, String)> = headers
        .iter()
        .enumerate()
        .filter(|(i, h)| !used.contains(&Some(*i)) && !h.trim().is_empty())
        .map(|(i, h)| (i, label(h)))
        .collect();
    let records: Vec<csv::StringRecord> =
        reader
            .records()
            .collect::<std::result::Result<_, _>>()
            .map_err(|e| CoreError::Invalid(format!("CSV row: {e}")))?;
    // UK and European banks write day/month/year: one day above 12 in the file settles it for every row.
    let day_first = records
        .iter()
        .any(|r| r.get(cols.date).is_some_and(day_comes_first));
    let lower: Vec<String> = headers.iter().map(|h| h.trim().to_lowercase()).collect();
    // Discover and Apple Card list purchases as positive amounts; their headers give them away.
    let card_positive = lower
        .iter()
        .any(|h| h == "trans. date" || h == "clearing date");
    // Each kept row read from a bare amount: (its index, whether it is a card payment).
    let mut as_is: Vec<(usize, bool)> = Vec::new();

    let mut rows = Vec::new();
    let mut skipped = 0usize;
    for record in &records {
        let get = |i: Option<usize>| i.and_then(|i| record.get(i)).unwrap_or("").trim();
        let Some(posted_on) = parse_date_order(get(Some(cols.date)), day_first) else {
            skipped += 1;
            continue;
        };
        let description = get(Some(cols.description)).to_string();
        // Some(is a card payment) when the sign is the file's own, read from a bare amount.
        let mut bare: Option<bool> = None;
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
                    (Some(a), _, _) => Some(match money_out(get(cols.direction)) {
                        Some(true) => -a.abs(),
                        Some(false) => a.abs(),
                        None => {
                            let line = get(Some(cols.description)).to_lowercase();
                            let payment = get(cols.direction).eq_ignore_ascii_case("payment")
                                || ["payment", "thank you", "autopay"]
                                    .iter()
                                    .any(|w| line.contains(w));
                            bare = Some(payment);
                            a
                        }
                    }),
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
        if let Some(payment) = bare {
            as_is.push((rows.len() - 1, payment));
        }
    }
    // A card that lists purchases as positive, known by its header or by its payments being its only money out.
    let kept: Vec<(i64, bool)> = as_is
        .iter()
        .filter_map(|(i, p)| rows.get(*i).map(|r| (r.amount_cents, *p)))
        .collect();
    let payments: Vec<i64> = kept.iter().filter(|(_, p)| *p).map(|(c, _)| *c).collect();
    let others: Vec<i64> = kept.iter().filter(|(_, p)| !*p).map(|(c, _)| *c).collect();
    let flip = layout == CsvLayout::Generic
        && (card_positive
            || (!payments.is_empty()
                && payments.iter().all(|c| *c < 0)
                && others.iter().filter(|c| **c > 0).count() > others.len() / 2));
    if flip {
        for (i, _) in &as_is {
            if let Some(row) = rows.get_mut(*i) {
                row.amount_cents = -row.amount_cents;
            }
        }
    }
    number_occurrences(&mut rows);
    Ok(ParsedStatement {
        layout,
        rows,
        skipped,
    })
}
