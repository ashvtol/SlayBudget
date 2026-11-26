//! Transactions repository: insert with dedupe, filtered listing, updates.

use crate::categorize::extract_merchant;
use crate::error::{CoreError, Result};
use crate::profiles::{ProfileId, SourceId};
use chrono::NaiveDate;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub type TransactionId = i64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTransaction {
    pub profile_id: ProfileId,
    pub source_id: SourceId,
    pub posted_on: NaiveDate,
    pub description: String,
    /// Negative is money out, positive is money in.
    pub amount_cents: i64,
    pub currency: String,
    /// Index of this transaction among identical (date, amount, description) rows in one file.
    pub occurrence: u32,
    pub category_id: Option<i64>,
    pub import_id: Option<i64>,
}

/// Copilot's transaction types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxType {
    #[default]
    Regular,
    Income,
    Transfer,
}

impl TxType {
    pub fn as_str(self) -> &'static str {
        match self {
            TxType::Regular => "regular",
            TxType::Income => "income",
            TxType::Transfer => "transfer",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "income" => TxType::Income,
            "transfer" => TxType::Transfer,
            _ => TxType::Regular,
        }
    }
}

/// Where a transaction's category came from. Automatic changes never touch `User` (or a locked row).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategorySource {
    /// You chose it (or reviewed the row before this was tracked).
    User,
    Rule,
    /// The merchant you put in this category before.
    Learned,
    /// The learning classifier.
    Model,
    /// Paired with the other side of money moved between your accounts.
    Transfer,
    /// The bank's own category.
    Bank,
    /// Pays a charge back (a statement credit or a refund): the charge's category.
    Credit,
    #[default]
    Keyword,
}

impl CategorySource {
    pub fn as_str(self) -> &'static str {
        match self {
            CategorySource::User => "user",
            CategorySource::Rule => "rule",
            CategorySource::Learned => "learned",
            CategorySource::Model => "model",
            CategorySource::Transfer => "transfer",
            CategorySource::Bank => "bank",
            CategorySource::Credit => "credit",
            CategorySource::Keyword => "keyword",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "user" => CategorySource::User,
            "rule" => CategorySource::Rule,
            "learned" => CategorySource::Learned,
            "model" => CategorySource::Model,
            "transfer" => CategorySource::Transfer,
            "bank" => CategorySource::Bank,
            "credit" => CategorySource::Credit,
            _ => CategorySource::Keyword,
        }
    }
}

/// SQL for the type a category implies (its kind), given a placeholder or column for its id.
pub(crate) fn type_of_category_sql(id: &str) -> String {
    format!(
        "COALESCE((SELECT CASE kind WHEN 'income' THEN 'income' WHEN 'transfer' THEN 'transfer' ELSE 'regular' END FROM categories WHERE id = {id}), 'regular')"
    )
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Transaction {
    pub id: TransactionId,
    pub profile_id: ProfileId,
    pub source_id: SourceId,
    pub posted_on: NaiveDate,
    pub description: String,
    pub merchant: String,
    pub amount_cents: i64,
    pub currency: String,
    pub category_id: Option<i64>,
    pub category_locked: bool,
    pub reviewed: bool,
    pub notes: Option<String>,
    pub refund_of: Option<TransactionId>,
    pub parent_id: Option<TransactionId>,
    pub tx_type: TxType,
    /// The saved recurring bill this charge belongs to.
    pub recurring_id: Option<i64>,
    /// Tags on this row, by id ascending.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    #[serde(default)]
    pub category_source: CategorySource,
    /// Why an automatic category was chosen ("Like 6 others you put in Coffee Shop").
    #[serde(default)]
    pub category_reason: Option<String>,
    /// A category to check, and why.
    #[serde(default)]
    pub suggested_category_id: Option<i64>,
    #[serde(default)]
    pub suggested_reason: Option<String>,
    /// The other side of a transfer between your own accounts.
    #[serde(default)]
    pub transfer_pair_id: Option<TransactionId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum InsertOutcome {
    Inserted(TransactionId),
    Duplicate(TransactionId),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionFilter {
    /// `None` means the combined view across all profiles.
    pub profile_id: Option<ProfileId>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub category_ids: Vec<i64>,
    pub source_ids: Vec<i64>,
    pub reviewed: Option<bool>,
    pub text: Option<String>,
    /// Calendar months ("2026-06"); a row matches any of them.
    #[serde(default)]
    pub months: Vec<String>,
    /// Merchant keys; a row matches any of them.
    #[serde(default)]
    pub merchants: Vec<String>,
    /// Transaction types; a row matches any of them.
    #[serde(default)]
    pub types: Vec<TxType>,
    /// Saved recurring bills; a row linked to any of them matches.
    #[serde(default)]
    pub recurring_ids: Vec<i64>,
    /// Tags; a row with any of them matches.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// Only rows with (or without) a suggested category to check.
    #[serde(default)]
    pub suggested: Option<bool>,
    pub limit: Option<i64>,
    pub offset: i64,
}

impl TransactionFilter {
    pub fn for_profile(profile_id: ProfileId) -> Self {
        Self {
            profile_id: Some(profile_id),
            ..Default::default()
        }
    }
    pub fn combined() -> Self {
        Self::default()
    }

    fn where_clause(&self) -> (String, Vec<Value>) {
        let mut clauses = vec!["parent_id IS NULL".to_string()];
        let mut args: Vec<Value> = Vec::new();
        if let Some(p) = self.profile_id {
            clauses.push("profile_id = ?".into());
            args.push(p.into());
        }
        if let Some(from) = self.from {
            clauses.push("posted_on >= ?".into());
            args.push(from.to_string().into());
        }
        if let Some(to) = self.to {
            clauses.push("posted_on <= ?".into());
            args.push(to.to_string().into());
        }
        if !self.category_ids.is_empty() {
            let marks = vec!["?"; self.category_ids.len()].join(",");
            clauses.push(format!("category_id IN ({marks})"));
            args.extend(self.category_ids.iter().map(|&c| Value::from(c)));
        }
        if !self.source_ids.is_empty() {
            let marks = vec!["?"; self.source_ids.len()].join(",");
            clauses.push(format!("source_id IN ({marks})"));
            args.extend(self.source_ids.iter().map(|&s| Value::from(s)));
        }
        if !self.months.is_empty() {
            let marks = vec!["?"; self.months.len()].join(",");
            clauses.push(format!("substr(posted_on, 1, 7) IN ({marks})"));
            args.extend(self.months.iter().map(|m| Value::from(m.clone())));
        }
        if !self.merchants.is_empty() {
            let marks = vec!["?"; self.merchants.len()].join(",");
            clauses.push(format!("merchant IN ({marks})"));
            args.extend(
                self.merchants
                    .iter()
                    .map(|m| Value::from(m.trim().to_lowercase())),
            );
        }
        if !self.recurring_ids.is_empty() {
            let marks = vec!["?"; self.recurring_ids.len()].join(",");
            clauses.push(format!("recurring_id IN ({marks})"));
            args.extend(self.recurring_ids.iter().map(|&i| Value::from(i)));
        }
        if !self.tag_ids.is_empty() {
            let marks = vec!["?"; self.tag_ids.len()].join(",");
            clauses.push(format!(
                "id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN ({marks}))"
            ));
            args.extend(self.tag_ids.iter().map(|&i| Value::from(i)));
        }
        if !self.types.is_empty() {
            let marks = vec!["?"; self.types.len()].join(",");
            clauses.push(format!("type IN ({marks})"));
            args.extend(
                self.types
                    .iter()
                    .map(|t| Value::from(t.as_str().to_string())),
            );
        }
        if let Some(r) = self.reviewed {
            clauses.push("reviewed = ?".into());
            args.push((r as i64).into());
        }
        if let Some(s) = self.suggested {
            clauses.push(
                if s {
                    "suggested_category_id IS NOT NULL"
                } else {
                    "suggested_category_id IS NULL"
                }
                .into(),
            );
        }
        if let Some(text) = self
            .text
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            clauses.push("(description LIKE ? OR merchant LIKE ? OR notes LIKE ?)".into());
            let like = format!("%{text}%");
            args.push(like.clone().into());
            args.push(like.clone().into());
            args.push(like.into());
        }
        (clauses.join(" AND "), args)
    }
}

/// Fields to change; `None` leaves a field alone. Double options clear a value.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionPatch {
    pub category_id: Option<Option<i64>>,
    pub category_locked: Option<bool>,
    pub reviewed: Option<bool>,
    pub notes: Option<Option<String>>,
    pub description: Option<String>,
    pub posted_on: Option<NaiveDate>,
    pub amount_cents: Option<i64>,
}

/// Stable identity of a transaction for de-duplication across re-imports.
pub fn dedupe_hash(tx: &NewTransaction) -> String {
    let normalized: String = tx
        .description
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "{}|{}|{}|{}|{}",
        tx.source_id, tx.posted_on, tx.amount_cents, normalized, tx.occurrence
    ));
    hex::encode(hasher.finalize())
}

pub fn insert(conn: &Connection, tx: &NewTransaction) -> Result<InsertOutcome> {
    if tx.description.trim().is_empty() {
        return Err(CoreError::Invalid(
            "transaction description is empty".into(),
        ));
    }
    let hash = dedupe_hash(tx);
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM transactions WHERE dedupe_hash = ?1",
            [&hash],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(InsertOutcome::Duplicate(id));
    }
    let merchant = extract_merchant(&tx.description);
    conn.execute(
        &format!(
            "INSERT INTO transactions (profile_id, source_id, posted_on, description, merchant, amount_cents, currency, category_id, dedupe_hash, import_id, type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, {})",
            type_of_category_sql("?8")
        ),
        params![
            tx.profile_id,
            tx.source_id,
            tx.posted_on.to_string(),
            tx.description.trim(),
            merchant,
            tx.amount_cents,
            tx.currency,
            tx.category_id,
            hash,
            tx.import_id
        ],
    )?;
    Ok(InsertOutcome::Inserted(conn.last_insert_rowid()))
}

/// The column list in `row_to_tx` order, for queries that build their own FROM.
pub(crate) const SELECT_COLS: &str = "id, profile_id, source_id, posted_on, description, merchant, amount_cents, currency, category_id, category_locked, reviewed, notes, refund_of, parent_id, type, recurring_id, category_source, category_reason, suggested_category_id, suggested_reason, transfer_pair_id";

const SELECT: &str = "SELECT id, profile_id, source_id, posted_on, description, merchant, amount_cents, currency, category_id, category_locked, reviewed, notes, refund_of, parent_id, type, recurring_id, category_source, category_reason, suggested_category_id, suggested_reason, transfer_pair_id FROM transactions";

pub(crate) fn row_to_tx(r: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    let date: String = r.get(3)?;
    Ok(Transaction {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        source_id: r.get(2)?,
        posted_on: NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        description: r.get(4)?,
        merchant: r.get(5)?,
        amount_cents: r.get(6)?,
        currency: r.get(7)?,
        category_id: r.get(8)?,
        category_locked: r.get::<_, i64>(9)? != 0,
        reviewed: r.get::<_, i64>(10)? != 0,
        notes: r.get(11)?,
        refund_of: r.get(12)?,
        parent_id: r.get(13)?,
        tx_type: TxType::parse(&r.get::<_, String>(14)?),
        recurring_id: r.get(15)?,
        tag_ids: Vec::new(),
        category_source: CategorySource::parse(&r.get::<_, String>(16)?),
        category_reason: r.get(17)?,
        suggested_category_id: r.get(18)?,
        suggested_reason: r.get(19)?,
        transfer_pair_id: r.get(20)?,
    })
}

pub fn get(conn: &Connection, id: TransactionId) -> Result<Transaction> {
    let tx = conn
        .query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_tx)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("transaction {id}")))?;
    let mut one = vec![tx];
    fill_tags(conn, &mut one)?;
    Ok(one.pop().expect("one row"))
}

/// Set `tag_ids` on each row from `transaction_tags`, in one query.
pub(crate) fn fill_tags(conn: &Connection, rows: &mut [Transaction]) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let ids = serde_json::to_string(&rows.iter().map(|t| t.id).collect::<Vec<_>>())
        .expect("ids serialize");
    let mut stmt = conn.prepare(
        "SELECT transaction_id, tag_id FROM transaction_tags
         WHERE transaction_id IN (SELECT value FROM json_each(?1)) ORDER BY tag_id",
    )?;
    let mut by_tx: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    for pair in stmt.query_map([ids], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (tx, tag) = pair?;
        by_tx.entry(tx).or_default().push(tag);
    }
    for t in rows.iter_mut() {
        t.tag_ids = by_tx.remove(&t.id).unwrap_or_default();
    }
    Ok(())
}

/// Newest first, then by id descending so same-day rows keep a stable order.
pub fn list(conn: &Connection, filter: &TransactionFilter) -> Result<Vec<Transaction>> {
    let (where_sql, mut args) = filter.where_clause();
    let mut sql = format!("{SELECT} WHERE {where_sql} ORDER BY posted_on DESC, id DESC");
    if let Some(limit) = filter.limit {
        sql.push_str(" LIMIT ? OFFSET ?");
        args.push(limit.into());
        args.push(filter.offset.into());
    }
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), row_to_tx)?;
    let mut rows: Vec<Transaction> = rows.collect::<std::result::Result<_, _>>()?;
    fill_tags(conn, &mut rows)?;
    Ok(rows)
}

pub fn count(conn: &Connection, filter: &TransactionFilter) -> Result<i64> {
    let (where_sql, args) = filter.where_clause();
    Ok(conn.query_row(
        &format!("SELECT count(*) FROM transactions WHERE {where_sql}"),
        params_from_iter(args),
        |r| r.get(0),
    )?)
}

pub fn update(conn: &Connection, id: TransactionId, patch: &TransactionPatch) -> Result<()> {
    if bulk_update(conn, &[id], patch)? == 0 {
        return Err(CoreError::NotFound(format!("transaction {id}")));
    }
    Ok(())
}

/// Apply the same patch to many transactions. Returns how many rows matched.
pub fn bulk_update(
    conn: &Connection,
    ids: &[TransactionId],
    patch: &TransactionPatch,
) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut sets: Vec<&str> = Vec::new();
    let mut args: Vec<Value> = Vec::new();
    let type_sql;
    if let Some(c) = &patch.category_id {
        sets.push("category_id = ?");
        args.push(c.map(Value::from).unwrap_or(Value::Null));
        if let Some(id) = c {
            // Picking a category switches the type with it (Salary makes a row Income).
            type_sql = format!("type = {}", type_of_category_sql(&id.to_string()));
            sets.push(&type_sql);
        }
        // A category you pick is yours: nothing automatic changes it, and any suggestion is answered.
        sets.push(
            "category_source = 'user', category_reason = NULL, suggested_category_id = NULL, suggested_reason = NULL",
        );
    }
    if let Some(l) = patch.category_locked {
        sets.push("category_locked = ?");
        args.push((l as i64).into());
    }
    if let Some(r) = patch.reviewed {
        sets.push("reviewed = ?");
        args.push((r as i64).into());
    }
    if let Some(n) = &patch.notes {
        sets.push("notes = ?");
        args.push(n.clone().map(Value::from).unwrap_or(Value::Null));
    }
    if let Some(d) = &patch.description {
        sets.push("description = ?");
        args.push(d.trim().to_string().into());
        sets.push("merchant = ?");
        args.push(extract_merchant(d).into());
    }
    if let Some(d) = patch.posted_on {
        sets.push("posted_on = ?");
        args.push(d.to_string().into());
    }
    if let Some(a) = patch.amount_cents {
        sets.push("amount_cents = ?");
        args.push(a.into());
    }
    if sets.is_empty() {
        return Ok(ids.len());
    }
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    let marks = vec!["?"; ids.len()].join(",");
    args.extend(ids.iter().map(|&i| Value::from(i)));
    let sql = format!(
        "UPDATE transactions SET {} WHERE id IN ({marks})",
        sets.join(", ")
    );
    Ok(conn.execute(&sql, params_from_iter(args))?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitPart {
    pub amount_cents: i64,
    pub category_id: Option<i64>,
    pub description: Option<String>,
}

/// Divide a transaction into child parts whose amounts sum to the parent's.
/// The parent stays in the list (flagged via its children) and is marked reviewed;
/// children carry the categorized portions and are hidden from the main list.
pub fn split(
    conn: &Connection,
    id: TransactionId,
    parts: &[SplitPart],
) -> Result<Vec<TransactionId>> {
    let parent = get(conn, id)?;
    if parent.parent_id.is_some() {
        return Err(CoreError::Invalid("cannot split a split child".into()));
    }
    if parts.len() < 2 {
        return Err(CoreError::Invalid(
            "a split needs at least two parts".into(),
        ));
    }
    let sum: i64 = parts.iter().map(|p| p.amount_cents).sum();
    if sum != parent.amount_cents {
        return Err(CoreError::Invalid(format!(
            "split parts sum to {sum}, expected {}",
            parent.amount_cents
        )));
    }
    // Replace any previous split.
    conn.execute("DELETE FROM transactions WHERE parent_id = ?1", [id])?;
    let mut ids = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let description = part
            .description
            .clone()
            .unwrap_or_else(|| format!("{} (split {})", parent.description, i + 1));
        let hash = format!("{}::split::{i}", parent.dedupe_hash_source());
        let mut hasher = Sha256::new();
        hasher.update(&hash);
        let dedupe = hex::encode(hasher.finalize());
        // A part takes its category's type, or the parent's when it has no category.
        conn.execute(
            "INSERT INTO transactions (profile_id, source_id, posted_on, description, merchant, amount_cents, currency, category_id, reviewed, parent_id, dedupe_hash, type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10,
                     COALESCE((SELECT CASE kind WHEN 'income' THEN 'income' WHEN 'transfer' THEN 'transfer' ELSE 'regular' END
                               FROM categories WHERE id = ?8), ?11))",
            params![parent.profile_id, parent.source_id, parent.posted_on.to_string(), description, extract_merchant(&description), part.amount_cents, parent.currency, part.category_id, id, dedupe, parent.tx_type.as_str()],
        )?;
        ids.push(conn.last_insert_rowid());
    }
    conn.execute("UPDATE transactions SET reviewed = 1 WHERE id = ?1", [id])?;
    Ok(ids)
}

/// Remove a transaction's split children.
pub fn unsplit(conn: &Connection, id: TransactionId) -> Result<()> {
    conn.execute("DELETE FROM transactions WHERE parent_id = ?1", [id])?;
    Ok(())
}

/// The split children of a transaction, in creation order.
pub fn children(conn: &Connection, id: TransactionId) -> Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE parent_id = ?1 ORDER BY id"))?;
    let rows = stmt.query_map([id], row_to_tx)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

impl Transaction {
    /// Stable string identifying this transaction for deriving child dedupe hashes.
    fn dedupe_hash_source(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.id, self.source_id, self.posted_on, self.amount_cents
        )
    }
}

/// Change the type of several transactions. A category that does not fit the new type is
/// cleared: transfers have none, income keeps only income categories, regular only expense ones.
pub fn set_type(conn: &Connection, ids: &[TransactionId], ty: TxType) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let marks = vec!["?"; ids.len()].join(",");
    let keep_kind = match ty {
        TxType::Regular => "expense",
        TxType::Income => "income",
        TxType::Transfer => "",
    };
    let mut args: Vec<Value> = vec![ty.as_str().to_string().into(), keep_kind.to_string().into()];
    args.extend(ids.iter().map(|&i| Value::from(i)));
    // Split parts follow their parent.
    args.extend(ids.iter().map(|&i| Value::from(i)));
    Ok(conn.execute(
        &format!(
            "UPDATE transactions SET type = ?1,
                category_id = CASE WHEN category_id IN (SELECT id FROM categories WHERE kind = ?2) THEN category_id ELSE NULL END,
                recurring_id = CASE WHEN ?1 = 'regular' THEN recurring_id ELSE NULL END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id IN ({marks}) OR parent_id IN ({marks})"
        ),
        params_from_iter(args),
    )?)
}

/// Where a transaction came from: its statement file and the extra statement columns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatementInfo {
    pub file_name: Option<String>,
    pub imported_at: Option<String>,
    pub source_name: String,
    /// Extra statement columns as (label, value), in file order.
    pub fields: Vec<(String, String)>,
}

/// Keep statement details on a row that has none yet. Returns whether anything was written.
pub fn set_details_if_empty(
    conn: &Connection,
    id: TransactionId,
    details: &[(String, String)],
) -> Result<bool> {
    if details.is_empty() {
        return Ok(false);
    }
    let json = serde_json::to_string(details).expect("details serialize");
    Ok(conn.execute(
        "UPDATE transactions SET details = ?1 WHERE id = ?2 AND (details IS NULL OR details = '[]')",
        params![json, id],
    )? > 0)
}

pub fn statement(conn: &Connection, id: TransactionId) -> Result<StatementInfo> {
    let (file_name, imported_at, source_name, details): (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT i.file_name, i.imported_at, s.name, t.details
             FROM transactions t JOIN sources s ON s.id = t.source_id
             LEFT JOIN imports i ON i.id = t.import_id
             WHERE t.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("transaction {id}")))?;
    let fields = details
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();
    Ok(StatementInfo {
        file_name,
        imported_at,
        source_name,
        fields,
    })
}

/// Delete transactions (and, through the schema, their split parts and tags; refund links to them are cleared).
/// Returns how many of the given rows were removed. All or nothing.
pub fn delete_many(conn: &Connection, ids: &[TransactionId]) -> Result<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    crate::db::atomically(conn, |c| {
        crate::duplicates::before_delete(c, ids)?;
        let mut stmt = c.prepare("DELETE FROM transactions WHERE id = ?1")?;
        let mut removed = 0;
        for id in ids {
            removed += stmt.execute([id])?;
        }
        Ok(removed)
    })
}
