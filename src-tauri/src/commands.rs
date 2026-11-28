//! IPC commands. Each one locks the connection, calls core, and maps errors to `IpcError`.
//! DTOs are camelCase to match the TypeScript client; they convert to core types here.

use crate::AppState;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use slaybudget_core::categories::{
    self, Category, CategoryGroup, CategoryKind, CategoryPatch, DeleteReport, GroupTarget,
    NewCategory,
};
use slaybudget_core::transactions::{
    self, Transaction, TransactionFilter, TransactionPatch, TxType,
};
use slaybudget_core::{profiles, settings, CoreError};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct IpcError {
    pub code: &'static str,
    pub message: String,
}

impl From<CoreError> for IpcError {
    fn from(e: CoreError) -> Self {
        let code = match e {
            CoreError::Db(_) => "db",
            CoreError::Invalid(_) => "invalid",
            CoreError::NotFound(_) => "not_found",
        };
        IpcError {
            code,
            message: e.to_string(),
        }
    }
}

type IpcResult<T> = Result<T, IpcError>;

/// Run one action you took, recorded as one undo step (see `slaybudget_core::undo`).
fn recorded<T>(
    state: &State<'_, AppState>,
    label: String,
    f: impl FnOnce(&rusqlite::Connection) -> slaybudget_core::error::Result<T>,
) -> IpcResult<T> {
    let conn = lock(state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    // Every change ends with credits following their charges (a charge moved to another category takes its credit
    // along), inside the same step, so Undo takes both back.
    let value = stack.record(&conn, &label, |c| {
        let value = f(c)?;
        slaybudget_core::credits::follow_charges(c)?;
        Ok(value)
    });
    show_undo_menu(state, &stack);
    Ok(value?)
}

/// Keep the Edit menu's "Undo …" and "Redo …" in step with the stack.
fn show_undo_menu(state: &State<'_, AppState>, stack: &slaybudget_core::undo::UndoStack) {
    if let Some(menu) = &state.edit_menu {
        menu.show(&stack.state());
    }
}

/// "Change Category" for one row, "Change Category of 3 Transactions" for several.
fn count_label(what: &str, n: usize) -> String {
    if n == 1 {
        return what
            .strip_suffix(" to")
            .or(what.strip_suffix(" from"))
            .unwrap_or(what)
            .to_string();
    }
    let rows = format!("{n} Transactions");
    match what {
        "Mark Reviewed" => format!("Mark {rows} Reviewed"),
        "Mark Unreviewed" => format!("Mark {rows} Unreviewed"),
        w if w.ends_with(" to") || w.ends_with(" from") => format!("{w} {rows}"),
        w => format!("{w} of {rows}"),
    }
}

/// The Edit menu's name for a transaction edit.
fn patch_label(patch: &TxPatchDto, n: usize) -> String {
    let what = if patch.notes.is_some() {
        "Edit Notes"
    } else if patch.category_id.is_some() {
        "Change Category"
    } else if patch.reviewed == Some(true) {
        "Mark Reviewed"
    } else if patch.reviewed == Some(false) {
        "Mark Unreviewed"
    } else {
        "Edit"
    };
    count_label(what, n)
}

/// "amex-nov.csv" from "Statements/Amex/amex-nov.csv".
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn lock<'a>(state: &'a State<'a, AppState>) -> std::sync::MutexGuard<'a, rusqlite::Connection> {
    state
        .db
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn parse_date(s: &str) -> Result<NaiveDate, IpcError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| IpcError {
        code: "invalid",
        message: format!("bad date {s}: {e}"),
    })
}

// ---------- settings and profiles ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDto {
    pub id: i64,
    pub profile_id: i64,
    pub name: String,
    pub kind: String,
    pub institution: Option<String>,
    pub currency: String,
    pub account_type: Option<String>,
    pub color: Option<String>,
    pub default_tag_id: Option<i64>,
}

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> IpcResult<Vec<SourceDto>> {
    let rows = profiles::list_all_sources(&lock(&state))?;
    Ok(rows
        .into_iter()
        .map(|s| SourceDto {
            id: s.id,
            profile_id: s.profile_id,
            name: s.name,
            kind: s.kind.as_str().to_string(),
            institution: s.institution,
            currency: s.currency,
            account_type: s.account_type,
            color: s.color,
            default_tag_id: s.default_tag_id,
        })
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> IpcResult<Option<String>> {
    Ok(settings::get(&lock(&state), &key)?)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> IpcResult<()> {
    let conn = lock(&state);
    settings::set(&conn, &key, &value)?;
    if matches!(key.as_str(), "display_currency" | "fx_basis") {
        slaybudget_core::fx::refresh_display(&conn)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> IpcResult<Vec<ProfileDto>> {
    let rows = profiles::list(&lock(&state))?;
    Ok(rows
        .into_iter()
        .map(|p| ProfileDto {
            id: p.id,
            name: p.name,
            color: p.color,
            sort_order: p.sort_order,
        })
        .collect())
}

#[tauri::command]
pub fn create_profile(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> IpcResult<i64> {
    Ok(profiles::create(&lock(&state), &name, color.as_deref())?)
}

#[tauri::command]
pub fn rename_profile(state: State<'_, AppState>, id: i64, name: String) -> IpcResult<()> {
    Ok(profiles::rename(&lock(&state), id, &name)?)
}

#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(profiles::delete(&lock(&state), id)?)
}

// ---------- transactions ----------

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDto {
    pub profile_id: Option<i64>,
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(default)]
    pub category_ids: Vec<i64>,
    #[serde(default)]
    pub source_ids: Vec<i64>,
    pub reviewed: Option<bool>,
    pub text: Option<String>,
    #[serde(default)]
    pub months: Vec<String>,
    #[serde(default)]
    pub merchants: Vec<String>,
    #[serde(default)]
    pub types: Vec<TxType>,
    #[serde(default)]
    pub recurring_ids: Vec<i64>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    pub suggested: Option<bool>,
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: i64,
}

impl FilterDto {
    fn into_core(self) -> Result<TransactionFilter, IpcError> {
        Ok(TransactionFilter {
            profile_id: self.profile_id,
            from: self.from.as_deref().map(parse_date).transpose()?,
            to: self.to.as_deref().map(parse_date).transpose()?,
            category_ids: self.category_ids,
            source_ids: self.source_ids,
            reviewed: self.reviewed,
            text: self.text,
            months: self.months,
            merchants: self.merchants,
            types: self.types,
            recurring_ids: self.recurring_ids,
            tag_ids: self.tag_ids,
            suggested: self.suggested,
            limit: self.limit,
            offset: self.offset,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionDto {
    pub id: i64,
    pub profile_id: i64,
    pub source_id: i64,
    pub posted_on: String,
    pub description: String,
    pub merchant: String,
    pub amount_cents: i64,
    pub currency: String,
    pub category_id: Option<i64>,
    pub category_locked: bool,
    pub reviewed: bool,
    pub notes: Option<String>,
    pub refund_of: Option<i64>,
    pub tx_type: TxType,
    pub recurring_id: Option<i64>,
    pub tag_ids: Vec<i64>,
    /// The amount and currency it was imported in, when it's shown converted.
    pub original_amount_cents: Option<i64>,
    pub original_currency: Option<String>,
    pub category_source: slaybudget_core::transactions::CategorySource,
    pub category_reason: Option<String>,
    pub suggested_category_id: Option<i64>,
    pub suggested_reason: Option<String>,
    pub transfer_pair_id: Option<i64>,
}

impl TransactionDto {
    /// As the screens show it: in the display currency (at its month's rate), keeping the original.
    pub fn shown(s: &slaybudget_core::fx::Shown, t: Transaction) -> Self {
        let converted = s.transaction(t.amount_cents, &t.currency, t.posted_on);
        let differs = t.currency != s.display.currency;
        let original = differs.then(|| (t.amount_cents, t.currency.clone()));
        let mut dto = TransactionDto::from(t);
        if let Some((cents, currency)) = original {
            dto.amount_cents = converted;
            dto.currency = s.display.currency.clone();
            dto.original_amount_cents = Some(cents);
            dto.original_currency = Some(currency);
        }
        dto
    }
}

/// Split parts typed in the display currency, in the transaction's own currency (adding up to it exactly).
fn parts_back(s: &slaybudget_core::fx::Shown, parent: &Transaction, typed: &[i64]) -> Vec<i64> {
    if parent.currency == s.display.currency {
        return typed.to_vec();
    }
    let mut out: Vec<i64> = typed
        .iter()
        .map(|c| {
            slaybudget_core::fx::from_display(&s.display, *c, &parent.currency, parent.posted_on)
        })
        .collect();
    if let Some(last) = out.len().checked_sub(1) {
        let rest: i64 = out[..last].iter().sum();
        out[last] = parent.amount_cents - rest;
    }
    out
}

/// A recurring bill's amounts, shown.
fn recurring_shown(s: &slaybudget_core::fx::Shown, mut r: Recurring) -> Recurring {
    r.typical_amount_cents = s.charge(r.typical_amount_cents);
    if let Some(saved) = r.saved.as_mut() {
        saved.min_cents = s.charge(saved.min_cents);
        saved.max_cents = s.charge(saved.max_cents);
    }
    r
}
fn rule_shown(s: &slaybudget_core::fx::Shown, mut r: NewRecurring) -> NewRecurring {
    r.min_cents = s.charge(r.min_cents);
    r.max_cents = s.charge(r.max_cents);
    r
}
fn rule_back(s: &slaybudget_core::fx::Shown, mut r: NewRecurring) -> NewRecurring {
    r.min_cents = s.charge_back(r.min_cents);
    r.max_cents = s.charge_back(r.max_cents);
    r
}

impl From<Transaction> for TransactionDto {
    fn from(t: Transaction) -> Self {
        TransactionDto {
            id: t.id,
            profile_id: t.profile_id,
            source_id: t.source_id,
            posted_on: t.posted_on.to_string(),
            description: t.description,
            merchant: t.merchant,
            amount_cents: t.amount_cents,
            currency: t.currency,
            category_id: t.category_id,
            category_locked: t.category_locked,
            reviewed: t.reviewed,
            notes: t.notes,
            refund_of: t.refund_of,
            tx_type: t.tx_type,
            recurring_id: t.recurring_id,
            tag_ids: t.tag_ids,
            original_amount_cents: None,
            original_currency: None,
            category_source: t.category_source,
            category_reason: t.category_reason,
            suggested_category_id: t.suggested_category_id,
            suggested_reason: t.suggested_reason,
            transfer_pair_id: t.transfer_pair_id,
        }
    }
}

/// Patch DTO. `serde(default)` plus `Option` cannot tell "absent" from "null", so each
/// field is wrapped: outer `Option` = present in the request, inner carries the value.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxPatchDto {
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<i64>>,
    pub category_locked: Option<bool>,
    pub reviewed: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
}

fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::deserialize(de)?))
}

impl TxPatchDto {
    fn into_core(self) -> TransactionPatch {
        TransactionPatch {
            category_id: self.category_id,
            category_locked: self.category_locked,
            reviewed: self.reviewed,
            notes: self.notes,
            description: None,
            posted_on: None,
            amount_cents: None,
        }
    }
}

#[tauri::command]
pub fn list_transactions(
    state: State<'_, AppState>,
    filter: FilterDto,
) -> IpcResult<Vec<TransactionDto>> {
    let filter = filter.into_core()?;
    let rows = transactions::list(&lock(&state), &filter)?;
    let shown = slaybudget_core::fx::Shown::of(&lock(&state));
    Ok(rows
        .into_iter()
        .map(|t| TransactionDto::shown(&shown, t))
        .collect())
}

#[tauri::command]
pub fn count_transactions(state: State<'_, AppState>, filter: FilterDto) -> IpcResult<i64> {
    let filter = filter.into_core()?;
    Ok(transactions::count(&lock(&state), &filter)?)
}

#[tauri::command]
pub fn update_transaction(state: State<'_, AppState>, id: i64, patch: TxPatchDto) -> IpcResult<()> {
    recorded(&state, patch_label(&patch, 1), |c| {
        transactions::update(c, id, &patch.into_core())
    })
}

#[tauri::command]
pub fn bulk_update_transactions(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    patch: TxPatchDto,
) -> IpcResult<usize> {
    recorded(&state, patch_label(&patch, ids.len()), |c| {
        transactions::bulk_update(c, &ids, &patch.into_core())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPartDto {
    pub amount_cents: i64,
    pub category_id: Option<i64>,
    pub description: Option<String>,
}

#[tauri::command]
pub fn split_transaction(
    state: State<'_, AppState>,
    id: i64,
    parts: Vec<SplitPartDto>,
) -> IpcResult<Vec<i64>> {
    let parts: Vec<transactions::SplitPart> = parts
        .into_iter()
        .map(|p| transactions::SplitPart {
            amount_cents: p.amount_cents,
            category_id: p.category_id,
            description: p.description,
        })
        .collect();
    recorded(&state, "Split Transaction".to_string(), |c| {
        let parent = transactions::get(c, id)?;
        let shown = slaybudget_core::fx::Shown::of(c);
        let typed: Vec<i64> = parts.iter().map(|p| p.amount_cents).collect();
        let parts: Vec<transactions::SplitPart> = parts
            .iter()
            .zip(parts_back(&shown, &parent, &typed))
            .map(|(p, amount_cents)| transactions::SplitPart {
                amount_cents,
                ..p.clone()
            })
            .collect();
        transactions::split(c, id, &parts)
    })
}

#[tauri::command]
pub fn unsplit_transaction(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    recorded(&state, "Unsplit Transaction".to_string(), |c| {
        transactions::unsplit(c, id)
    })
}

#[tauri::command]
pub fn transaction_children(state: State<'_, AppState>, id: i64) -> IpcResult<Vec<TransactionDto>> {
    let rows = transactions::children(&lock(&state), id)?;
    let shown = slaybudget_core::fx::Shown::of(&lock(&state));
    Ok(rows
        .into_iter()
        .map(|t| TransactionDto::shown(&shown, t))
        .collect())
}

// ---------- categories ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    pub id: i64,
    pub name: String,
    pub emoji: Option<String>,
    pub color: String,
    pub sort_order: i64,
}

impl From<CategoryGroup> for GroupDto {
    fn from(g: CategoryGroup) -> Self {
        GroupDto {
            id: g.id,
            name: g.name,
            emoji: g.emoji,
            color: g.color,
            sort_order: g.sort_order,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDto {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
    pub emoji: Option<String>,
    pub color: Option<String>,
    pub budget_cents: Option<i64>,
    pub excluded: bool,
    pub kind: String,
    pub sort_order: i64,
    pub archived: bool,
    pub is_other: bool,
    pub essential: bool,
}

impl From<Category> for CategoryDto {
    fn from(c: Category) -> Self {
        CategoryDto {
            id: c.id,
            group_id: c.group_id,
            name: c.name,
            emoji: c.emoji,
            color: c.color,
            budget_cents: c.budget_cents,
            excluded: c.excluded,
            kind: c.kind.as_str().to_string(),
            sort_order: c.sort_order,
            archived: c.archived,
            is_other: c.legacy_name.as_deref() == Some("Other"),
            essential: c.essential,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCategoryDto {
    pub group: String,
    pub name: String,
    pub emoji: Option<String>,
    pub color: Option<String>,
    pub budget_cents: Option<i64>,
    #[serde(default)]
    pub excluded: bool,
    pub kind: Option<String>,
    /// When set: unique name, placed in this group (the app's Add actions).
    pub group_target: Option<GroupTarget>,
}

fn parse_kind(s: Option<&str>) -> CategoryKind {
    match s {
        Some("income") => CategoryKind::Income,
        Some("transfer") => CategoryKind::Transfer,
        _ => CategoryKind::Expense,
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatPatchDto {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub emoji: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub color: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub budget_cents: Option<Option<i64>>,
    pub excluded: Option<bool>,
    pub archived: Option<bool>,
    pub essential: Option<bool>,
}

#[tauri::command]
pub fn list_category_groups(state: State<'_, AppState>) -> IpcResult<Vec<GroupDto>> {
    Ok(categories::list_groups(&lock(&state))?
        .into_iter()
        .map(GroupDto::from)
        .collect())
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> IpcResult<Vec<CategoryDto>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(categories::list(&conn)?
        .into_iter()
        .map(|c| {
            let mut dto = CategoryDto::from(c);
            dto.budget_cents = dto.budget_cents.map(|b| shown.budget(b));
            dto
        })
        .collect())
}

#[tauri::command]
pub fn create_category(state: State<'_, AppState>, cat: NewCategoryDto) -> IpcResult<i64> {
    let new = NewCategory {
        group: cat.group,
        name: cat.name,
        emoji: cat.emoji,
        color: cat.color,
        budget_cents: cat.budget_cents,
        excluded: cat.excluded,
        kind: parse_kind(cat.kind.as_deref()),
    };
    recorded(&state, "New Category".to_string(), |c| {
        match cat.group_target {
            Some(target) => categories::create_in(c, &new, target),
            None => categories::create(c, &new),
        }
    })
}

#[tauri::command]
pub fn category_usage(state: State<'_, AppState>, id: i64) -> IpcResult<i64> {
    Ok(categories::usage(&lock(&state), id)?)
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: i64) -> IpcResult<DeleteReport> {
    recorded(&state, "Delete Category".to_string(), |c| {
        categories::delete(c, id)
    })
}

#[tauri::command]
pub fn move_category_to_group(
    state: State<'_, AppState>,
    id: i64,
    target: GroupTarget,
) -> IpcResult<()> {
    recorded(&state, "Move Category".to_string(), |c| {
        categories::move_to_group(c, id, target)
    })
}

#[tauri::command]
pub fn rename_group(state: State<'_, AppState>, id: i64, name: String) -> IpcResult<()> {
    recorded(&state, "Rename Group".to_string(), |c| {
        categories::rename_group(c, id, &name)
    })
}

#[tauri::command]
pub fn ungroup_group(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    recorded(&state, "Ungroup".to_string(), |c| {
        categories::ungroup(c, id)
    })
}

#[tauri::command]
pub fn update_category(state: State<'_, AppState>, id: i64, patch: CatPatchDto) -> IpcResult<()> {
    let core = CategoryPatch {
        name: patch.name,
        emoji: patch.emoji,
        color: patch.color,
        budget_cents: patch.budget_cents,
        excluded: patch.excluded,
        archived: patch.archived,
        group_id: None,
        essential: patch.essential,
    };
    let label = match core.essential {
        Some(true) => "Mark Essential",
        Some(false) => "Unmark Essential",
        None => "Edit Category",
    };
    recorded(&state, label.to_string(), |c| {
        if core.budget_cents.is_some() {
            budget_plan_core::adopt_display_currency(c)?;
        }
        categories::update(c, id, &core)
    })
}

// ---------- import ----------

use slaybudget_core::import::legacy::{migrate_legacy, LegacyInput};
use slaybudget_core::import::pdf::{PdfItem, PdfLine, PdfText};
use slaybudget_core::import::pipeline::{self, ImportReport};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReportDto {
    pub import_id: Option<i64>,
    pub source_id: i64,
    pub source_name: String,
    pub inserted: usize,
    pub duplicates: usize,
    pub skipped: usize,
    pub already_imported: bool,
    pub flags: Vec<slaybudget_core::duplicates::DuplicateFlag>,
    pub needs_account: Option<slaybudget_core::accounts::NeedsAccount>,
}

impl From<ImportReport> for ImportReportDto {
    fn from(r: ImportReport) -> Self {
        ImportReportDto {
            import_id: r.import_id,
            source_id: r.source_id,
            source_name: r.source_name,
            inserted: r.inserted,
            duplicates: r.duplicates,
            skipped: r.skipped,
            already_imported: r.already_imported,
            flags: r.flags,
            needs_account: r.needs_account,
        }
    }
}

#[tauri::command]
pub fn import_csv_text(
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    text: String,
    account: Option<slaybudget_core::accounts::Choice>,
) -> IpcResult<ImportReportDto> {
    recorded(&state, format!("Import {}", file_name(&path)), |c| {
        pipeline::import_file(
            c,
            profile_id,
            &path,
            pipeline::StatementFile::Csv(&text),
            account,
        )
    })
    .map(Into::into)
}

#[tauri::command]
pub fn import_ofx_text(
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    text: String,
    account: Option<slaybudget_core::accounts::Choice>,
) -> IpcResult<ImportReportDto> {
    recorded(&state, format!("Import {}", file_name(&path)), |c| {
        pipeline::import_file(
            c,
            profile_id,
            &path,
            pipeline::StatementFile::Ofx(&text),
            account,
        )
    })
    .map(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfItemDto {
    pub x: i32,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLineDto {
    pub y: i32,
    pub items: Vec<PdfItemDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextDto {
    pub lines: Vec<PdfLineDto>,
    pub filename: String,
}

#[tauri::command]
pub fn import_pdf_doc(
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    doc: PdfTextDto,
    file_hash: String,
    account: Option<slaybudget_core::accounts::Choice>,
) -> IpcResult<ImportReportDto> {
    let today = chrono::Local::now().date_naive();
    let pdf = PdfText {
        lines: doc
            .lines
            .into_iter()
            .map(|l| PdfLine {
                y: l.y,
                items: l
                    .items
                    .into_iter()
                    .map(|i| PdfItem {
                        x: i.x,
                        text: i.text,
                    })
                    .collect(),
            })
            .collect(),
        filename: doc.filename,
        today,
    };
    recorded(&state, format!("Import {}", file_name(&path)), |c| {
        pipeline::import_file(
            c,
            profile_id,
            &path,
            pipeline::StatementFile::Pdf {
                doc: &pdf,
                hash: &file_hash,
            },
            account,
        )
    })
    .map(Into::into)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyReportDto {
    pub transactions_inserted: usize,
    pub transactions_duplicate: usize,
    pub profiles_created: usize,
    pub sources_created: usize,
    pub categories_created: usize,
    pub merchants_learned: usize,
}

#[tauri::command]
pub fn migrate_legacy_json(
    state: State<'_, AppState>,
    transactions_json: String,
    model_json: Option<String>,
) -> IpcResult<LegacyReportDto> {
    let report = migrate_legacy(
        &lock(&state),
        &LegacyInput {
            transactions_json,
            model_json,
        },
    )?;
    Ok(LegacyReportDto {
        transactions_inserted: report.transactions_inserted,
        transactions_duplicate: report.transactions_duplicate,
        profiles_created: report.profiles_created,
        sources_created: report.sources_created,
        categories_created: report.categories_created,
        merchants_learned: report.merchants_learned,
    })
}

// ---------- analytics ----------

use slaybudget_core::analytics::aggregate::{
    self, CategoryTotal, DateRange, MonthlyTotal, TimeRange,
};
use slaybudget_core::analytics::budgets::{self, BudgetStatus};
use slaybudget_core::analytics::cashflow::{self, CashFlow};
use slaybudget_core::analytics::recurring::{self, Recurring};

/// Resolve a preset range against `today`, or use explicit bounds when given.
fn resolve_range(range: Option<TimeRange>, today: &str) -> Result<DateRange, IpcError> {
    let today = parse_date(today)?;
    Ok(range.unwrap_or(TimeRange::All).range(today))
}

#[tauri::command]
pub fn analytics_monthly(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    range: Option<TimeRange>,
    today: String,
) -> IpcResult<Vec<MonthlyTotal>> {
    let r = resolve_range(range, &today)?;
    Ok(aggregate::monthly_totals(&lock(&state), profile_id, r)?)
}

#[tauri::command]
pub fn analytics_categories(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    range: Option<TimeRange>,
    today: String,
) -> IpcResult<Vec<CategoryTotal>> {
    let r = resolve_range(range, &today)?;
    Ok(aggregate::category_totals(&lock(&state), profile_id, r)?)
}

#[tauri::command]
pub fn analytics_budgets(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    today: String,
) -> IpcResult<Vec<BudgetStatus>> {
    Ok(budgets::month_status(
        &lock(&state),
        profile_id,
        parse_date(&today)?,
    )?)
}

#[tauri::command]
pub fn analytics_cashflow(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    range: Option<TimeRange>,
    today: String,
) -> IpcResult<CashFlow> {
    let r = resolve_range(range, &today)?;
    Ok(cashflow::cash_flow(&lock(&state), profile_id, r)?)
}

#[tauri::command]
pub fn list_recurring(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<Vec<Recurring>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(recurring::list_recurring(&conn, profile_id)?
        .into_iter()
        .map(|r| recurring_shown(&shown, r))
        .collect())
}

#[tauri::command]
pub fn money_habits(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    today: String,
) -> IpcResult<slaybudget_core::habits::HabitsData> {
    Ok(slaybudget_core::habits::money_habits(
        &lock(&state),
        profile_id,
        &today,
    )?)
}

#[tauri::command]
pub fn analytics_recurring(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    today: String,
) -> IpcResult<Vec<Recurring>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(recurring::upcoming(&conn, profile_id, parse_date(&today)?)?
        .into_iter()
        .map(|r| recurring_shown(&shown, r))
        .collect())
}

// ---------- fx ----------

use slaybudget_core::fx::{self, FxRate};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRateDto {
    pub base: String,
    pub quote: String,
    pub as_of: String,
    pub rate: f64,
}

#[tauri::command]
pub fn fx_upsert_many(state: State<'_, AppState>, rates: Vec<FxRateDto>) -> IpcResult<usize> {
    let parsed: Result<Vec<FxRate>, IpcError> = rates
        .into_iter()
        .map(|r| {
            Ok(FxRate {
                base: r.base,
                quote: r.quote,
                as_of: parse_date(&r.as_of)?,
                rate: r.rate,
            })
        })
        .collect();
    let rates = parsed?;
    let mut guard = lock(&state);
    Ok(fx::upsert_many(&mut guard, &rates)?)
}

#[tauri::command]
pub fn fx_rate_on(
    state: State<'_, AppState>,
    base: String,
    quote: String,
    on: String,
) -> IpcResult<Option<f64>> {
    Ok(fx::rate_on(&lock(&state), &base, &quote, parse_date(&on)?)?)
}

#[tauri::command]
pub fn fx_latest(
    state: State<'_, AppState>,
    base: String,
    quote: String,
) -> IpcResult<Option<f64>> {
    Ok(fx::latest(&lock(&state), &base, &quote)?)
}

#[tauri::command]
pub fn fx_convert_cents(
    state: State<'_, AppState>,
    cents: i64,
    base: String,
    quote: String,
    on: String,
) -> IpcResult<Option<i64>> {
    Ok(fx::convert_cents(
        &lock(&state),
        cents,
        &base,
        &quote,
        parse_date(&on)?,
    )?)
}

// ---------- search ----------

use slaybudget_core::search::{self, parser};

#[tauri::command]
pub fn search_transactions(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    query: String,
    today: String,
    limit: Option<usize>,
) -> IpcResult<Vec<TransactionDto>> {
    let parsed = parser::parse(&query, parse_date(&today)?);
    let rows = search::search(&lock(&state), profile_id, &parsed, limit.unwrap_or(100))?;
    let shown = slaybudget_core::fx::Shown::of(&lock(&state));
    Ok(rows
        .into_iter()
        .map(|t| TransactionDto::shown(&shown, t))
        .collect())
}

// ---------- watched folder ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchScanDto {
    pub files_scanned: usize,
    pub files_imported: usize,
    pub transactions_inserted: usize,
    pub transactions_duplicate: usize,
}

/// Import any new CSV/OFX files in the configured watched folder. PDFs are left
/// for the import screen (they need webview text extraction). Safe to call on
/// every launch: already-imported files are skipped by content hash.
#[tauri::command]
pub fn scan_watched_folder(state: State<'_, AppState>) -> IpcResult<WatchScanDto> {
    let guard = lock(&state);
    let Some(folder) = settings::get(&guard, "watched_folder")? else {
        return Ok(WatchScanDto {
            files_scanned: 0,
            files_imported: 0,
            transactions_inserted: 0,
            transactions_duplicate: 0,
        });
    };
    if folder.trim().is_empty() {
        return Ok(WatchScanDto {
            files_scanned: 0,
            files_imported: 0,
            transactions_inserted: 0,
            transactions_duplicate: 0,
        });
    }
    // Default profile for auto-imported files.
    let profile_id = profiles::list(&guard)?
        .first()
        .map(|p| p.id)
        .ok_or(IpcError {
            code: "invalid",
            message: "no profile to import into".into(),
        })?;

    let mut dto = WatchScanDto {
        files_scanned: 0,
        files_imported: 0,
        transactions_inserted: 0,
        transactions_duplicate: 0,
    };
    let entries = std::fs::read_dir(&folder).map_err(|e| IpcError {
        code: "io",
        message: e.to_string(),
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let path_str = path.to_string_lossy().to_string();
        let report = match ext.as_deref() {
            Some("csv") => {
                dto.files_scanned += 1;
                let text = std::fs::read_to_string(&path).map_err(|e| IpcError {
                    code: "io",
                    message: e.to_string(),
                })?;
                pipeline::import_csv(&guard, profile_id, &path_str, &text)?
            }
            Some("ofx") | Some("qfx") | Some("qbo") | Some("qif") => {
                dto.files_scanned += 1;
                let text = std::fs::read_to_string(&path).map_err(|e| IpcError {
                    code: "io",
                    message: e.to_string(),
                })?;
                pipeline::import_ofx(&guard, profile_id, &path_str, &text)?
            }
            _ => continue,
        };
        if !report.already_imported {
            dto.files_imported += 1;
            dto.transactions_inserted += report.inserted;
            dto.transactions_duplicate += report.duplicates;
        }
    }
    Ok(dto)
}

// ----- recategorizing with rules -----

use slaybudget_core::categorize::recategorize::{self, OtherGroup, Target};
use slaybudget_core::categorize::rules::{self, MatchKind, NewRule};
use slaybudget_core::import::ft_model::{self, FtChoice, FtProposal, FtReport};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecatMatchDto {
    pub transaction: TransactionDto,
    pub similar: bool,
    pub locked: bool,
}

/// What a category change did, and the undo step it made (the note's Undo and Only this one name it).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDto {
    pub moved: usize,
    pub merchant: String,
    pub suggested: usize,
    pub platform: bool,
    pub step: Option<u64>,
}

/// A category change, and the rest of history moving with it, as one undo step.
#[tauri::command]
pub fn set_transaction_category(
    state: State<'_, AppState>,
    id: i64,
    category_id: i64,
) -> IpcResult<ChangeDto> {
    let conn = lock(&state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    let before = stack.latest_id();
    let change = stack.record(&conn, "Change Category", |c| {
        recategorize::change_category(c, id, category_id)
    });
    show_undo_menu(&state, &stack);
    let change = change?;
    let after = stack.latest_id();
    Ok(ChangeDto {
        moved: change.moved,
        merchant: change.merchant,
        suggested: change.suggested,
        platform: change.platform,
        step: if after != before { after } else { None },
    })
}

/// The other transactions with this one's name, to ask about after a payment app's category change.
#[tauri::command]
pub fn same_merchant(
    state: State<'_, AppState>,
    id: i64,
    category_id: i64,
) -> IpcResult<Vec<RecatMatchDto>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(recategorize::same_merchant(&conn, id, category_id)?
        .into_iter()
        .map(|m| RecatMatchDto {
            transaction: TransactionDto::shown(&shown, m.transaction),
            similar: m.similar,
            locked: m.locked,
        })
        .collect())
}

/// One category for the transactions you selected (each becomes yours; nothing else moves). One undo step.
#[tauri::command]
pub fn set_categories(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    category_id: i64,
) -> IpcResult<usize> {
    recorded(&state, count_label("Change Category", ids.len()), |c| {
        recategorize::set_many(c, &ids, category_id)
    })
}

/// Undo `step` only while it is still the latest step (the note's Undo after a category change).
#[tauri::command]
pub fn undo_step(state: State<'_, AppState>, step: u64) -> IpcResult<Option<String>> {
    let conn = lock(&state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    let done = stack.undo_step(&conn, step);
    show_undo_menu(&state, &stack);
    Ok(done?)
}

/// "Only this one": take back that change (only while it is still the latest step), then change just this row.
#[tauri::command]
pub fn keep_only_this_one(
    state: State<'_, AppState>,
    id: i64,
    category_id: i64,
    step: u64,
) -> IpcResult<()> {
    let conn = lock(&state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    let done = stack.undo_step(&conn, step).and_then(|_| {
        stack.record(&conn, "Change Category", |c| {
            recategorize::set_only(c, id, category_id)
        })
    });
    show_undo_menu(&state, &stack);
    Ok(done?)
}

/// Take the suggested categories (the other side of a suggested transfer comes too).
#[tauri::command]
pub fn accept_suggestions(state: State<'_, AppState>, ids: Vec<i64>) -> IpcResult<usize> {
    recorded(&state, count_label("Accept Suggestion", ids.len()), |c| {
        slaybudget_core::categorize::history::accept(c, &ids)
    })
}

/// Keep the current categories and drop the suggestions.
#[tauri::command]
pub fn reject_suggestions(state: State<'_, AppState>, ids: Vec<i64>) -> IpcResult<usize> {
    recorded(&state, count_label("Reject Suggestion", ids.len()), |c| {
        slaybudget_core::categorize::history::reject(c, &ids)
    })
}

/// How many transactions have a category to check.
#[tauri::command]
pub fn suggestion_count(state: State<'_, AppState>, profile_id: Option<i64>) -> IpcResult<i64> {
    Ok(slaybudget_core::categorize::history::suggestion_count(
        &lock(&state),
        profile_id,
    )?)
}

/// Forget the merchants and what the classifier learned (the starter list is taught again). One undo step.
#[tauri::command]
pub fn reset_learning(state: State<'_, AppState>) -> IpcResult<()> {
    recorded(&state, "Reset What SlayBudget Learned".to_string(), |c| {
        slaybudget_core::categorize::history::reset_learning(c)
    })
}

/// After updating: sort history once (backed up first, one undo step) and say what changed in the bell.
pub fn sort_history_once(
    conn: &rusqlite::Connection,
    stack: &mut slaybudget_core::undo::UndoStack,
) -> slaybudget_core::error::Result<()> {
    if settings::get(conn, "smart_history_done")?.is_some() {
        return Ok(());
    }
    slaybudget_core::db::backup_before(conn, "sort-transactions", &local_stamp())?;
    slaybudget_core::categorize::history::prepare(conn)?;
    let Some(r) = stack.record(
        conn,
        "Sort Transactions",
        slaybudget_core::categorize::history::run_once,
    )?
    else {
        return Ok(());
    };
    let changed = r.moved + r.transfers * 2;
    if changed + r.suggested == 0 {
        return Ok(());
    }
    let title = if changed > 0 {
        format!(
            "SlayBudget sorted {changed} {}",
            if changed == 1 {
                "transaction"
            } else {
                "transactions"
            }
        )
    } else {
        format!(
            "{} {} to check",
            r.suggested,
            if r.suggested == 1 {
                "category"
            } else {
                "categories"
            }
        )
    };
    let body = if r.suggested > 0 {
        format!(
            "{} {} suggestions to check. Undo from the Edit menu.",
            r.suggested,
            if r.suggested == 1 { "is a" } else { "are" }
        )
    } else {
        "Undo from the Edit menu.".to_string()
    };
    slaybudget_core::notifications::add_if_new(
        conn,
        &slaybudget_core::notifications::NewNotification {
            key: "sort-transactions-1".into(),
            kind: slaybudget_core::notifications::Kind::ReviewDigest,
            title,
            body,
            target: serde_json::json!({ "kind": "transactions", "filter": "suggested" }),
            profile_id: None,
        },
        &now_utc(),
        false,
    )?;
    Ok(())
}

#[tauri::command]
pub fn preview_recategorize(
    state: State<'_, AppState>,
    target: Target,
    category_id: i64,
) -> IpcResult<Vec<RecatMatchDto>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    let rows = recategorize::preview(&conn, &target, category_id)?;
    Ok(rows
        .into_iter()
        .map(|m| RecatMatchDto {
            transaction: TransactionDto::shown(&shown, m.transaction),
            similar: m.similar,
            locked: m.locked,
        })
        .collect())
}

#[tauri::command]
pub fn apply_recategorize(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    category_id: i64,
) -> IpcResult<usize> {
    recorded(&state, count_label("Change Category", ids.len()), |c| {
        recategorize::apply(c, &ids, category_id)
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRuleDto {
    pub kind: String,
    pub pattern: String,
    pub category_id: i64,
}

#[tauri::command]
pub fn save_rule(state: State<'_, AppState>, rule: SaveRuleDto) -> IpcResult<i64> {
    let match_kind = match rule.kind.as_str() {
        "merchant" => MatchKind::Merchant,
        "contains" => MatchKind::Contains,
        other => return Err(CoreError::Invalid(format!("unknown rule kind {other}")).into()),
    };
    recorded(&state, "Save Rule".to_string(), |c| {
        rules::save_or_replace(
            c,
            &NewRule {
                name: rule.pattern.trim().to_string(),
                match_kind,
                pattern: rule.pattern,
                min_cents: None,
                max_cents: None,
                source_id: None,
                category_id: rule.category_id,
                priority: 0,
            },
        )
    })
}

#[tauri::command]
pub fn other_groups(state: State<'_, AppState>) -> IpcResult<Vec<OtherGroup>> {
    Ok(recategorize::other_groups(&lock(&state))?)
}

#[tauri::command]
pub fn preview_ft_model(
    state: State<'_, AppState>,
    model_json: String,
) -> IpcResult<Vec<FtProposal>> {
    Ok(ft_model::preview(&lock(&state), &model_json)?)
}

/// Backs the database up beside itself, then imports the reviewed choices.
#[tauri::command]
pub fn import_ft_model(state: State<'_, AppState>, choices: Vec<FtChoice>) -> IpcResult<FtReport> {
    let conn = lock(&state);
    if let Some(path) = conn.path().filter(|p| !p.is_empty()) {
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let backup = std::path::Path::new(path)
            .with_file_name(format!("slaybudget.before-ft-import-{stamp}.db"));
        slaybudget_core::db::backup_to(&conn, &backup)?;
    }
    Ok(ft_model::apply(&conn, &choices)?)
}

/// Write a complete copy of the database to a file the person chose (Settings > Data).
#[tauri::command]
pub fn backup_database(state: State<'_, AppState>, path: String) -> IpcResult<()> {
    let target = std::path::Path::new(&path);
    // VACUUM INTO won't overwrite; the save dialog already confirmed replacing it.
    if target.exists() {
        std::fs::remove_file(target).map_err(|e| {
            slaybudget_core::CoreError::Invalid(format!("couldn't replace {path}: {e}"))
        })?;
    }
    slaybudget_core::db::backup_to(&lock(&state), target)?;
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRulesReport {
    learned: usize,
    rules: usize,
    left_out: usize,
}

/// Write learned merchants and explicit rules to a file the person chose, with nothing about them in it.
#[tauri::command]
pub fn export_rules(state: State<'_, AppState>, path: String) -> IpcResult<ExportRulesReport> {
    use slaybudget_core::categorize::export;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let out = export::export_rules(&lock(&state), &today)?;
    std::fs::write(&path, export::to_json(&out.file)?)
        .map_err(|e| slaybudget_core::CoreError::Invalid(format!("couldn't write {path}: {e}")))?;
    Ok(ExportRulesReport {
        learned: out.file.learned.len(),
        rules: out.file.rules.len(),
        left_out: out.left_out,
    })
}

/// Change the type of transactions; categories that don't fit the new type are cleared.
#[tauri::command]
pub fn set_transaction_type(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    tx_type: TxType,
) -> IpcResult<usize> {
    recorded(&state, count_label("Change Type", ids.len()), |c| {
        transactions::set_type(c, &ids, tx_type)
    })
}

// ----- saved recurrings -----

use slaybudget_core::recurrings::{self, MatchReport, NewRecurring, Status as RecurringStatus};

#[tauri::command]
pub fn recurring_suggestions(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<Vec<Recurring>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(recurrings::suggestions(&conn, profile_id)?
        .into_iter()
        .map(|r| recurring_shown(&shown, r))
        .collect())
}

#[tauri::command]
pub fn preview_recurring(state: State<'_, AppState>, rule: NewRecurring) -> IpcResult<i64> {
    let conn = lock(&state);
    let rule = rule_back(&slaybudget_core::fx::Shown::of(&conn), rule);
    Ok(recurrings::preview_count(&conn, &rule)?)
}

/// The unlinked charges a rule would claim, oldest first, as the screens show them.
#[tauri::command]
pub fn preview_recurring_matches(
    state: State<'_, AppState>,
    rule: NewRecurring,
) -> IpcResult<Vec<TransactionDto>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    let rule = rule_back(&shown, rule);
    let mut out = Vec::new();
    for id in recurrings::preview_matches(&conn, &rule)? {
        out.push(TransactionDto::shown(&shown, transactions::get(&conn, id)?));
    }
    Ok(out)
}

/// Create a bill; charges in `exclude` (unticked in the preview) are marked "not recurring", in the same undo step.
#[tauri::command]
pub fn create_recurring(
    state: State<'_, AppState>,
    rule: NewRecurring,
    exclude: Option<Vec<i64>>,
) -> IpcResult<i64> {
    recorded(&state, "New Recurring".to_string(), |c| {
        let rule = rule_back(&slaybudget_core::fx::Shown::of(c), rule);
        recurrings::create_except(c, &rule, &exclude.unwrap_or_default())
    })
}

#[tauri::command]
pub fn update_recurring(
    state: State<'_, AppState>,
    id: i64,
    rule: NewRecurring,
) -> IpcResult<MatchReport> {
    recorded(&state, "Edit Recurring".to_string(), |c| {
        let rule = rule_back(&slaybudget_core::fx::Shown::of(c), rule);
        recurrings::update(c, id, &rule)
    })
}

#[tauri::command]
pub fn set_recurring_status(
    state: State<'_, AppState>,
    id: i64,
    status: RecurringStatus,
) -> IpcResult<()> {
    recorded(&state, "Change Recurring Status".to_string(), |c| {
        recurrings::set_status(c, id, status)
    })
}

/// Which credits pay a bill back: `None` = undecided, empty = "not paid back".
#[tauri::command]
pub fn set_recurring_paid_back_by(
    state: State<'_, AppState>,
    id: i64,
    names: Option<Vec<String>>,
) -> IpcResult<()> {
    recorded(&state, "Change Paid Back By".to_string(), |c| {
        recurrings::set_paid_back_by(c, id, names)
    })
}

#[tauri::command]
pub fn delete_recurring(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    recorded(&state, "Delete Recurring".to_string(), |c| {
        recurrings::delete(c, id)
    })
}

#[tauri::command]
pub fn unlink_recurring(state: State<'_, AppState>, transaction_id: i64) -> IpcResult<()> {
    recorded(&state, "Not Recurring".to_string(), |c| {
        recurrings::unlink(c, transaction_id)
    })
}

#[tauri::command]
pub fn draft_recurring(state: State<'_, AppState>, transaction_id: i64) -> IpcResult<NewRecurring> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(rule_shown(
        &shown,
        recurrings::draft_from_transaction(&conn, transaction_id)?,
    ))
}

#[tauri::command]
pub fn dismiss_suggestion(state: State<'_, AppState>, merchant: String) -> IpcResult<()> {
    recorded(&state, "Dismiss Suggestion".to_string(), |c| {
        recurrings::dismiss(c, &merchant)
    })
}

// ----- price changes -----

use slaybudget_core::price_changes::{self, Answer as PriceAnswer, PriceChange, PriceCheck};

fn check_shown(s: &slaybudget_core::fx::Shown, mut c: PriceCheck) -> PriceCheck {
    c.old_cents = s.charge(c.old_cents);
    c.new_cents = s.charge(c.new_cents);
    c
}
fn change_shown(s: &slaybudget_core::fx::Shown, mut c: PriceChange) -> PriceChange {
    c.from_cents = s.charge(c.from_cents);
    c.to_cents = s.charge(c.to_cents);
    c
}

/// A bill's latest price change, for the Recurrings page.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillPriceChange {
    pub recurring_id: i64,
    #[serde(flatten)]
    pub change: PriceChange,
}

/// Charges that may be a bill at a new price, waiting for an answer.
#[tauri::command]
pub fn price_checks(state: State<'_, AppState>) -> IpcResult<Vec<PriceCheck>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(price_changes::open_checks(&conn)?
        .into_iter()
        .map(|c| check_shown(&shown, c))
        .collect())
}

#[tauri::command]
pub fn price_check_for(
    state: State<'_, AppState>,
    transaction_id: i64,
) -> IpcResult<Option<PriceCheck>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(price_changes::for_transaction(&conn, transaction_id)?.map(|c| check_shown(&shown, c)))
}

/// Answer "Is this the same subscription at a new price?"; "separate" returns the form for its own bill.
#[tauri::command]
pub fn answer_price_check(
    state: State<'_, AppState>,
    id: i64,
    answer: PriceAnswer,
) -> IpcResult<Option<NewRecurring>> {
    let label = match answer {
        PriceAnswer::NewPrice => "New Price",
        PriceAnswer::OneOff => "One-Off Charge",
        PriceAnswer::Separate => "Separate Subscription",
    };
    recorded(&state, label.to_string(), |c| {
        let draft = price_changes::answer(c, id, answer)?;
        let shown = slaybudget_core::fx::Shown::of(c);
        Ok(draft.map(|d| rule_shown(&shown, d)))
    })
}

#[tauri::command]
pub fn price_history(state: State<'_, AppState>, recurring_id: i64) -> IpcResult<Vec<PriceChange>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(price_changes::history(&conn, recurring_id)?
        .into_iter()
        .map(|c| change_shown(&shown, c))
        .collect())
}

#[tauri::command]
pub fn latest_price_changes(state: State<'_, AppState>) -> IpcResult<Vec<BillPriceChange>> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    Ok(price_changes::latest_changes(&conn)?
        .into_iter()
        .map(|(recurring_id, c)| BillPriceChange {
            recurring_id,
            change: change_shown(&shown, c),
        })
        .collect())
}

/// Pairs of bills (older first) that look like the same subscription.
#[tauri::command]
pub fn look_alike_recurrings(state: State<'_, AppState>) -> IpcResult<Vec<(i64, i64)>> {
    let conn = lock(&state);
    Ok(price_changes::look_alikes(&conn)?)
}

/// Merge two bills into the older one; returns the bill kept.
#[tauri::command]
pub fn merge_recurrings(state: State<'_, AppState>, a: i64, b: i64) -> IpcResult<i64> {
    recorded(&state, "Merge Recurrings".to_string(), |c| {
        price_changes::merge(c, a, b)
    })
}

#[tauri::command]
pub fn keep_recurrings_apart(state: State<'_, AppState>, a: i64, b: i64) -> IpcResult<()> {
    recorded(&state, "Not the Same Subscription".to_string(), |c| {
        price_changes::keep_apart(c, a, b)
    })
}

// ---------- tags ----------

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> IpcResult<Vec<slaybudget_core::tags::Tag>> {
    Ok(slaybudget_core::tags::list(&lock(&state))?)
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> IpcResult<i64> {
    recorded(&state, "New Tag".to_string(), |c| {
        slaybudget_core::tags::create(c, &name, color.as_deref())
    })
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: i64,
    patch: slaybudget_core::tags::TagPatch,
) -> IpcResult<()> {
    recorded(&state, "Edit Tag".to_string(), |c| {
        slaybudget_core::tags::update(c, id, &patch)
    })
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    recorded(&state, "Delete Tag".to_string(), |c| {
        slaybudget_core::tags::delete(c, id)
    })
}

#[tauri::command]
pub fn add_tags(state: State<'_, AppState>, ids: Vec<i64>, tag_ids: Vec<i64>) -> IpcResult<usize> {
    recorded(&state, count_label("Add Tag to", ids.len()), |c| {
        slaybudget_core::tags::add(c, &ids, &tag_ids)
    })
}

#[tauri::command]
pub fn remove_tags(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    tag_ids: Vec<i64>,
) -> IpcResult<usize> {
    recorded(&state, count_label("Remove Tag from", ids.len()), |c| {
        slaybudget_core::tags::remove(c, &ids, &tag_ids)
    })
}

// ---------- statement details ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementInfoDto {
    pub file_name: Option<String>,
    pub imported_at: Option<String>,
    pub source_name: String,
    pub fields: Vec<(String, String)>,
}

#[tauri::command]
pub fn statement_info(state: State<'_, AppState>, id: i64) -> IpcResult<StatementInfoDto> {
    let s = slaybudget_core::transactions::statement(&lock(&state), id)?;
    Ok(StatementInfoDto {
        file_name: s.file_name,
        imported_at: s.imported_at,
        source_name: s.source_name,
        fields: s.fields,
    })
}

// ---------- budgets ----------

use slaybudget_core::budgets::{self as budget_plan_core, BudgetPlan, RebalanceScope};

#[tauri::command]
pub fn budget_plan(state: State<'_, AppState>) -> IpcResult<BudgetPlan> {
    let conn = lock(&state);
    let shown = slaybudget_core::fx::Shown::of(&conn);
    let mut plan = budget_plan_core::plan(&conn)?;
    for m in &mut plan.months {
        m.amount_cents = shown.budget(m.amount_cents);
    }
    for g in &mut plan.groups {
        g.amount_cents = shown.budget(g.amount_cents);
    }
    Ok(plan)
}

#[tauri::command]
pub fn set_budget(
    state: State<'_, AppState>,
    category_id: i64,
    month: Option<String>,
    amount_cents: Option<i64>,
) -> IpcResult<()> {
    recorded(&state, "Change Budget".to_string(), |c| {
        budget_plan_core::set_budget_shown(c, category_id, month.as_deref(), amount_cents)
    })
}

#[tauri::command]
pub fn set_group_budget(
    state: State<'_, AppState>,
    group_id: i64,
    amount_cents: Option<i64>,
) -> IpcResult<()> {
    recorded(&state, "Change Budget".to_string(), |c| {
        budget_plan_core::adopt_display_currency(c)?;
        budget_plan_core::set_group_budget(c, group_id, amount_cents)
    })
}

#[tauri::command]
pub fn set_rollover(
    state: State<'_, AppState>,
    category_id: i64,
    since: Option<String>,
) -> IpcResult<()> {
    recorded(&state, "Change Rollover".to_string(), |c| {
        budget_plan_core::set_rollover(c, category_id, since.as_deref())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebalanceChangeDto {
    pub category_id: i64,
    pub amount_cents: i64,
}

#[tauri::command]
pub fn apply_budgets(
    state: State<'_, AppState>,
    month: String,
    items: Vec<RebalanceChangeDto>,
) -> IpcResult<()> {
    let pairs: Vec<(i64, i64)> = items
        .iter()
        .map(|c| (c.category_id, c.amount_cents))
        .collect();
    recorded(&state, "Use Suggested Budgets".to_string(), |c| {
        budget_plan_core::adopt_display_currency(c)?;
        budget_plan_core::apply_budgets(c, &month, &pairs)
    })
}

#[tauri::command]
pub fn apply_rebalance(
    state: State<'_, AppState>,
    changes: Vec<RebalanceChangeDto>,
    scope: RebalanceScope,
    month: String,
) -> IpcResult<()> {
    let pairs: Vec<(i64, i64)> = changes
        .iter()
        .map(|c| (c.category_id, c.amount_cents))
        .collect();
    recorded(&state, "Rebalance Budgets".to_string(), |c| {
        budget_plan_core::adopt_display_currency(c)?;
        budget_plan_core::apply_rebalance(c, &pairs, scope, &month)
    })
}

// ----- notification center -----

fn now_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[tauri::command]
pub fn notifications_list(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<Vec<slaybudget_core::notifications::Notification>> {
    Ok(slaybudget_core::notifications::list(
        &lock(&state),
        profile_id,
    )?)
}

#[tauri::command]
pub fn notifications_add(
    state: State<'_, AppState>,
    n: slaybudget_core::notifications::NewNotification,
    read: bool,
) -> IpcResult<Option<slaybudget_core::notifications::Notification>> {
    Ok(slaybudget_core::notifications::add_if_new(
        &lock(&state),
        &n,
        &now_utc(),
        read,
    )?)
}

#[tauri::command]
pub fn notifications_mark_read(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(slaybudget_core::notifications::mark_read(
        &lock(&state),
        id,
        &now_utc(),
    )?)
}

#[tauri::command]
pub fn notifications_mark_all_read(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<()> {
    Ok(slaybudget_core::notifications::mark_all_read(
        &lock(&state),
        profile_id,
        &now_utc(),
    )?)
}

#[tauri::command]
pub fn notifications_dismiss(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(slaybudget_core::notifications::dismiss(&lock(&state), id)?)
}

#[tauri::command]
pub fn notifications_pending(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<Vec<slaybudget_core::notifications::Notification>> {
    Ok(slaybudget_core::notifications::pending_banners(
        &lock(&state),
        profile_id,
    )?)
}

#[tauri::command]
pub fn notifications_mark_delivered(state: State<'_, AppState>, ids: Vec<i64>) -> IpcResult<()> {
    Ok(slaybudget_core::notifications::mark_delivered(
        &lock(&state),
        &ids,
        &now_utc(),
    )?)
}

#[tauri::command]
pub fn notifications_refresh(
    state: State<'_, AppState>,
    today: String,
    baseline: bool,
) -> IpcResult<Vec<slaybudget_core::notifications::Notification>> {
    let today = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d")
        .map_err(|e| slaybudget_core::CoreError::Invalid(format!("bad date {today}: {e}")))?;
    Ok(slaybudget_core::notifications::producers::refresh(
        &lock(&state),
        today,
        &now_utc(),
        baseline,
    )?)
}

// ----- manual fixes -----

fn local_stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Delete transactions after backing the database up (newest 3 "delete" backups kept).
#[tauri::command]
pub fn delete_transactions(state: State<'_, AppState>, ids: Vec<i64>) -> IpcResult<usize> {
    let label = if ids.len() == 1 {
        "Delete Transaction".to_string()
    } else {
        format!("Delete {} Transactions", ids.len())
    };
    recorded(&state, label, |c| {
        slaybudget_core::db::backup_before(c, "delete", &local_stamp())?;
        slaybudget_core::transactions::delete_many(c, &ids)
    })
}

#[tauri::command]
pub fn list_imports(
    state: State<'_, AppState>,
) -> IpcResult<Vec<slaybudget_core::imports::ImportRecord>> {
    Ok(slaybudget_core::imports::list(&lock(&state))?)
}

/// Undo an import after backing the database up (newest 3 "undo-import" backups kept).
#[tauri::command]
pub fn undo_import(state: State<'_, AppState>, id: i64) -> IpcResult<usize> {
    let file: String = {
        let conn = lock(&state);
        conn.query_row("SELECT file_name FROM imports WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap_or_else(|_| "import".to_string())
    };
    recorded(&state, format!("Undo Import {file}"), |c| {
        slaybudget_core::db::backup_before(c, "undo-import", &local_stamp())?;
        slaybudget_core::imports::undo(c, id)
    })
}

/// The open possible-duplicate flag a transaction is part of, if any.
#[tauri::command]
pub fn duplicate_flag_for(
    state: State<'_, AppState>,
    tx_id: i64,
) -> IpcResult<Option<slaybudget_core::duplicates::DuplicateFlag>> {
    Ok(slaybudget_core::duplicates::for_transaction(
        &lock(&state),
        tx_id,
    )?)
}

/// Settle a possible duplicate: delete this one, delete the other one (both back up first), or keep both.
#[tauri::command]
pub fn resolve_duplicate(
    state: State<'_, AppState>,
    flag_id: i64,
    resolution: slaybudget_core::duplicates::Resolution,
) -> IpcResult<()> {
    use slaybudget_core::duplicates::Resolution;
    let label = match resolution {
        Resolution::Kept => "Not a Duplicate",
        _ => "Delete Transaction",
    };
    recorded(&state, label.to_string(), |c| {
        if resolution != Resolution::Kept {
            slaybudget_core::db::backup_before(c, "delete", &local_stamp())?;
        }
        slaybudget_core::duplicates::resolve(c, flag_id, resolution)
    })
}

/// Move what an import brought in to another account (rows it already has are dropped).
#[tauri::command]
pub fn move_import(
    state: State<'_, AppState>,
    import_id: i64,
    source_id: i64,
) -> IpcResult<slaybudget_core::accounts::MoveReport> {
    let (file, account): (String, String) = {
        let conn = lock(&state);
        let file = conn
            .query_row(
                "SELECT file_name FROM imports WHERE id = ?1",
                [import_id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "import".to_string());
        let account = conn
            .query_row("SELECT name FROM sources WHERE id = ?1", [source_id], |r| {
                r.get(0)
            })
            .unwrap_or_else(|_| "account".to_string());
        (file, account)
    };
    recorded(&state, format!("Move {file} to {account}"), |c| {
        slaybudget_core::accounts::move_import(c, import_id, source_id)
    })
}

/// Set or clear an account's default tag; returns how many existing transactions were tagged.
#[tauri::command]
pub fn set_account_default_tag(
    state: State<'_, AppState>,
    source_id: i64,
    tag_id: Option<i64>,
    also_existing: bool,
) -> IpcResult<usize> {
    recorded(&state, "Change Default Tag".to_string(), |c| {
        slaybudget_core::accounts::set_default_tag(c, source_id, tag_id, also_existing)
    })
}

/// What an account is recognized by.
#[tauri::command]
pub fn account_clues(
    state: State<'_, AppState>,
    source_id: i64,
) -> IpcResult<Vec<slaybudget_core::accounts::AccountClue>> {
    Ok(slaybudget_core::accounts::clues_of(
        &lock(&state),
        source_id,
    )?)
}

#[tauri::command]
pub fn forget_account_clue(state: State<'_, AppState>, clue_id: i64) -> IpcResult<()> {
    recorded(
        &state,
        "Forget How an Account Is Recognized".to_string(),
        |c| slaybudget_core::accounts::forget_clue(c, clue_id),
    )
}

#[tauri::command]
pub fn update_account(
    state: State<'_, AppState>,
    source_id: i64,
    patch: slaybudget_core::accounts::AccountPatch,
) -> IpcResult<()> {
    recorded(&state, "Edit Account".to_string(), |c| {
        slaybudget_core::accounts::update(c, source_id, &patch)
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFoldersDto {
    pub folder: String,
    /// Folders made now (ones already there are left as they are).
    pub created: Vec<String>,
}

/// Make a folder for each account inside the watched folder; a statement dropped in one belongs to that account.
#[tauri::command]
pub fn create_account_folders(
    state: State<'_, AppState>,
    profile_id: i64,
) -> IpcResult<AccountFoldersDto> {
    let conn = lock(&state);
    let folder = slaybudget_core::settings::get(&conn, "watched_folder")?
        .filter(|f| !f.trim().is_empty())
        .ok_or_else(|| CoreError::Invalid("choose a watched folder first".into()))?;
    let mut created = Vec::new();
    for name in slaybudget_core::accounts::folder_names(&conn, profile_id)? {
        let dir = std::path::Path::new(&folder).join(&name);
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| CoreError::Invalid(e.to_string()))?;
            created.push(name);
        }
    }
    Ok(AccountFoldersDto { folder, created })
}

/// The watched folder, and Downloads with the time watching began (ms).
type WatchPlaces = (
    Option<std::path::PathBuf>,
    Option<(std::path::PathBuf, i64)>,
);

/// The places background imports may look in: the watched folder, and Downloads when you turned that on (with the
/// time you did, in ms: only files that arrived after count).
fn watch_places(conn: &rusqlite::Connection, app: &tauri::AppHandle) -> IpcResult<WatchPlaces> {
    use tauri::Manager;
    let watched = settings::get(conn, "watched_folder")?
        .filter(|f| !f.trim().is_empty())
        .map(std::path::PathBuf::from);
    let downloads = if settings::get(conn, "watch_downloads")?.as_deref() == Some("true") {
        let since = settings::get(conn, "watch_downloads_since")?
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(i64::MAX);
        app.path().download_dir().ok().map(|d| (d, since))
    } else {
        None
    };
    Ok((watched, downloads))
}

/// Statement-looking files to import in the background (watched folder and, if on, Downloads).
#[tauri::command]
pub fn statement_candidates(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> IpcResult<Vec<slaybudget_core::watch::Candidate>> {
    let (watched, downloads) = watch_places(&lock(&state), &app)?;
    Ok(slaybudget_core::watch::candidates(
        watched.as_deref(),
        downloads.as_ref().map(|(d, since)| (d.as_path(), *since)),
    ))
}

/// The bytes of a file in the watched folder or Downloads (nothing else can be read).
#[tauri::command]
pub fn read_statement(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    path: String,
) -> IpcResult<tauri::ipc::Response> {
    let (watched, downloads) = watch_places(&lock(&state), &app)?;
    let roots: Vec<std::path::PathBuf> = watched
        .into_iter()
        .chain(downloads.map(|(d, _)| d))
        .collect();
    let path = std::path::PathBuf::from(path);
    if !slaybudget_core::watch::is_allowed(&path, &roots) {
        return Err(IpcError {
            code: "invalid",
            message: "that file isn't in your watched folder or Downloads".into(),
        });
    }
    let bytes = std::fs::read(&path).map_err(|e| IpcError {
        code: "io",
        message: e.to_string(),
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxInfoDto {
    /// Currencies the built-in rates cover (the euro included).
    pub currencies: Vec<String>,
    /// The last month they cover ("2026-10").
    pub latest_month: String,
}

/// The built-in exchange rates: which currencies, and how recent.
#[tauri::command]
pub fn fx_info() -> FxInfoDto {
    let rates = slaybudget_core::fx::builtin();
    FxInfoDto {
        currencies: rates.currencies(),
        latest_month: rates.latest_month().to_string(),
    }
}

/// Take back the latest change; returns what was undone (None when there's nothing to undo).
#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> IpcResult<Option<String>> {
    let conn = lock(&state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    let done = stack.undo(&conn);
    show_undo_menu(&state, &stack);
    Ok(done?)
}

/// Put back the latest undone change; returns what was redone (None when there's nothing to redo).
#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> IpcResult<Option<String>> {
    let conn = lock(&state);
    let mut stack = state.undo.lock().unwrap_or_else(|p| p.into_inner());
    let done = stack.redo(&conn);
    show_undo_menu(&state, &stack);
    Ok(done?)
}

/// What the Edit menu shows next to Undo and Redo.
#[tauri::command]
pub fn undo_state(state: State<'_, AppState>) -> IpcResult<slaybudget_core::undo::UndoState> {
    Ok(state.undo.lock().unwrap_or_else(|p| p.into_inner()).state())
}

#[cfg(test)]
mod undo_tests {
    use super::*;

    fn patch(reviewed: Option<bool>, notes: bool, category: bool) -> TxPatchDto {
        TxPatchDto {
            category_id: category.then_some(Some(1)),
            category_locked: None,
            reviewed,
            notes: notes.then_some(Some("x".into())),
        }
    }

    #[test]
    fn labels_read_like_a_mac_edit_menu() {
        assert_eq!(
            patch_label(&patch(Some(true), false, false), 1),
            "Mark Reviewed"
        );
        assert_eq!(
            patch_label(&patch(Some(true), false, false), 3),
            "Mark 3 Transactions Reviewed"
        );
        assert_eq!(
            patch_label(&patch(Some(false), false, false), 2),
            "Mark 2 Transactions Unreviewed"
        );
        assert_eq!(patch_label(&patch(None, true, false), 1), "Edit Notes");
        assert_eq!(
            patch_label(&patch(None, false, true), 4),
            "Change Category of 4 Transactions"
        );
        assert_eq!(count_label("Change Category", 1), "Change Category");
        assert_eq!(
            count_label("Change Type", 2),
            "Change Type of 2 Transactions"
        );
        assert_eq!(count_label("Add Tag to", 5), "Add Tag to 5 Transactions");
        assert_eq!(count_label("Add Tag to", 1), "Add Tag");
        assert_eq!(file_name("Statements/Amex/amex-nov.csv"), "amex-nov.csv");
    }

    /// Every command that changes your data is either recorded for undo or listed here on purpose.
    #[test]
    fn every_command_that_changes_data_is_undoable_or_deliberately_not() {
        const NOT_UNDOABLE: &[&str] = &[
            // Settings and preferences, as in other apps.
            "set_setting",
            "create_profile",
            "rename_profile",
            "delete_profile",
            // Things SlayBudget does on its own, or one-time tools.
            "scan_watched_folder",
            "migrate_legacy_json",
            "import_ft_model",
            "fx_upsert_many",
            "notifications_add",
            "notifications_mark_read",
            "notifications_mark_all_read",
            "notifications_dismiss",
            "notifications_mark_delivered",
            "notifications_refresh",
            "backup_database",
            "export_rules",
            // Makes folders on disk, not changes to your data.
            "create_account_folders",
            // Reads that may save what they detect (recurring bills seen for the first time).
            "list_recurring",
            "analytics_recurring",
            // Undo itself.
            "undo",
            "redo",
        ];
        let src = include_str!("commands.rs");
        let mut missing = Vec::new();
        for chunk in src.split("#[tauri::command]").skip(1) {
            let name = chunk
                .split("pub fn ")
                .nth(1)
                .and_then(|r| r.split('(').next())
                .unwrap_or_default();
            let body = chunk.split("\n}\n").next().unwrap_or_default();
            let writes = [
                "::create",
                "::update",
                "::delete",
                "::set_",
                "::add",
                "::remove",
                "::split",
                "::unsplit",
                "::apply",
                "::import_",
                "::undo(",
                "::resolve",
                "::dismiss",
                "::unlink",
                "::rename",
                "::move_",
                "::ungroup",
                "::save_or_replace",
                "::bulk_update",
                "::answer",
                "::merge",
                "::keep_apart",
            ]
            .iter()
            .any(|w| body.contains(w));
            if writes && !body.contains("recorded(") && !NOT_UNDOABLE.contains(&name) {
                missing.push(name.to_string());
            }
        }
        assert!(
            missing.is_empty(),
            "changes data but isn't recorded for undo: {missing:?}"
        );
    }
}

#[cfg(test)]
mod currency_tests {
    use super::*;
    use slaybudget_core::fx::{Basis, Display, Shown};

    fn shown(currency: &str) -> Shown {
        Shown {
            display: Display {
                currency: currency.into(),
                basis: Basis::Month,
            },
            budget_currency: "USD".into(),
            base_currency: "USD".into(),
        }
    }
    fn tx(cents: i64) -> Transaction {
        Transaction {
            id: 1,
            profile_id: 1,
            source_id: 1,
            posted_on: chrono::NaiveDate::from_ymd_opt(2026, 10, 3).unwrap(),
            description: "UBER".into(),
            merchant: "uber".into(),
            amount_cents: cents,
            currency: "USD".into(),
            category_id: None,
            category_locked: false,
            reviewed: false,
            notes: None,
            refund_of: None,
            parent_id: None,
            tx_type: TxType::Regular,
            recurring_id: None,
            tag_ids: vec![],
            ..Default::default()
        }
    }

    #[test]
    fn a_transaction_shows_in_the_display_currency_and_keeps_its_original() {
        let plain = TransactionDto::shown(&shown("USD"), tx(-1240));
        assert_eq!(
            (
                plain.amount_cents,
                plain.currency.as_str(),
                plain.original_amount_cents
            ),
            (-1240, "USD", None)
        );
        let rate = slaybudget_core::fx::builtin()
            .rate("USD", "INR", "2026-10")
            .unwrap();
        let inr = TransactionDto::shown(&shown("INR"), tx(-1240));
        assert_eq!(inr.amount_cents, (-1240.0 * rate).round() as i64);
        assert_eq!(inr.currency, "INR");
        assert_eq!(
            (inr.original_amount_cents, inr.original_currency.as_deref()),
            (Some(-1240), Some("USD"))
        );
    }

    #[test]
    fn split_parts_typed_in_the_display_currency_add_up_to_the_original() {
        let parent = tx(-10_000);
        let s = shown("INR");
        let shown_total = TransactionDto::shown(&s, parent.clone()).amount_cents;
        let typed = vec![
            shown_total / 3,
            shown_total / 3,
            shown_total - 2 * (shown_total / 3),
        ];
        let back = parts_back(&s, &parent, &typed);
        assert_eq!(back.iter().sum::<i64>(), -10_000);
        assert_eq!(
            parts_back(&shown("USD"), &parent, &[-4_000, -6_000]),
            vec![-4_000, -6_000]
        );
    }
}

#[cfg(test)]
mod sort_history_tests {
    use super::*;
    use slaybudget_core::undo::UndoStack;

    fn with_history(conn: &rusqlite::Connection) {
        let p = slaybudget_core::profiles::create(conn, "Alex", None).unwrap();
        let s = slaybudget_core::profiles::find_or_create_source(
            conn,
            p,
            "Amex",
            slaybudget_core::profiles::SourceKind::Csv,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transactions (profile_id, source_id, posted_on, description, merchant, amount_cents, currency, dedupe_hash, category_id)
             VALUES (?1, ?2, '2026-02-01', 'STARBUCKS STORE 1', 'starbucks store', -650, 'USD', 'h1',
                     (SELECT id FROM categories WHERE legacy_name = 'Other'))",
            [p, s],
        )
        .unwrap();
    }

    #[test]
    fn sorting_history_runs_once_as_one_undo_step_and_tells_the_bell() {
        let conn = slaybudget_core::db::open_in_memory().unwrap();
        with_history(&conn);
        let mut stack = UndoStack::new();
        sort_history_once(&conn, &mut stack).unwrap();
        assert_eq!(stack.state().undo.as_deref(), Some("Sort Transactions"));
        let bell = slaybudget_core::notifications::list(&conn, None).unwrap();
        assert_eq!(bell.len(), 1);
        assert_eq!(bell[0].title, "1 category to check");
        sort_history_once(&conn, &mut stack).unwrap();
        assert_eq!(
            slaybudget_core::notifications::list(&conn, None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn nothing_to_sort_leaves_the_bell_quiet() {
        let conn = slaybudget_core::db::open_in_memory().unwrap();
        let mut stack = UndoStack::new();
        sort_history_once(&conn, &mut stack).unwrap();
        assert!(slaybudget_core::notifications::list(&conn, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_new_install_has_no_sort_step_and_undoing_the_sort_keeps_what_was_learned() {
        let conn = slaybudget_core::db::open_in_memory().unwrap();
        let mut stack = UndoStack::new();
        sort_history_once(&conn, &mut stack).unwrap();
        assert_eq!(stack.state().undo, None, "nothing visible changed");

        let conn = slaybudget_core::db::open_in_memory().unwrap();
        with_history(&conn);
        let mut stack = UndoStack::new();
        sort_history_once(&conn, &mut stack).unwrap();
        stack.undo(&conn).unwrap();
        let docs: f64 = conn
            .query_row("SELECT coalesce(sum(docs), 0) FROM model_totals", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(docs > 0.0, "the starter list and your rows stay learned");
    }
}
