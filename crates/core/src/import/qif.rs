//! QIF (Quicken Interchange Format): one field per line, a letter then its value, each transaction ending in `^`.
//! Money out is negative, for bank and card accounts alike.

use super::{day_comes_first, number_occurrences, parse_cents, parse_date_order, ParsedRow};

/// Whether a file is QIF: its first line is a `!Type:` or `!Option`/`!Account` header.
pub fn is_qif(text: &str) -> bool {
    text.trim_start_matches('\u{feff}')
        .lines()
        .find(|l| !l.trim().is_empty())
        .is_some_and(|l| l.trim_start().starts_with('!'))
}

/// Whether a QIF file is a credit card's (`!Type:CCard`).
pub fn is_card(text: &str) -> bool {
    text.lines()
        .any(|l| l.trim().eq_ignore_ascii_case("!type:ccard"))
}

/// Quicken's dates, as the date reader takes them: "1/ 6'26" -> "1/6/26", "1/ 5' 6" -> "1/5/06".
fn normalize_date(raw: &str) -> String {
    let s: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let s = s.replace('\'', "/");
    match s.rsplit_once('/') {
        Some((head, year)) if year.len() == 1 => format!("{head}/0{year}"),
        _ => s,
    }
}

#[derive(Default)]
struct Entry {
    date: String,
    amount: Option<i64>,
    payee: String,
    memo: String,
    category: String,
    number: String,
}

/// The transactions in a QIF file, and how many were skipped (no date, or a zero amount).
pub fn parse_qif(text: &str) -> (Vec<ParsedRow>, usize) {
    let mut entries = Vec::new();
    let mut entry = Entry::default();
    // `!Account` blocks describe an account, not a transaction; they end with `^` too.
    let mut in_account = false;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim_end();
        if line.starts_with('!') {
            in_account = line.trim().eq_ignore_ascii_case("!account");
            continue;
        }
        if line.trim() == "^" {
            if !in_account {
                entries.push(std::mem::take(&mut entry));
            }
            entry = Entry::default();
            in_account = false;
            continue;
        }
        if in_account {
            continue;
        }
        let mut chars = line.chars();
        let Some(code) = chars.next() else { continue };
        let value = chars.as_str().trim();
        match code {
            'D' => entry.date = normalize_date(value),
            // T and U carry the same amount; the first one wins.
            'T' | 'U' if entry.amount.is_none() => entry.amount = parse_cents(value),
            'P' => entry.payee = value.to_string(),
            'M' => entry.memo = value.to_string(),
            'L' => entry.category = value.to_string(),
            'N' => entry.number = value.to_string(),
            // Splits (S, E, $), address lines (A), cleared status (C): not needed.
            _ => {}
        }
    }
    // Day/month/year files (Quicken UK): one day above 12 settles it.
    let day_first = entries.iter().any(|e| day_comes_first(&e.date));
    let mut rows = Vec::new();
    let mut skipped = 0;
    for e in entries {
        let description = if e.payee.is_empty() {
            e.memo.clone()
        } else {
            e.payee.clone()
        };
        let date = parse_date_order(&e.date, day_first);
        match (date, e.amount) {
            (Some(posted_on), Some(amount_cents))
                if amount_cents != 0 && !description.is_empty() =>
            {
                let mut details = Vec::new();
                if !e.memo.is_empty() && e.memo != description {
                    details.push(("Memo".to_string(), e.memo));
                }
                if !e.number.is_empty() {
                    details.push(("Number".to_string(), e.number));
                }
                // "[Checking]" names a transfer to another account, not a category.
                let raw_category =
                    Some(e.category).filter(|c| !c.is_empty() && !c.starts_with('['));
                rows.push(ParsedRow {
                    posted_on,
                    description,
                    amount_cents,
                    occurrence: 0,
                    pending: false,
                    raw_category,
                    details,
                });
            }
            _ => skipped += 1,
        }
    }
    number_occurrences(&mut rows);
    (rows, skipped)
}
