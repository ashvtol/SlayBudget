//! Profiles (people in the household) and their sources (where statements come from).

use crate::error::{CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub type ProfileId = i64;
pub type SourceId = i64;

/// Name of the profile created automatically on first open.
pub const DEFAULT_PROFILE_NAME: &str = "Me";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    pub id: ProfileId,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Csv,
    Pdf,
    Ofx,
    Bank,
    Manual,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::Csv => "csv",
            SourceKind::Pdf => "pdf",
            SourceKind::Ofx => "ofx",
            SourceKind::Bank => "bank",
            SourceKind::Manual => "manual",
        }
    }

    fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "csv" => SourceKind::Csv,
            "pdf" => SourceKind::Pdf,
            "ofx" => SourceKind::Ofx,
            "bank" => SourceKind::Bank,
            "manual" => SourceKind::Manual,
            other => return Err(CoreError::Invalid(format!("unknown source kind {other}"))),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Source {
    pub id: SourceId,
    pub profile_id: ProfileId,
    pub name: String,
    pub kind: SourceKind,
    pub institution: Option<String>,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSource {
    pub profile_id: ProfileId,
    pub name: String,
    pub kind: SourceKind,
    pub institution: Option<String>,
}

/// Make sure the default profile exists. Called once per open.
pub fn ensure_default(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO profiles (name, sort_order) VALUES (?1, 0)",
        [DEFAULT_PROFILE_NAME],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> Result<Vec<Profile>> {
    let mut stmt =
        conn.prepare("SELECT id, name, color, sort_order FROM profiles ORDER BY sort_order, id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Profile {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            sort_order: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn create(conn: &Connection, name: &str, color: Option<&str>) -> Result<ProfileId> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("profile name is empty".into()));
    }
    let next: i64 = conn.query_row(
        "SELECT coalesce(max(sort_order), 0) + 1 FROM profiles",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO profiles (name, color, sort_order) VALUES (?1, coalesce(?2, '#5b8cff'), ?3)",
        params![name, color, next],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: ProfileId, name: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE profiles SET name = ?1 WHERE id = ?2",
        params![name.trim(), id],
    )?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("profile {id}")));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: ProfileId) -> Result<()> {
    conn.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    Ok(())
}

pub fn create_source(conn: &Connection, src: &NewSource) -> Result<SourceId> {
    conn.execute(
        "INSERT INTO sources (profile_id, name, kind, institution) VALUES (?1, ?2, ?3, ?4)",
        params![
            src.profile_id,
            src.name.trim(),
            src.kind.as_str(),
            src.institution
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Return the source with this name for the profile, creating it if needed.
pub fn find_or_create_source(
    conn: &Connection,
    profile_id: ProfileId,
    name: &str,
    kind: SourceKind,
) -> Result<SourceId> {
    let existing: Option<SourceId> = conn
        .query_row(
            "SELECT id FROM sources WHERE profile_id = ?1 AND name = ?2",
            params![profile_id, name.trim()],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        Some(id) => Ok(id),
        None => create_source(
            conn,
            &NewSource {
                profile_id,
                name: name.to_string(),
                kind,
                institution: institution_for(name).map(str::to_string),
            },
        ),
    }
}

pub fn list_sources(conn: &Connection, profile_id: ProfileId) -> Result<Vec<Source>> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, name, kind, institution, currency FROM sources WHERE profile_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([profile_id], |r| {
        let kind: String = r.get(3)?;
        Ok((
            Source {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                name: r.get(2)?,
                kind: SourceKind::Csv,
                institution: r.get(4)?,
                currency: r.get(5)?,
            },
            kind,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (mut src, kind) = row?;
        src.kind = SourceKind::parse(&kind)?;
        out.push(src);
    }
    Ok(out)
}

/// Every source across all profiles, for building lookups in the UI.
pub fn list_all_sources(conn: &Connection) -> Result<Vec<Source>> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, name, kind, institution, currency FROM sources ORDER BY profile_id, id",
    )?;
    let rows = stmt.query_map([], |r| {
        let kind: String = r.get(3)?;
        Ok((
            Source {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                name: r.get(2)?,
                kind: SourceKind::Csv,
                institution: r.get(4)?,
                currency: r.get(5)?,
            },
            kind,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (mut src, kind) = row?;
        src.kind = SourceKind::parse(&kind)?;
        out.push(src);
    }
    Ok(out)
}

/// Known banks by the words their statement folders and sources use.
const INSTITUTIONS: &[(&str, &str)] = &[
    ("amex", "American Express"),
    ("americanexpress", "American Express"),
    ("citi", "Citi"),
    ("chase", "Chase"),
    ("capitalone", "Capital One"),
    ("wellsfargo", "Wells Fargo"),
    ("bankofamerica", "Bank of America"),
    ("boa", "Bank of America"),
    ("discover", "Discover"),
    ("usbank", "U.S. Bank"),
    ("schwab", "Charles Schwab"),
    ("fidelity", "Fidelity"),
    ("apple", "Apple Card"),
];

/// The bank behind a source, inferred from its name ("Amex Gold" -> American Express).
pub fn institution_for(name: &str) -> Option<&'static str> {
    let squashed: String = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    INSTITUTIONS
        .iter()
        .find(|(word, _)| squashed.starts_with(word))
        .map(|(_, bank)| *bank)
}

/// Fill in the bank for sources that have none. Never overwrites a value.
pub fn backfill_institutions(conn: &Connection) -> Result<()> {
    let missing: Vec<(SourceId, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, name FROM sources WHERE institution IS NULL OR institution = ''",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    for (id, name) in missing {
        if let Some(bank) = institution_for(&name) {
            conn.execute(
                "UPDATE sources SET institution = ?1 WHERE id = ?2",
                params![bank, id],
            )?;
        }
    }
    Ok(())
}
