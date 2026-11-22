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
    Ok(settings::set(&lock(&state), &key, &value)?)
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
    Ok(rows.into_iter().map(TransactionDto::from).collect())
}

#[tauri::command]
pub fn count_transactions(state: State<'_, AppState>, filter: FilterDto) -> IpcResult<i64> {
    let filter = filter.into_core()?;
    Ok(transactions::count(&lock(&state), &filter)?)
}

#[tauri::command]
pub fn update_transaction(state: State<'_, AppState>, id: i64, patch: TxPatchDto) -> IpcResult<()> {
    Ok(transactions::update(&lock(&state), id, &patch.into_core())?)
}

#[tauri::command]
pub fn bulk_update_transactions(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    patch: TxPatchDto,
) -> IpcResult<usize> {
    Ok(transactions::bulk_update(
        &lock(&state),
        &ids,
        &patch.into_core(),
    )?)
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
    Ok(transactions::split(&lock(&state), id, &parts)?)
}

#[tauri::command]
pub fn unsplit_transaction(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(transactions::unsplit(&lock(&state), id)?)
}

#[tauri::command]
pub fn transaction_children(state: State<'_, AppState>, id: i64) -> IpcResult<Vec<TransactionDto>> {
    let rows = transactions::children(&lock(&state), id)?;
    Ok(rows.into_iter().map(TransactionDto::from).collect())
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
    Ok(categories::list(&lock(&state))?
        .into_iter()
        .map(CategoryDto::from)
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
    let conn = lock(&state);
    Ok(match cat.group_target {
        Some(target) => categories::create_in(&conn, &new, target)?,
        None => categories::create(&conn, &new)?,
    })
}

#[tauri::command]
pub fn category_usage(state: State<'_, AppState>, id: i64) -> IpcResult<i64> {
    Ok(categories::usage(&lock(&state), id)?)
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: i64) -> IpcResult<DeleteReport> {
    Ok(categories::delete(&lock(&state), id)?)
}

#[tauri::command]
pub fn move_category_to_group(
    state: State<'_, AppState>,
    id: i64,
    target: GroupTarget,
) -> IpcResult<()> {
    Ok(categories::move_to_group(&lock(&state), id, target)?)
}

#[tauri::command]
pub fn rename_group(state: State<'_, AppState>, id: i64, name: String) -> IpcResult<()> {
    Ok(categories::rename_group(&lock(&state), id, &name)?)
}

#[tauri::command]
pub fn ungroup_group(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(categories::ungroup(&lock(&state), id)?)
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
    };
    Ok(categories::update(&lock(&state), id, &core)?)
}

// ---------- import ----------

use slaybudget_core::import::legacy::{migrate_legacy, LegacyInput};
use slaybudget_core::import::pdf::{PdfItem, PdfLine, PdfText};
use slaybudget_core::import::pipeline::{self, ImportReport};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReportDto {
    pub source_name: String,
    pub inserted: usize,
    pub duplicates: usize,
    pub skipped: usize,
    pub already_imported: bool,
}

impl From<ImportReport> for ImportReportDto {
    fn from(r: ImportReport) -> Self {
        ImportReportDto {
            source_name: r.source_name,
            inserted: r.inserted,
            duplicates: r.duplicates,
            skipped: r.skipped,
            already_imported: r.already_imported,
        }
    }
}

#[tauri::command]
pub fn import_csv_text(
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    text: String,
) -> IpcResult<ImportReportDto> {
    Ok(pipeline::import_csv(&lock(&state), profile_id, &path, &text)?.into())
}

#[tauri::command]
pub fn import_ofx_text(
    state: State<'_, AppState>,
    profile_id: i64,
    path: String,
    text: String,
) -> IpcResult<ImportReportDto> {
    Ok(pipeline::import_ofx(&lock(&state), profile_id, &path, &text)?.into())
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
    Ok(pipeline::import_pdf(&lock(&state), profile_id, &path, &pdf, &file_hash)?.into())
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
    Ok(recurring::list_recurring(&lock(&state), profile_id)?)
}

#[tauri::command]
pub fn analytics_recurring(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    today: String,
) -> IpcResult<Vec<Recurring>> {
    Ok(recurring::upcoming(
        &lock(&state),
        profile_id,
        parse_date(&today)?,
    )?)
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
    Ok(rows.into_iter().map(TransactionDto::from).collect())
}

// ---------- reminders ----------

use slaybudget_core::reminders::{self, Reminder};

#[tauri::command]
pub fn reminders_due(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
    today: String,
    horizon_days: Option<i64>,
) -> IpcResult<Vec<Reminder>> {
    Ok(reminders::due(
        &lock(&state),
        profile_id,
        parse_date(&today)?,
        horizon_days.unwrap_or(7),
    )?)
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
            Some("ofx") | Some("qfx") => {
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

#[tauri::command]
pub fn set_transaction_category(
    state: State<'_, AppState>,
    id: i64,
    category_id: i64,
) -> IpcResult<()> {
    Ok(recategorize::set_one(&lock(&state), id, category_id)?)
}

#[tauri::command]
pub fn preview_recategorize(
    state: State<'_, AppState>,
    target: Target,
    category_id: i64,
) -> IpcResult<Vec<RecatMatchDto>> {
    let rows = recategorize::preview(&lock(&state), &target, category_id)?;
    Ok(rows
        .into_iter()
        .map(|m| RecatMatchDto {
            transaction: TransactionDto::from(m.transaction),
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
    Ok(recategorize::apply(&lock(&state), &ids, category_id)?)
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
    Ok(rules::save_or_replace(
        &lock(&state),
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
    )?)
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
    Ok(transactions::set_type(&lock(&state), &ids, tx_type)?)
}

// ----- saved recurrings -----

use slaybudget_core::recurrings::{self, MatchReport, NewRecurring, Status as RecurringStatus};

#[tauri::command]
pub fn recurring_suggestions(
    state: State<'_, AppState>,
    profile_id: Option<i64>,
) -> IpcResult<Vec<Recurring>> {
    Ok(recurrings::suggestions(&lock(&state), profile_id)?)
}

#[tauri::command]
pub fn preview_recurring(state: State<'_, AppState>, rule: NewRecurring) -> IpcResult<i64> {
    Ok(recurrings::preview_count(&lock(&state), &rule)?)
}

#[tauri::command]
pub fn create_recurring(state: State<'_, AppState>, rule: NewRecurring) -> IpcResult<i64> {
    Ok(recurrings::create(&lock(&state), &rule)?)
}

#[tauri::command]
pub fn update_recurring(
    state: State<'_, AppState>,
    id: i64,
    rule: NewRecurring,
) -> IpcResult<MatchReport> {
    Ok(recurrings::update(&lock(&state), id, &rule)?)
}

#[tauri::command]
pub fn set_recurring_status(
    state: State<'_, AppState>,
    id: i64,
    status: RecurringStatus,
) -> IpcResult<()> {
    Ok(recurrings::set_status(&lock(&state), id, status)?)
}

#[tauri::command]
pub fn delete_recurring(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(recurrings::delete(&lock(&state), id)?)
}

#[tauri::command]
pub fn unlink_recurring(state: State<'_, AppState>, transaction_id: i64) -> IpcResult<()> {
    Ok(recurrings::unlink(&lock(&state), transaction_id)?)
}

#[tauri::command]
pub fn draft_recurring(state: State<'_, AppState>, transaction_id: i64) -> IpcResult<NewRecurring> {
    Ok(recurrings::draft_from_transaction(
        &lock(&state),
        transaction_id,
    )?)
}

#[tauri::command]
pub fn dismiss_suggestion(state: State<'_, AppState>, merchant: String) -> IpcResult<()> {
    Ok(recurrings::dismiss(&lock(&state), &merchant)?)
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
    Ok(slaybudget_core::tags::create(
        &lock(&state),
        &name,
        color.as_deref(),
    )?)
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: i64,
    patch: slaybudget_core::tags::TagPatch,
) -> IpcResult<()> {
    Ok(slaybudget_core::tags::update(&lock(&state), id, &patch)?)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: i64) -> IpcResult<()> {
    Ok(slaybudget_core::tags::delete(&lock(&state), id)?)
}

#[tauri::command]
pub fn add_tags(state: State<'_, AppState>, ids: Vec<i64>, tag_ids: Vec<i64>) -> IpcResult<usize> {
    Ok(slaybudget_core::tags::add(&lock(&state), &ids, &tag_ids)?)
}

#[tauri::command]
pub fn remove_tags(
    state: State<'_, AppState>,
    ids: Vec<i64>,
    tag_ids: Vec<i64>,
) -> IpcResult<usize> {
    Ok(slaybudget_core::tags::remove(
        &lock(&state),
        &ids,
        &tag_ids,
    )?)
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
    Ok(budget_plan_core::plan(&lock(&state))?)
}

#[tauri::command]
pub fn set_budget(
    state: State<'_, AppState>,
    category_id: i64,
    month: Option<String>,
    amount_cents: Option<i64>,
) -> IpcResult<()> {
    Ok(budget_plan_core::set_budget(
        &lock(&state),
        category_id,
        month.as_deref(),
        amount_cents,
    )?)
}

#[tauri::command]
pub fn set_group_budget(
    state: State<'_, AppState>,
    group_id: i64,
    amount_cents: Option<i64>,
) -> IpcResult<()> {
    Ok(budget_plan_core::set_group_budget(
        &lock(&state),
        group_id,
        amount_cents,
    )?)
}

#[tauri::command]
pub fn set_rollover(
    state: State<'_, AppState>,
    category_id: i64,
    since: Option<String>,
) -> IpcResult<()> {
    Ok(budget_plan_core::set_rollover(
        &lock(&state),
        category_id,
        since.as_deref(),
    )?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebalanceChangeDto {
    pub category_id: i64,
    pub amount_cents: i64,
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
    Ok(budget_plan_core::apply_rebalance(
        &lock(&state),
        &pairs,
        scope,
        &month,
    )?)
}
