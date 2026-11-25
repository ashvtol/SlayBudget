//! Which account a statement belongs to: recognized from its clues (see `import::clues`), asked once when unsure, and
//! remembered. Most certain first: a remembered last 4 digits (with the bank), the file's account folder, a layout that
//! belongs to exactly one account; otherwise ask, with the best guess first.

use crate::error::{CoreError, Result};
use crate::import::clues::Clues;
use crate::profiles::{ProfileId, SourceId};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Card,
    Checking,
    Savings,
}

impl AccountType {
    pub fn as_str(self) -> &'static str {
        match self {
            AccountType::Card => "card",
            AccountType::Checking => "checking",
            AccountType::Savings => "savings",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub name: String,
    pub institution: Option<String>,
    pub account_type: Option<AccountType>,
    pub color: Option<String>,
    pub default_tag_id: Option<i64>,
}

/// Your answer to "Which account is this?".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Choice {
    #[serde(rename_all = "camelCase")]
    Existing { source_id: SourceId, remember: bool },
    #[serde(rename_all = "camelCase")]
    New { account: NewAccount, remember: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRow {
    pub posted_on: String,
    pub description: String,
    pub amount_cents: i64,
}

/// What the file holds, so you can tell which account it is.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub rows: usize,
    pub first: Option<String>,
    pub last: Option<String>,
    pub sample: Vec<SampleRow>,
}

/// The import paused: which account is this file?
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsAccount {
    pub clues: Clues,
    /// The account it most likely is, listed first.
    pub guess: Option<SourceId>,
    /// A name for a new account ("Chase ••1004").
    pub suggested_name: String,
    pub preview: Preview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recognized {
    Account(SourceId),
    Ask(Option<SourceId>),
}

fn last4_key(bank: Option<&str>, last4: &str) -> String {
    format!("{}|{last4}", bank.unwrap_or(""))
}

/// Accounts (in this profile) with a remembered clue of this kind, and the clue values.
fn clue_rows(conn: &Connection, profile: ProfileId, kind: &str) -> Result<Vec<(SourceId, String)>> {
    let mut stmt = conn.prepare(
        "SELECT c.source_id, c.value FROM account_clues c JOIN sources s ON s.id = c.source_id
         WHERE s.profile_id = ?1 AND c.kind = ?2 ORDER BY c.id DESC",
    )?;
    let rows = stmt.query_map(params![profile, kind], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn digits_of(value: &str) -> &str {
    value.rsplit('|').next().unwrap_or(value)
}
fn bank_of(value: &str) -> &str {
    value.split('|').next().unwrap_or("")
}

pub fn recognize(conn: &Connection, profile: ProfileId, clues: &Clues) -> Result<Recognized> {
    let endings = clue_rows(conn, profile, "last4")?;
    // 1. A remembered ending (and the same bank, when both say).
    if let Some(last4) = &clues.last4 {
        let bank = clues.bank.as_deref().unwrap_or("");
        let mut owners: Vec<SourceId> = endings
            .iter()
            .filter(|(_, v)| {
                digits_of(v) == last4
                    && (bank.is_empty() || bank_of(v).is_empty() || bank_of(v) == bank)
            })
            .map(|(id, _)| *id)
            .collect();
        owners.dedup();
        if owners.len() == 1 {
            return Ok(Recognized::Account(owners[0]));
        }
    }
    // 2. The file sits in an account's folder (made by "Create a folder for each account", or named by you).
    if let Some(folder) = &clues.folder {
        let mut stmt = conn.prepare("SELECT id, name FROM sources WHERE profile_id = ?1")?;
        let accounts = stmt.query_map([profile], |r| {
            Ok((r.get::<_, SourceId>(0)?, r.get::<_, String>(1)?))
        })?;
        let wanted = folder.trim().to_lowercase();
        for account in accounts {
            let (id, name) = account?;
            if name.trim().to_lowercase() == wanted || folder_name(&name).to_lowercase() == wanted {
                return Ok(Recognized::Account(id));
            }
        }
    }
    // 3. A layout that belongs to one account, unless that account is known by a different ending.
    if let Some(layout) = &clues.layout {
        let mut owners: Vec<SourceId> = clue_rows(conn, profile, "layout")?
            .into_iter()
            .filter(|(_, v)| v == layout)
            .map(|(id, _)| id)
            .collect();
        owners.sort();
        owners.dedup();
        if let [owner] = owners[..] {
            let its_endings: Vec<&str> = endings
                .iter()
                .filter(|(id, _)| *id == owner)
                .map(|(_, v)| digits_of(v))
                .collect();
            let other_card = matches!(&clues.last4, Some(l) if !its_endings.is_empty() && !its_endings.contains(&l.as_str()));
            if !other_card {
                return Ok(Recognized::Account(owner));
            }
        }
    }
    Ok(Recognized::Ask(guess(conn, profile, clues, &endings)?))
}

/// The likeliest account when unsure: the same ending, then the layout's owner, then the bank, then the folder name.
fn guess(
    conn: &Connection,
    profile: ProfileId,
    clues: &Clues,
    endings: &[(SourceId, String)],
) -> Result<Option<SourceId>> {
    if let Some(last4) = &clues.last4 {
        if let Some((id, _)) = endings.iter().find(|(_, v)| digits_of(v) == last4) {
            return Ok(Some(*id));
        }
    }
    if let Some(layout) = &clues.layout {
        if let Some((id, _)) = clue_rows(conn, profile, "layout")?
            .into_iter()
            .find(|(_, v)| v == layout)
        {
            return Ok(Some(id));
        }
    }
    for hint in [&clues.bank, &clues.folder].into_iter().flatten() {
        let found: Option<SourceId> = conn
            .query_row(
                "SELECT id FROM sources WHERE profile_id = ?1
                   AND (lower(coalesce(institution, '')) = lower(?2) OR instr(lower(name), lower(?2)) > 0)
                 ORDER BY id DESC LIMIT 1",
                params![profile, hint],
                |r| r.get(0),
            )
            .optional()?;
        if found.is_some() {
            return Ok(found);
        }
    }
    Ok(None)
}

/// "Chase ••1004", "Chase", the folder's name, or "New account".
pub fn suggested_name(clues: &Clues) -> String {
    match (&clues.bank, &clues.last4, &clues.folder) {
        (Some(bank), Some(last4), _) => format!("{bank} ••{last4}"),
        (_, _, Some(folder)) => folder.clone(),
        (Some(bank), None, _) => bank.clone(),
        (None, Some(last4), _) => format!("Account ••{last4}"),
        (None, None, None) => "New account".into(),
    }
}

/// Remember a file's clues for an account, so the next one like it goes straight there.
pub fn remember(conn: &Connection, source_id: SourceId, clues: &Clues) -> Result<()> {
    let add = |kind: &str, value: String| {
        conn.execute(
            "INSERT OR IGNORE INTO account_clues (source_id, kind, value) VALUES (?1, ?2, ?3)",
            params![source_id, kind, value],
        )
    };
    if let Some(last4) = &clues.last4 {
        add("last4", last4_key(clues.bank.as_deref(), last4))?;
    }
    if let Some(layout) = &clues.layout {
        add("layout", layout.clone())?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountClue {
    pub id: i64,
    pub kind: String,
    pub value: String,
}

/// What an account is recognized by.
pub fn clues_of(conn: &Connection, source_id: SourceId) -> Result<Vec<AccountClue>> {
    let mut stmt =
        conn.prepare("SELECT id, kind, value FROM account_clues WHERE source_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map([source_id], |r| {
        Ok(AccountClue {
            id: r.get(0)?,
            kind: r.get(1)?,
            value: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn forget_clue(conn: &Connection, clue_id: i64) -> Result<()> {
    conn.execute("DELETE FROM account_clues WHERE id = ?1", [clue_id])?;
    Ok(())
}

/// The account's type (card, checking, savings), when it has one.
pub fn account_kind(conn: &Connection, source_id: SourceId) -> Result<Option<AccountType>> {
    let t: Option<String> = conn
        .query_row(
            "SELECT account_type FROM sources WHERE id = ?1",
            [source_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    Ok(t.and_then(|t| match t.as_str() {
        "card" => Some(AccountType::Card),
        "checking" => Some(AccountType::Checking),
        "savings" => Some(AccountType::Savings),
        _ => None,
    }))
}

/// Make the account you described (the name must be new in this profile).
pub fn create(
    conn: &Connection,
    profile: ProfileId,
    kind: crate::profiles::SourceKind,
    account: &NewAccount,
) -> Result<SourceId> {
    let name = account.name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("an account needs a name".into()));
    }
    let taken: Option<i64> = conn
        .query_row(
            "SELECT id FROM sources WHERE profile_id = ?1 AND lower(name) = lower(?2)",
            params![profile, name],
            |r| r.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Err(CoreError::Invalid(format!(
            "an account named “{name}” already exists"
        )));
    }
    conn.execute(
        "INSERT INTO sources (profile_id, name, kind, institution, account_type, color, default_tag_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            profile,
            name,
            kind.as_str(),
            account.institution.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            account.account_type.map(AccountType::as_str),
            account.color,
            account.default_tag_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Put the account's default tag (if it has one) on every transaction an import brought in.
pub fn tag_import(conn: &Connection, source_id: SourceId, import_id: i64) -> Result<usize> {
    Ok(conn.execute(
        "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
         SELECT t.id, s.default_tag_id FROM transactions t JOIN sources s ON s.id = t.source_id
         WHERE t.import_id = ?1 AND t.source_id = ?2 AND s.default_tag_id IS NOT NULL",
        params![import_id, source_id],
    )?)
}

/// Is this account an Amex one? (Amex's short export shows charges as positive amounts.)
pub fn is_amex(conn: &Connection, source_id: SourceId) -> Result<bool> {
    let (name, institution): (String, Option<String>) = conn.query_row(
        "SELECT name, institution FROM sources WHERE id = ?1",
        [source_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let text = format!("{} {}", name, institution.unwrap_or_default()).to_lowercase();
    Ok(text.contains("amex") || text.contains("american express"))
}

pub fn account_type(conn: &Connection, source_id: SourceId) -> Result<Option<String>> {
    Ok(conn.query_row(
        "SELECT account_type FROM sources WHERE id = ?1",
        [source_id],
        |r| r.get(0),
    )?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    pub moved: usize,
    /// Rows the account already had (the same transaction), removed instead of moved.
    pub dropped: usize,
}

/// Move what an import brought in to another account. Rows the account already has are dropped as duplicates.
pub fn move_import(conn: &Connection, import_id: i64, target: SourceId) -> Result<MoveReport> {
    use crate::transactions::{dedupe_hash, NewTransaction};
    use std::collections::HashMap;
    crate::db::atomically(conn, |c| {
        let target_profile: ProfileId = c.query_row(
            "SELECT profile_id FROM sources WHERE id = ?1",
            [target],
            |r| r.get(0),
        )?;
        let rows: Vec<(i64, String, String, i64, String)> = {
            let mut stmt = c.prepare(
                "SELECT id, posted_on, description, amount_cents, currency FROM transactions
                 WHERE import_id = ?1 AND parent_id IS NULL ORDER BY id",
            )?;
            let found = stmt.query_map([import_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?;
            found.collect::<std::result::Result<_, _>>()?
        };
        let mut report = MoveReport {
            moved: 0,
            dropped: 0,
        };
        // The same transaction twice in one file is told apart by its occurrence, as on import.
        let mut seen: HashMap<(String, String, i64), u32> = HashMap::new();
        for (id, posted_on, description, amount_cents, currency) in rows {
            let key = (
                posted_on.clone(),
                description
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase(),
                amount_cents,
            );
            let occurrence = *seen.entry(key).and_modify(|n| *n += 1).or_insert(0);
            let hash = dedupe_hash(&NewTransaction {
                profile_id: target_profile,
                source_id: target,
                posted_on: chrono::NaiveDate::parse_from_str(&posted_on, "%Y-%m-%d")
                    .map_err(|e| CoreError::Invalid(e.to_string()))?,
                description,
                amount_cents,
                currency,
                occurrence,
                category_id: None,
                import_id: None,
            });
            let taken: Option<i64> = c
                .query_row(
                    "SELECT id FROM transactions WHERE dedupe_hash = ?1 AND id != ?2",
                    params![hash, id],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_some() {
                crate::transactions::delete_many(c, &[id])?;
                report.dropped += 1;
            } else {
                c.execute(
                    "UPDATE transactions SET source_id = ?1, profile_id = ?2, dedupe_hash = ?3 WHERE id = ?4",
                    params![target, target_profile, hash, id],
                )?;
                c.execute(
                    "UPDATE transactions SET source_id = ?1, profile_id = ?2 WHERE parent_id = ?3",
                    params![target, target_profile, id],
                )?;
                report.moved += 1;
            }
        }
        c.execute(
            "UPDATE imports SET source_id = ?1 WHERE id = ?2",
            params![target, import_id],
        )?;
        Ok(report)
    })
}

/// Set (or clear) an account's default tag. With `also_existing`, put it on the transactions the account already
/// has too; returns how many were tagged. Clearing it never untags anything.
pub fn set_default_tag(
    conn: &Connection,
    source_id: SourceId,
    tag_id: Option<i64>,
    also_existing: bool,
) -> Result<usize> {
    crate::db::atomically(conn, |c| {
        c.execute(
            "UPDATE sources SET default_tag_id = ?1 WHERE id = ?2",
            params![tag_id, source_id],
        )?;
        match tag_id {
            Some(tag) if also_existing => Ok(c.execute(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
                 SELECT id, ?2 FROM transactions WHERE source_id = ?1 AND parent_id IS NULL",
                params![source_id, tag],
            )?),
            _ => Ok(0),
        }
    })
}

/// Changes to an account (fields left out stay; `Some(None)` clears).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub name: Option<String>,
    pub institution: Option<Option<String>>,
    pub account_type: Option<Option<AccountType>>,
    pub color: Option<Option<String>>,
}

pub fn update(conn: &Connection, source_id: SourceId, patch: &AccountPatch) -> Result<()> {
    crate::db::atomically(conn, |c| {
        if let Some(name) = &patch.name {
            let name = name.trim();
            if name.is_empty() {
                return Err(CoreError::Invalid("an account needs a name".into()));
            }
            let taken: Option<i64> = c
                .query_row(
                    "SELECT o.id FROM sources o JOIN sources s ON s.profile_id = o.profile_id
                     WHERE s.id = ?1 AND o.id != ?1 AND lower(o.name) = lower(?2)",
                    params![source_id, name],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_some() {
                return Err(CoreError::Invalid(format!(
                    "an account named “{name}” already exists"
                )));
            }
            c.execute(
                "UPDATE sources SET name = ?1 WHERE id = ?2",
                params![name, source_id],
            )?;
        }
        if let Some(institution) = &patch.institution {
            let value = institution
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            c.execute(
                "UPDATE sources SET institution = ?1 WHERE id = ?2",
                params![value, source_id],
            )?;
        }
        if let Some(kind) = &patch.account_type {
            c.execute(
                "UPDATE sources SET account_type = ?1 WHERE id = ?2",
                params![kind.map(AccountType::as_str), source_id],
            )?;
        }
        if let Some(color) = &patch.color {
            c.execute(
                "UPDATE sources SET color = ?1 WHERE id = ?2",
                params![color, source_id],
            )?;
        }
        Ok(())
    })
}

/// An account's name as a folder name: characters a file system won't take become " - ".
pub fn folder_name(name: &str) -> String {
    use regex::Regex;
    use std::sync::LazyLock;
    static UNSAFE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*[/\\:*?<>|]+\s*").unwrap());
    UNSAFE
        .replace_all(name.trim(), " - ")
        .trim_start_matches('.')
        .trim()
        .to_string()
}

/// One folder name per account in the profile, for "Create a folder for each account".
pub fn folder_names(conn: &Connection, profile: ProfileId) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT name FROM sources WHERE profile_id = ?1 ORDER BY lower(name)")?;
    let names = stmt.query_map([profile], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for n in names {
        let f = folder_name(&n?);
        if !f.is_empty() && !out.contains(&f) {
            out.push(f);
        }
    }
    Ok(out)
}
