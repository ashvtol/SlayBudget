//! Export what categorization has learned (learned merchants and explicit rules) as a portable file
//! with nothing about the person using the app: no ids, accounts, profiles or transaction data, and
//! no entry that carries their reference numbers, card digits, handles, payees or name.
//! Details about merchants (store numbers, locations, a merchant that is a person's name) stay.

use super::is_payment_platform;
use super::learning;
use super::rules::{self, MatchKind};
use crate::categories;
use crate::error::{CoreError, Result};
use crate::profiles;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

pub const FORMAT: &str = "slaybudget-rules";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesFile {
    pub format: String,
    pub version: u32,
    pub exported_on: String,
    pub categories: Vec<ExportedCategory>,
    pub learned: Vec<ExportedMerchant>,
    pub rules: Vec<ExportedRule>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedCategory {
    pub name: String,
    pub group: String,
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedMerchant {
    pub merchant: String,
    pub category: String,
    pub hits: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedRule {
    pub name: String,
    pub match_kind: MatchKind,
    pub pattern: String,
    pub min_cents: Option<i64>,
    pub max_cents: Option<i64>,
    pub category: String,
    pub priority: i64,
    pub enabled: bool,
}

pub struct RulesExport {
    pub file: RulesFile,
    /// Entries left out because they could identify the person or their accounts.
    pub left_out: usize,
}

/// Profile names too generic to be a person's name.
const GENERIC_PROFILE_NAMES: &[&str] = &[
    "personal",
    "household",
    "business",
    "family",
    "joint",
    "main",
    "default",
    "home",
    "work",
    "shared",
    "me",
];
/// Payees and money movements that name the person or the people they pay.
const PAYEE_WORDS: &[&str] = &[
    "zelle",
    "venmo",
    "cash app",
    "paypal",
    "apple cash",
    "transfer",
    "payroll",
    "direct dep",
    "check",
];
/// Markers of the person's own records (substring match).
const ID_MARKERS: &[&str] = &["id:", "ref:", "conf:", "acct", "@"];

fn words(text: &str) -> Vec<&str> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect()
}

/// True when the words of `phrase` appear consecutively, as whole words, in `text`.
fn has_phrase(text: &[&str], phrase: &str) -> bool {
    let p = words(phrase);
    !p.is_empty() && text.windows(p.len()).any(|w| w == p.as_slice())
}

fn longest_digit_run(text: &str) -> usize {
    let (mut best, mut run) = (0, 0);
    for c in text.chars() {
        run = if c.is_ascii_digit() { run + 1 } else { 0 };
        best = best.max(run);
    }
    best
}

/// A masked card number such as "x1234" or "xx1234".
fn has_masked_card(text: &[&str]) -> bool {
    text.iter().any(|w| {
        let digits = w.trim_start_matches('x');
        w.starts_with('x') && digits.len() >= 2 && digits.chars().all(|c| c.is_ascii_digit())
    })
}

/// Whether a merchant key, rule pattern or rule name can leave the app: nothing in it may identify
/// the person exporting (their reference numbers, cards, handles, payees or profile names).
pub fn is_shareable(text: &str, profile_names: &[impl AsRef<str>]) -> bool {
    let lower = text.trim().to_lowercase();
    let w = words(&lower);
    if lower.is_empty() || longest_digit_run(&lower) >= 6 || has_masked_card(&w) {
        return false;
    }
    if ID_MARKERS.iter().any(|m| lower.contains(m)) || PAYEE_WORDS.iter().any(|p| has_phrase(&w, p))
    {
        return false;
    }
    if is_payment_platform(&lower) {
        return false;
    }
    !profile_names.iter().any(|name| {
        let name = name.as_ref().trim().to_lowercase();
        name.chars().count() >= 3
            && !GENERIC_PROFILE_NAMES.contains(&name.as_str())
            && has_phrase(&w, &name)
    })
}

/// Build the export: learned merchants (one per merchant, its strongest category) and explicit rules,
/// with categories by name, sorted by category then merchant or rule name so it is stable.
pub fn export_rules(conn: &Connection, today: &str) -> Result<RulesExport> {
    let profile_names: Vec<String> = profiles::list(conn)?.into_iter().map(|p| p.name).collect();
    let cats: HashMap<i64, categories::Category> = categories::list(conn)?
        .into_iter()
        .map(|c| (c.id, c))
        .collect();
    let groups: HashMap<i64, categories::CategoryGroup> = categories::list_groups(conn)?
        .into_iter()
        .map(|g| (g.id, g))
        .collect();
    let mut used: BTreeMap<String, ExportedCategory> = BTreeMap::new();
    let mut use_category = |id: i64| -> Option<String> {
        let c = cats.get(&id)?;
        used.entry(c.name.clone())
            .or_insert_with(|| ExportedCategory {
                name: c.name.clone(),
                group: groups
                    .get(&c.group_id)
                    .map(|g| g.name.clone())
                    .unwrap_or_default(),
                emoji: c.emoji.clone(),
            });
        Some(c.name.clone())
    };
    let mut left_out = 0;

    // Learned merchants: across profiles, keep the category with the most hits.
    let mut best: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for r in learning::list(conn)? {
        let e = best.entry(r.merchant.clone()).or_insert((r.category_id, 0));
        if r.hits > e.1 {
            *e = (r.category_id, r.hits);
        }
    }
    let mut learned = Vec::new();
    for (merchant, (category_id, hits)) in best {
        if !is_shareable(&merchant, &profile_names) {
            left_out += 1;
            continue;
        }
        if let Some(category) = use_category(category_id) {
            learned.push(ExportedMerchant {
                merchant,
                category,
                hits,
            });
        }
    }
    learned.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.merchant.cmp(&b.merchant))
    });

    let mut out_rules = Vec::new();
    for r in rules::list(conn)? {
        // A rule tied to one account can't travel: the link is the person's, and without it the rule changes meaning.
        if r.source_id.is_some()
            || !is_shareable(&r.pattern, &profile_names)
            || !is_shareable(&r.name, &profile_names)
        {
            left_out += 1;
            continue;
        }
        if let Some(category) = use_category(r.category_id) {
            out_rules.push(ExportedRule {
                name: r.name,
                match_kind: r.match_kind,
                pattern: r.pattern,
                min_cents: r.min_cents,
                max_cents: r.max_cents,
                category,
                priority: r.priority,
                enabled: r.enabled,
            });
        }
    }
    out_rules.sort_by(|a, b| {
        a.category
            .cmp(&b.category)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(RulesExport {
        file: RulesFile {
            format: FORMAT.into(),
            version: 1,
            exported_on: today.into(),
            categories: used.into_values().collect(),
            learned,
            rules: out_rules,
        },
        left_out,
    })
}

pub fn to_json(file: &RulesFile) -> Result<String> {
    serde_json::to_string_pretty(file).map_err(|e| CoreError::Invalid(format!("rules file: {e}")))
}
