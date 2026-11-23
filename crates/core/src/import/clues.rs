//! What a statement file says about which account it belongs to: the account's last 4 digits, the bank, the CSV's
//! layout (its columns, order ignored) and the folder it sits in. `accounts::recognize` matches these to your accounts.

use super::csv::{parse_csv_from, strip_preamble, CsvLayout};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clues {
    /// The account's last 4 digits.
    pub last4: Option<String>,
    /// The bank, by its usual name ("American Express", "Citi", "Chase").
    pub bank: Option<String>,
    /// "csv:<columns>" (lowercase, sorted), "ofx" or "pdf:<bank layout>".
    pub layout: Option<String>,
    /// The folder the file is in, unless it's a general place like Downloads.
    pub folder: Option<String>,
}

/// Banks by their usual name, with what their files call them.
const BANKS: &[(&str, &str)] = &[
    ("American Express", r"american express|\bamex\b"),
    ("Citi", r"\bcitibank\b|\bciti\b"),
    ("Chase", r"\bchase\b"),
    ("Capital One", r"capital one"),
    ("Discover", r"discover (?:card|bank|it)\b"),
    ("Bank of America", r"bank of america"),
    ("Wells Fargo", r"wells fargo"),
    ("U.S. Bank", r"u\.s\. bank|\bus bank\b"),
    ("Apple Card", r"apple card|goldman sachs"),
    ("Barclays", r"\bbarclays\b"),
    ("Synchrony", r"\bsynchrony\b"),
];
static BANK_RES: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    BANKS
        .iter()
        .map(|(name, re)| (*name, Regex::new(&format!("(?i){re}")).unwrap()))
        .collect()
});

/// The bank named earliest in the text.
fn bank_in(text: &str) -> Option<String> {
    BANK_RES
        .iter()
        .filter_map(|(name, re)| re.find(text).map(|m| (m.start(), *name)))
        .min()
        .map(|(_, name)| name.to_string())
}

static ENDING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)ending(?:\s+in)?\s*[:#]?\s*(\d{4,})").unwrap());
static MASKED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)[x*•]{2,}[\s\-x*•]*(\d{4})\b").unwrap());
static ACCOUNT_NO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:account|card)\s*(?:number|no\.?|#)\s*[:#]?\s*(\d{4,})\b").unwrap()
});
/// Digits right after letters in a file name ("Chase1004_Activity.csv").
static NAME_DIGITS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z](\d{4})(?:[^0-9]|$)").unwrap());

fn last4_of(digits: &str) -> String {
    digits[digits.len() - 4..].to_string()
}

/// "Account ending in 1004", "XXXX XXXX XXXX 1004", "Account Number: 9871004".
fn last4_in(text: &str) -> Option<String> {
    [&*ENDING, &*MASKED, &*ACCOUNT_NO]
        .iter()
        .find_map(|re| re.captures(text).map(|c| last4_of(&c[1])))
}

fn last4_in_file_name(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    NAME_DIGITS
        .captures_iter(name)
        .map(|c| c[1].to_string())
        // A year is not an account ending.
        .find(|d| !(d.starts_with("19") || d.starts_with("20")))
}

/// The bank a file name mentions ("Chase1004_Activity.csv", "capital-one-nov.csv").
fn bank_in_file_name(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let mut spaced = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        let c = if matches!(c, '_' | '-' | '.') { ' ' } else { c };
        if prev.is_some_and(|p| p.is_ascii_alphabetic() && c.is_ascii_digit()) {
            spaced.push(' ');
        }
        spaced.push(c);
        prev = Some(c);
    }
    bank_in(&spaced)
}

const GENERAL_PLACES: &[&str] = &[
    "downloads",
    "desktop",
    "documents",
    "statements",
    "statments",
    "tmp",
    "temp",
    "inbox",
];

fn folder_of(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    let parent = parts[parts.len() - 2];
    let home = parts.len() >= 3 && matches!(parts[parts.len() - 3], "Users" | "home");
    if home || GENERAL_PLACES.contains(&parent.to_lowercase().as_str()) {
        return None;
    }
    Some(parent.to_string())
}

pub fn from_csv(path: &str, text: &str) -> Clues {
    let text = text.trim_start_matches('\u{feff}');
    let table = strip_preamble(text);
    let preamble = &text[..text.len() - table.len()];
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(table.as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map(|h| h.iter().map(str::to_string).collect())
        .unwrap_or_default();
    let layout = (!headers.is_empty()).then(|| {
        let mut cols: Vec<String> = headers.iter().map(|h| h.trim().to_lowercase()).collect();
        cols.sort();
        format!("csv:{}", cols.join("|"))
    });
    // An account column ("Account #", "Card No.") holds the number on every row.
    static ACCOUNT_COL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^(account|card)\s*(#|no\.?|number)?$").unwrap());
    let from_column = headers
        .iter()
        .position(|h| ACCOUNT_COL.is_match(h.trim()))
        .and_then(|i| {
            reader.records().flatten().find_map(|r| {
                let digits: String = r.get(i)?.chars().filter(char::is_ascii_digit).collect();
                (digits.len() >= 4).then(|| last4_of(&digits))
            })
        });
    // Amex's exports: the long one is its own layout; the short one has a "Card Member" column. (A debit and credit
    // layout says nothing about the bank: many banks use it.)
    let amex = headers
        .iter()
        .any(|h| h.trim().eq_ignore_ascii_case("card member"))
        || parse_csv_from(text, false).is_ok_and(|p| p.layout == CsvLayout::Amex);
    let bank_from_layout = amex.then(|| "American Express".to_string());
    Clues {
        last4: from_column
            .or_else(|| last4_in(preamble))
            .or_else(|| last4_in_file_name(path)),
        bank: bank_from_layout
            .or_else(|| bank_in(preamble))
            .or_else(|| bank_in_file_name(path)),
        layout,
        folder: folder_of(path),
    }
}

/// From the text of a PDF statement (its lines joined).
pub fn from_pdf(path: &str, text: &str) -> Clues {
    let bank = bank_in(text).or_else(|| bank_in_file_name(path));
    let last4 = last4_in(text).or_else(|| last4_in_file_name(path));
    if bank.is_none() && last4.is_none() {
        return Clues {
            folder: folder_of(path),
            ..Clues::default()
        };
    }
    Clues {
        layout: bank.as_ref().map(|b| format!("pdf:{}", b.to_lowercase())),
        last4,
        bank,
        folder: folder_of(path),
    }
}

pub fn from_ofx(path: &str, text: &str) -> Clues {
    let tag = |name: &str| {
        Regex::new(&format!(r"(?i)<{name}>\s*([^<\r\n]+)"))
            .ok()?
            .captures(text)
            .map(|c| c[1].trim().to_string())
    };
    let last4 = tag("ACCTID").and_then(|id| {
        let digits: String = id.chars().filter(char::is_ascii_digit).collect();
        (digits.len() >= 4).then(|| last4_of(&digits))
    });
    let bank = tag("ORG")
        .and_then(|org| bank_in(&org).or(Some(org)))
        .or_else(|| tag("FID").and_then(|f| bank_in(&f)))
        .or_else(|| bank_in_file_name(path));
    Clues {
        last4: last4.or_else(|| last4_in_file_name(path)),
        bank,
        layout: Some("ofx".into()),
        folder: folder_of(path),
    }
}
