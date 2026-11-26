//! OFX, QFX and QBO parsing (SGML or XML): just the STMTTRN blocks. QIF files are handed to `qif`.

use super::{number_occurrences, parse_cents, ParsedRow};
use crate::error::{CoreError, Result};
use chrono::NaiveDate;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedOfx {
    pub currency: Option<String>,
    pub rows: Vec<ParsedRow>,
    pub skipped: usize,
}

static TRN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<STMTTRN>(.*?)</STMTTRN>").unwrap());

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = block.find(&open)? + open.len();
    let rest = &block[start..];
    let end = rest.find('<').unwrap_or(rest.len());
    let value = rest[..end].trim();
    (!value.is_empty()).then_some(value)
}

/// Parse an OFX, QFX or QBO file (SGML or XML), or a QIF file, which comes in the same way.
pub fn parse_ofx(text: &str) -> Result<ParsedOfx> {
    if super::qif::is_qif(text) {
        let (rows, skipped) = super::qif::parse_qif(text);
        return Ok(ParsedOfx {
            currency: None,
            rows,
            skipped,
        });
    }
    if !text.contains("<OFX>") && !text.contains("<ofx>") {
        return Err(CoreError::Invalid("not an OFX file".into()));
    }
    let currency = tag(text, "CURDEF").map(str::to_string);
    let mut rows = Vec::new();
    let mut skipped = 0;
    for cap in TRN.captures_iter(text) {
        let block = &cap[1];
        let date = tag(block, "DTPOSTED")
            .and_then(|d| NaiveDate::parse_from_str(&d[..8.min(d.len())], "%Y%m%d").ok());
        let amount = tag(block, "TRNAMT").and_then(parse_cents);
        let name = tag(block, "NAME").unwrap_or("");
        let memo = tag(block, "MEMO").unwrap_or("");
        let description = if memo.is_empty() || name.contains(memo) {
            name.to_string()
        } else {
            format!("{name} {memo}")
        };
        match (date, amount) {
            (Some(posted_on), Some(amount_cents))
                if amount_cents != 0 && !description.is_empty() =>
            {
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
            _ => skipped += 1,
        }
    }
    number_occurrences(&mut rows);
    Ok(ParsedOfx {
        currency,
        rows,
        skipped,
    })
}

/// Whether a statement file is a credit card's: an OFX credit card statement, or a QIF `!Type:CCard` file.
pub fn is_card(text: &str) -> bool {
    text.contains("<CCSTMTRS>") || text.contains("<ccstmtrs>") || super::qif::is_card(text)
}
