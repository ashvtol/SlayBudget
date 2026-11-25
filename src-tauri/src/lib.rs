//! Tauri shell: owns the database connection and exposes core use cases as commands.

mod commands;
mod edit_menu;
mod notify_native;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

/// Shared application state: one SQLite connection behind a mutex.
pub struct AppState {
    pub db: Mutex<Connection>,
    /// Undo and redo for the changes you make (lock after `db`).
    pub undo: Mutex<slaybudget_core::undo::UndoStack>,
    /// The Edit menu's Undo and Redo (None if the menu couldn't be set up).
    pub edit_menu: Option<edit_menu::EditMenu>,
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
        .on_menu_event(|app, event| edit_menu::on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            notify_native::install(app.handle());
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("slaybudget.db");
            let conn = slaybudget_core::db::open_db(&db_path)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            let mut undo = slaybudget_core::undo::UndoStack::new();
            // Never stops the app from opening: a failed pass leaves history as it was (it runs atomically).
            if let Err(e) = commands::sort_history_once(&conn, &mut undo) {
                eprintln!("sorting history: {e}");
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                undo: Mutex::new(undo),
                // Mac apps have a menu bar; on Windows and Linux a menu would sit inside the window, so ⌘Z there is
                // the keyboard shortcut alone.
                edit_menu: if cfg!(target_os = "macos") {
                    edit_menu::EditMenu::install(app.handle()).ok()
                } else {
                    None
                },
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
            commands::money_habits,
            commands::list_recurring,
            commands::recurring_suggestions,
            commands::preview_recurring,
            commands::create_recurring,
            commands::update_recurring,
            commands::set_recurring_status,
            commands::set_recurring_paid_back_by,
            commands::delete_recurring,
            commands::unlink_recurring,
            commands::draft_recurring,
            commands::dismiss_suggestion,
            commands::price_checks,
            commands::price_check_for,
            commands::answer_price_check,
            commands::price_history,
            commands::latest_price_changes,
            commands::look_alike_recurrings,
            commands::merge_recurrings,
            commands::keep_recurrings_apart,
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
            commands::apply_budgets,
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
            commands::keep_only_this_one,
            commands::undo_step,
            commands::set_categories,
            commands::same_merchant,
            commands::accept_suggestions,
            commands::reject_suggestions,
            commands::suggestion_count,
            commands::reset_learning,
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
            commands::delete_transactions,
            commands::list_imports,
            commands::undo_import,
            commands::duplicate_flag_for,
            commands::resolve_duplicate,
            commands::move_import,
            commands::fx_info,
            commands::statement_candidates,
            commands::read_statement,
            commands::update_account,
            commands::create_account_folders,
            commands::set_account_default_tag,
            commands::account_clues,
            commands::forget_account_clue,
            commands::undo,
            commands::redo,
            commands::undo_state,
            notify_native::notify_banner,
            notify_native::open_notification_settings,
            notify_native::notification_permission,
            notify_native::request_notification_permission,
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
