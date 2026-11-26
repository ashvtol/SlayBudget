//! The import pipeline: parsed rows -> categorized, de-duplicated transactions.

use super::csv::{parse_csv_from, CsvLayout};
use super::ofx::parse_ofx;
use super::pdf::{parse_pdf, PdfStatementKind, PdfText};
use super::{source_from_path, ParsedRow};
use crate::analytics::refunds;
use crate::categories;
use crate::categorize::model::{self, Band};
use crate::categorize::recategorize::bank_category_suggestion;
use crate::categorize::{extract_merchant, heuristics, learning, rules, transfers};
use crate::error::Result;
use crate::profiles::{self, ProfileId, SourceId, SourceKind};
use crate::settings;
use crate::transactions::{self, CategorySource, InsertOutcome, NewTransaction};
use chrono::NaiveDate;
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
    /// Rows that look like ones you already had (tagged "Possible duplicate"), for the results to show.
    #[serde(default)]
    pub flags: Vec<crate::duplicates::DuplicateFlag>,
    /// Set when the file's account couldn't be recognized: nothing was imported; ask, then import with a choice.
    #[serde(default)]
    pub needs_account: Option<crate::accounts::NeedsAccount>,
}

pub fn content_hash(content: &[u8]) -> String {
    hex::encode(Sha256::digest(content))
}

/// How one row was categorized: the category, where it came from and why, and a category to check if one fits better.
#[derive(Debug, Clone, PartialEq)]
pub struct Choice {
    pub category_id: Option<i64>,
    pub source: CategorySource,
    pub reason: Option<String>,
    pub suggested: Option<(i64, String)>,
}

/// Category for one row: your rules, then a merchant you categorized, then the classifier when it is sure (and
/// automatic categorizing is on), then the bank's own category, then keywords. A guess that is not sure enough, or a
/// merchant that only resembles one you categorized, becomes a suggestion instead.
pub fn categorize(
    conn: &Connection,
    profile_id: ProfileId,
    source_id: SourceId,
    kind: StatementKind,
    row: &ParsedRow,
) -> Result<Choice> {
    let merchant = extract_merchant(&row.description);
    let choice = |category_id: Option<i64>, source, reason: Option<String>| Choice {
        category_id,
        source,
        reason,
        suggested: None,
    };
    if let Some(id) = rules::apply(
        conn,
        &rules::RuleInput {
            description: &row.description,
            merchant: &merchant,
            amount_cents: row.amount_cents,
            source_id,
        },
    )? {
        return Ok(choice(
            Some(id),
            CategorySource::Rule,
            Some("Matches one of your rules".into()),
        ));
    }
    // Payment apps and gas stations differ payment to payment: no learned merchant, and the classifier only suggests.
    let platform = crate::categorize::is_payment_platform(&merchant)
        || crate::categorize::is_payment_platform(&row.description);
    let learned = if platform {
        None
    } else {
        learning::suggest(conn, &merchant, Some(profile_id))?
    };
    if let Some(s) = learned.as_ref().filter(|s| s.score >= 1.0) {
        let name = categories::get(conn, s.category_id)?.name;
        let reason = format!("You put {} in {name}", model::title(&merchant));
        return Ok(choice(
            Some(s.category_id),
            CategorySource::Learned,
            Some(reason),
        ));
    }
    let account = crate::accounts::account_kind(conn, source_id)?;
    let features = model::features(&row.description, &merchant, row.amount_cents, account);
    let prediction = model::classify(conn, &merchant, &features)?;
    let auto = settings::get(conn, "auto_categorize")?.as_deref() != Some("0");
    let mut chosen = match &prediction {
        Some(p) if auto && !platform && model::band(p) == Band::Auto => {
            let reason = model::explain(conn, &merchant, p.category_id)?;
            choice(Some(p.category_id), CategorySource::Model, Some(reason))
        }
        _ => fallback(conn, kind, row)?,
    };
    // A guess that is not sure enough only helps where there is no category yet.
    if chosen.source != CategorySource::Model
        && crate::categorize::history::in_other(conn, chosen.category_id)?
    {
        if let Some(p) = prediction.filter(|p| model::band(p) != Band::None) {
            if Some(p.category_id) != chosen.category_id {
                chosen.suggested = Some((
                    p.category_id,
                    model::explain(conn, &merchant, p.category_id)?,
                ));
            }
        }
    }
    if chosen.suggested.is_none() {
        if let Some(s) = learned.filter(|s| Some(s.category_id) != chosen.category_id) {
            let name = categories::get(conn, s.category_id)?.name;
            let reason = format!(
                "Similar to {}, which you put in {name}",
                model::title(&s.matched)
            );
            chosen.suggested = Some((s.category_id, reason));
        }
    }
    Ok(chosen)
}

/// Keywords, or the bank's own category when keywords find nothing for money going out. The keyword list is more
/// specific than banks' categories (Digital Entertainment, not Entertainment), and money in on a card is a refund.
fn fallback(conn: &Connection, kind: StatementKind, row: &ParsedRow) -> Result<Choice> {
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
    let keyword = categories::find_by_legacy_name(conn, legacy)?;
    let nothing = keyword
        .as_ref()
        .is_none_or(|c| c.legacy_name.as_deref() == Some("Other"));
    if nothing && row.amount_cents < 0 {
        let bank = row.raw_category.clone().or_else(|| {
            row.details
                .iter()
                .find(|(label, _)| label == "Category")
                .map(|(_, v)| v.clone())
        });
        if let Some(bank) = bank.filter(|b| !b.trim().is_empty()) {
            if let Some(id) = bank_category_suggestion(conn, &bank)? {
                return Ok(Choice {
                    category_id: Some(id),
                    source: CategorySource::Bank,
                    reason: Some(format!("Your bank calls it {}", bank.trim())),
                    suggested: None,
                });
            }
        }
    }
    Ok(Choice {
        category_id: keyword.map(|c| c.id),
        source: CategorySource::Keyword,
        reason: None,
        suggested: None,
    })
}

/// Days apart two sides of a transfer may be (setting `transfer_window_days`, 1 to 10, default 4).
pub fn transfer_window(conn: &Connection) -> Result<i64> {
    Ok(settings::get(conn, "transfer_window_days")?
        .and_then(|v| v.parse::<i64>().ok())
        .map(|d| d.clamp(1, 10))
        .unwrap_or(4))
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
            flags: Vec::new(),
            needs_account: None,
        });
    }
    conn.execute(
        "INSERT INTO imports (source_id, file_name, file_hash) VALUES (?1, ?2, ?3)",
        params![source_id, file_name, file_hash],
    )?;
    let import_id = conn.last_insert_rowid();

    let mut inserted = 0;
    let mut duplicates = 0;
    let mut new_ids = Vec::new();
    let mut accounted_ids = Vec::new();
    for row in &rows {
        let choice = categorize(conn, profile_id, source_id, kind, row)?;
        let category_id = choice.category_id;
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
                new_ids.push(id);
                let (suggested, why) = choice.suggested.unzip();
                conn.execute(
                    "UPDATE transactions SET category_source = ?1, category_reason = ?2, suggested_category_id = ?3,
                        suggested_reason = ?4 WHERE id = ?5",
                    params![choice.source.as_str(), choice.reason, suggested, why, id],
                )?;
                id
            }
            InsertOutcome::Duplicate(id) => {
                duplicates += 1;
                accounted_ids.push(id);
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
    let mut flags = Vec::new();
    if inserted > 0 {
        let pairs =
            transfers::find_pairs(conn, profile_id, Some(&new_ids), transfer_window(conn)?)?;
        transfers::apply_pairs(conn, &pairs)?;
        refunds::rematch(conn, Some(profile_id))?;
        crate::recurrings::after_import(conn)?;
        // A credit that pays back a charge counts in the charge's category.
        crate::credits::follow_charges(conn)?;
        flags = crate::duplicates::detect(conn, import_id, &new_ids, &accounted_ids)?;
    }
    Ok(ImportReport {
        import_id: Some(import_id),
        source_id,
        source_name,
        inserted,
        duplicates,
        skipped: 0,
        already_imported: false,
        flags,
        needs_account: None,
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
            flags: Vec::new(),
            needs_account: None,
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

/// Import an OFX/QFX/QBO or QIF file. Credit card files say so; everything else is treated as checking.
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
    let kind = if super::ofx::is_card(text) {
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

/// A statement file's content, as the app reads it.
pub enum StatementFile<'a> {
    Csv(&'a str),
    Ofx(&'a str),
    Pdf { doc: &'a PdfText, hash: &'a str },
}

/// Import a statement into the account it belongs to: the one you chose, or the one its clues point to. When the
/// account can't be recognized and you haven't chosen, nothing is imported and the report says `needs_account`.
pub fn import_file(
    conn: &Connection,
    profile_id: ProfileId,
    path: &str,
    file: StatementFile<'_>,
    choice: Option<crate::accounts::Choice>,
) -> Result<ImportReport> {
    use crate::accounts::{self, Choice, NeedsAccount, Preview, Recognized, SampleRow};
    use crate::import::clues;

    let (clues, hash, source_kind) = match &file {
        StatementFile::Csv(text) => (
            clues::from_csv(path, text),
            content_hash(text.as_bytes()),
            SourceKind::Csv,
        ),
        StatementFile::Ofx(text) => (
            clues::from_ofx(path, text),
            content_hash(text.as_bytes()),
            SourceKind::Ofx,
        ),
        StatementFile::Pdf { doc, hash } => {
            let text: Vec<String> = doc
                .lines
                .iter()
                .map(|l| {
                    l.items
                        .iter()
                        .map(|i| i.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();
            (
                clues::from_pdf(path, &text.join("\n")),
                hash.to_string(),
                SourceKind::Pdf,
            )
        }
    };
    let amex_clue = clues.bank.as_deref() == Some("American Express");
    // Rows, the statement kind and rows skipped, read as a given kind of account.
    let read = |amex: bool,
                account_type: Option<&str>|
     -> Result<(Vec<ParsedRow>, StatementKind, usize)> {
        Ok(match &file {
            StatementFile::Csv(text) => {
                let parsed = parse_csv_from(text, amex)?;
                let kind = match parsed.layout {
                    CsvLayout::Amex | CsvLayout::CitiCostco => StatementKind::Card,
                    CsvLayout::Generic => match account_type {
                        Some("card") => StatementKind::Card,
                        Some("checking") | Some("savings") => StatementKind::Checking,
                        _ => StatementKind::Generic,
                    },
                };
                (parsed.rows, kind, parsed.skipped)
            }
            StatementFile::Ofx(text) => {
                let parsed = parse_ofx(text)?;
                let kind = if super::ofx::is_card(text) {
                    StatementKind::Card
                } else {
                    StatementKind::Checking
                };
                (parsed.rows, kind, parsed.skipped)
            }
            StatementFile::Pdf { doc, .. } => {
                let parsed = parse_pdf(doc)?;
                let kind = match parsed.kind {
                    PdfStatementKind::CitiCard => StatementKind::Card,
                    PdfStatementKind::CitiChecking => StatementKind::Checking,
                };
                (parsed.rows, kind, 0)
            }
        })
    };
    let (rows, _, _) = read(amex_clue, None)?;
    // The same file imported before: nothing to ask, nothing new.
    if let Some(report) = already_imported_anywhere(conn, profile_id, &hash, rows.len())? {
        if let StatementFile::Csv(_) = file {
            fill_details(conn, profile_id, report.source_id, &rows)?;
        }
        return Ok(report);
    }

    let (source_id, remember) = match choice {
        Some(Choice::Existing {
            source_id,
            remember,
        }) => (source_id, remember),
        Some(Choice::New { account, remember }) => (
            accounts::create(conn, profile_id, source_kind, &account)?,
            remember,
        ),
        None => match accounts::recognize(conn, profile_id, &clues)? {
            Recognized::Account(id) => (id, true),
            Recognized::Ask(guess) => {
                let mut dates: Vec<NaiveDate> = rows.iter().map(|r| r.posted_on).collect();
                dates.sort();
                let preview = Preview {
                    rows: rows.len(),
                    first: dates.first().map(|d| d.to_string()),
                    last: dates.last().map(|d| d.to_string()),
                    sample: rows
                        .iter()
                        .take(3)
                        .map(|r| SampleRow {
                            posted_on: r.posted_on.to_string(),
                            description: r.description.clone(),
                            amount_cents: r.amount_cents,
                        })
                        .collect(),
                };
                return Ok(ImportReport {
                    import_id: None,
                    source_id: 0,
                    source_name: String::new(),
                    inserted: 0,
                    duplicates: 0,
                    skipped: 0,
                    already_imported: false,
                    flags: Vec::new(),
                    needs_account: Some(NeedsAccount {
                        suggested_name: accounts::suggested_name(&clues),
                        clues,
                        guess,
                        preview,
                    }),
                });
            }
        },
    };
    if remember {
        accounts::remember(conn, source_id, &clues)?;
    }
    let amex = amex_clue || accounts::is_amex(conn, source_id)?;
    let account_type = accounts::account_type(conn, source_id)?;
    let (rows, kind, skipped) = read(amex, account_type.as_deref())?;
    let file_name = match &file {
        StatementFile::Pdf { doc, .. } => doc.filename.clone(),
        _ => path.rsplit(['/', '\\']).next().unwrap_or(path).to_string(),
    };
    let mut report = import_rows(conn, profile_id, source_id, &file_name, &hash, kind, rows)?;
    report.skipped = skipped;
    if let Some(import_id) = report.import_id.filter(|_| !report.already_imported) {
        accounts::tag_import(conn, source_id, import_id)?;
    }
    Ok(report)
}
