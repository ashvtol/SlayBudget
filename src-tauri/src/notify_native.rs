//! macOS banners whose click opens the item: sent with mac-notification-sys on a background thread (waiting for the
//! click blocks), then the app comes forward and the webview gets `notification-click` with the item's id.
//! Verified on macOS 27.2 in the T0 spike (docs/superpowers/plans/2026-11-22-notification-center.md).

#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Manager};

/// Elsewhere the app falls back to the notification plugin (no click-through).
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn notify_banner(
    _app: tauri::AppHandle,
    _id: String,
    _title: String,
    _body: String,
) -> Result<(), String> {
    Err("clickable banners are macOS only".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn notify_banner(
    app: AppHandle,
    id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    // The library allows setting the sending app once per run; remember whether that worked.
    static SET: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    let bundle = app.config().identifier.clone();
    SET.get_or_init(|| mac_notification_sys::set_application(&bundle).map_err(|e| e.to_string()))
        .clone()?;
    std::thread::spawn(move || {
        let response = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .wait_for_click(true)
            .send();
        if matches!(
            response,
            Ok(mac_notification_sys::NotificationResponse::Click)
        ) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit("notification-click", id);
        }
    });
    Ok(())
}

/// Open System Settings > Notifications, where SlayBudget's banners are allowed or not.
#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("notification settings are macOS only".into())
    }
}
