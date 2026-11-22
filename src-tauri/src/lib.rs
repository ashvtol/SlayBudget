//! Tauri shell: owns the database connection and exposes core use cases as commands.

mod commands;
mod notify_native;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

/// Shared application state: one SQLite connection behind a mutex.
pub struct AppState {
    pub db: Mutex<Connection>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("slaybudget.db");
            let conn = slaybudget_core::db::open_db(&db_path)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_setting,
            commands::set_setting,
            commands::list_profiles,
            commands::create_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::list_sources,
            commands::list_transactions,
            commands::count_transactions,
            commands::update_transaction,
            commands::bulk_update_transactions,
            commands::split_transaction,
            commands::unsplit_transaction,
            commands::transaction_children,
            commands::analytics_monthly,
            commands::analytics_categories,
            commands::analytics_budgets,
            commands::analytics_cashflow,
            commands::analytics_recurring,
            commands::list_recurring,
            commands::recurring_suggestions,
            commands::preview_recurring,
            commands::create_recurring,
            commands::update_recurring,
            commands::set_recurring_status,
            commands::delete_recurring,
            commands::unlink_recurring,
            commands::draft_recurring,
            commands::dismiss_suggestion,
            commands::list_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::add_tags,
            commands::remove_tags,
            commands::statement_info,
            commands::budget_plan,
            commands::set_budget,
            commands::set_group_budget,
            commands::set_rollover,
            commands::apply_rebalance,
            commands::fx_upsert_many,
            commands::fx_rate_on,
            commands::fx_latest,
            commands::fx_convert_cents,
            commands::search_transactions,
            commands::list_category_groups,
            commands::list_categories,
            commands::create_category,
            commands::update_category,
            commands::category_usage,
            commands::delete_category,
            commands::set_transaction_category,
            commands::set_transaction_type,
            commands::preview_recategorize,
            commands::apply_recategorize,
            commands::save_rule,
            commands::other_groups,
            commands::preview_ft_model,
            commands::import_ft_model,
            commands::backup_database,
            commands::export_rules,
            commands::notifications_list,
            commands::notifications_add,
            commands::notifications_mark_read,
            commands::notifications_mark_all_read,
            commands::notifications_dismiss,
            commands::notifications_pending,
            commands::notifications_mark_delivered,
            commands::notifications_refresh,
            notify_native::notify_banner,
            commands::move_category_to_group,
            commands::rename_group,
            commands::ungroup_group,
            commands::import_csv_text,
            commands::import_ofx_text,
            commands::import_pdf_doc,
            commands::migrate_legacy_json,
            commands::scan_watched_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SlayBudget");
}
