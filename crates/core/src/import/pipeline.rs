//! The import pipeline: parsed rows -> categorized, de-duplicated transactions.

use super::csv::{parse_csv_from, CsvLayout};
use super::ofx::parse_ofx;
use super::pdf::{parse_pdf, PdfStatementKind, PdfText};
use super::{source_from_path, ParsedRow};
use crate::analytics::refunds;
use crate::categories;
use crate::categorize::{extract_merchant, heuristics, learning, rules};
use crate::error::Result;
use crate::profiles::{self, ProfileId, SourceId, SourceKind};
use crate::transactions::{self, InsertOutcome, NewTransaction};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// What kind of account a statement describes; decides how credits are read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatementKind {
    /// Credit card: money in is a payment toward the bill or a refund.
    Card,
    /// Checking or savings: money in is income, money out may be a card payment.
    Checking,
    /// Unknown: money in is income, money out is spending.
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportReport {
    pub import_id: Option<i64>,
    pub source_id: SourceId,
    pub source_name: String,
    pub inserted: usize,
    pub duplicates: usize,
    pub skipped: usize,
    /// The same file (by content hash) was imported into this source before.
    pub already_imported: bool,
}

pub fn content_hash(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

/// Category for one row: explicit rules, then the learned model, then keyword heuristics.
pub fn categorize(
    conn: &Connection,
    profile_id: ProfileId,
    source_id: SourceId,
    kind: StatementKind,
    row: &ParsedRow,
) -> Result<Option<i64>> {
    let merchant = extract_merchant(&row.description);
    if let Some(id) = rules::apply(
        conn,
        &rules::RuleInput {
            description: &row.description,
            merchant: &merchant,
            amount_cents: row.amount_cents,
            source_id,
        },
    )? {
        return Ok(Some(id));
    }
    if let Some(s) = learning::suggest(conn, &merchant, Some(profile_id))? {
        return Ok(Some(s.category_id));
    }
    let legacy = if row.amount_cents > 0 {
        match kind {
            StatementKind::Card => heuristics::credit_category(&row.description),
            StatementKind::Checking | StatementKind::Generic => {
                heuristics::income_category(&row.description)
            }
        }
    } else if kind == StatementKind::Checking && heuristics::is_card_payment(&row.description) {
        "Payment"
    } else {
        heuristics::spending_category(&row.description)
    };
    Ok(categories::find_by_legacy_name(conn, legacy)?.map(|c| c.id))
}

/// Store parsed rows for a source. Re-importing the same file content is a no-op.
pub fn import_rows(
    conn: &Connection,
    profile_id: ProfileId,
    source_id: SourceId,
    file_name: &str,
    file_hash: &str,
    kind: StatementKind,
    rows: Vec<ParsedRow>,
) -> Result<ImportReport> {
    let source_name: String =
        conn.query_row("SELECT name FROM sources WHERE id = ?1", [source_id], |r| {
            r.get(0)
        })?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM imports WHERE source_id = ?1 AND file_hash = ?2",
            params![source_id, file_hash],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(import_id) = existing {
        return Ok(ImportReport {
            import_id: Some(import_id),
            source_id,
            source_name,
            inserted: 0,
            duplicates: rows.len(),
            skipped: 0,
            already_imported: true,
        });
    }
    conn.execute(
        "INSERT INTO imports (source_id, file_name, file_hash) VALUES (?1, ?2, ?3)",
        params![source_id, file_name, file_hash],
    )?;
    let import_id = conn.last_insert_rowid();

    let mut inserted = 0;
    let mut duplicates = 0;
    for row in &rows {
        let category_id = categorize(conn, profile_id, source_id, kind, row)?;
        let tx = NewTransaction {
            profile_id,
            source_id,
            posted_on: row.posted_on,
            description: row.description.clone(),
            amount_cents: row.amount_cents,
            currency: "USD".into(),
            occurrence: row.occurrence,
            category_id,
            import_id: Some(import_id),
        };
        let id = match transactions::insert(conn, &tx)? {
            InsertOutcome::Inserted(id) => {
                inserted += 1;
                id
            }
            InsertOutcome::Duplicate(id) => {
                duplicates += 1;
                id
            }
        };
        // A richer export of rows already stored fills in their details (only where none yet).
        transactions::set_details_if_empty(conn, id, &row.details)?;
    }
    conn.execute(
        "UPDATE imports SET imported_rows = ?1, skipped_rows = ?2 WHERE id = ?3",
        params![inserted as i64, duplicates as i64, import_id],
    )?;
    if inserted > 0 {
        refunds::rematch(conn, Some(profile_id))?;
        crate::recurrings::after_import(conn)?;
    }
    Ok(ImportReport {
        import_id: Some(import_id),
        source_id,
        source_name,
        inserted,
        duplicates,
        skipped: 0,
        already_imported: false,
    })
}

/// Give rows already stored the statement details from `rows`, where they have none.
fn fill_details(
    conn: &Connection,
    profile_id: ProfileId,
    source_id: SourceId,
    rows: &[ParsedRow],
) -> Result<()> {
    for row in rows.iter().filter(|r| !r.details.is_empty()) {
        let probe = NewTransaction {
            profile_id,
            source_id,
            posted_on: row.posted_on,
            description: row.description.clone(),
            amount_cents: row.amount_cents,
            currency: "USD".into(),
            occurrence: row.occurrence,
            category_id: None,
            import_id: None,
        };
        let hash = transactions::dedupe_hash(&probe);
        let id: Option<i64> = conn
            .query_row(
                "SELECT id FROM transactions WHERE dedupe_hash = ?1",
                [&hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = id {
            transactions::set_details_if_empty(conn, id, &row.details)?;
        }
    }
    Ok(())
}

/// If this exact file was imported before under any source of the profile,
/// the report for "already imported" (no new rows); otherwise `None`.
fn already_imported_anywhere(
    conn: &Connection,
    profile_id: ProfileId,
    file_hash: &str,
    rows: usize,
) -> Result<Option<ImportReport>> {
    let found: Option<(i64, SourceId, String)> = conn
        .query_row(
            "SELECT i.id, s.id, s.name FROM imports i JOIN sources s ON s.id = i.source_id
             WHERE s.profile_id = ?1 AND i.file_hash = ?2 ORDER BY i.id LIMIT 1",
            params![profile_id, file_hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    Ok(
        found.map(|(import_id, source_id, source_name)| ImportReport {
            import_id: Some(import_id),
            source_id,
            source_name,
            inserted: 0,
            duplicates: rows,
            skipped: 0,
            already_imported: true,
        }),
    )
}

/// Parse and import a CSV file. The source is taken from the path (`Statements/<User>/<Bank>/file`).
pub fn import_csv(
    conn: &Connection,
    profile_id: ProfileId,
    path: &str,
    text: &str,
) -> Result<ImportReport> {
    let (_, from_path) = source_from_path(path);
    let amex_folder = {
        let name = from_path.to_lowercase();
        name.contains("amex") || name.contains("american express")
    };
    let parsed = parse_csv_from(text, amex_folder)?;
    let hash = content_hash(text.as_bytes());
    // The same file already imported under any source of this profile: nothing new to add,
    // but details an older version didn't keep are filled in.
    if let Some(report) = already_imported_anywhere(conn, profile_id, &hash, parsed.rows.len())? {
        fill_details(conn, profile_id, report.source_id, &parsed.rows)?;
        return Ok(report);
    }
    // A bare file name says nothing about the bank; the statement layout does.
    let source_name = match (from_path.as_str(), parsed.layout) {
        ("Imported", CsvLayout::Amex) => "Amex".to_string(),
        ("Imported", CsvLayout::CitiCostco) => "Citi-Costco".to_string(),
        _ => from_path,
    };
    let source_id =
        profiles::find_or_create_source(conn, profile_id, &source_name, SourceKind::Csv)?;
    let kind = match parsed.layout {
        CsvLayout::Amex | CsvLayout::CitiCostco => StatementKind::Card,
        CsvLayout::Generic => StatementKind::Generic,
    };
    let file_name = path.rsplit('/').next().unwrap_or(path);
    let mut report = import_rows(
        conn,
        profile_id,
        source_id,
        file_name,
        &hash,
        kind,
        parsed.rows,
    )?;
    report.skipped = parsed.skipped;
    Ok(report)
}

/// Import positioned PDF text extracted in the webview.
pub fn import_pdf(
    conn: &Connection,
    profile_id: ProfileId,
    path: &str,
    doc: &PdfText,
    file_hash: &str,
) -> Result<ImportReport> {
    let parsed = parse_pdf(doc)?;
    let (_, source_name) = source_from_path(path);
    let source_id =
        profiles::find_or_create_source(conn, profile_id, &source_name, SourceKind::Pdf)?;
    let kind = match parsed.kind {
        PdfStatementKind::CitiCard => StatementKind::Card,
        PdfStatementKind::CitiChecking => StatementKind::Checking,
    };
    import_rows(
        conn,
        profile_id,
        source_id,
        &doc.filename,
        file_hash,
        kind,
        parsed.rows,
    )
}

/// Import an OFX/QFX file. Credit card files carry CCSTMTRS; everything else is treated as checking.
pub fn import_ofx(
    conn: &Connection,
    profile_id: ProfileId,
    path: &str,
    text: &str,
) -> Result<ImportReport> {
    let parsed = parse_ofx(text)?;
    let (_, source_name) = source_from_path(path);
    let source_id =
        profiles::find_or_create_source(conn, profile_id, &source_name, SourceKind::Ofx)?;
    let kind = if text.contains("<CCSTMTRS>") {
        StatementKind::Card
    } else {
        StatementKind::Checking
    };
    let file_name = path.rsplit('/').next().unwrap_or(path);
    let mut report = import_rows(
        conn,
        profile_id,
        source_id,
        file_name,
        &content_hash(text.as_bytes()),
        kind,
        parsed.rows,
    )?;
    report.skipped = parsed.skipped;
    Ok(report)
}
