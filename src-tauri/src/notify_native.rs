//! macOS banners whose click opens the item.
//!
//! In the installed app (a signed .app bundle) banners go through Apple's UserNotifications: SlayBudget asks for
//! permission once, banners show even while SlayBudget is in front (the delegate says so), and the app can tell what
//! macOS allows. A click brings the app forward and the webview gets `notification-click` with the item's id.
//!
//! A development build isn't a bundle, and UserNotifications refuses to run there, so it falls back to
//! mac-notification-sys (the older API: banners from the app in front only reach Notification Center).

#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Manager};

/// Bring the main window forward and tell the webview which item was clicked.
#[cfg(target_os = "macos")]
fn open_item(app: &AppHandle, id: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit("notification-click", id);
}

#[cfg(target_os = "macos")]
mod user_notifications {
    use super::open_item;
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotification, UNNotificationPresentationOptions, UNNotificationRequest,
        UNNotificationResponse, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::AppHandle;

    pub struct Ivars {
        app: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "SlayBudgetNotificationDelegate"]
        #[ivars = Ivars]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            /// Show the banner even while SlayBudget is the app in front.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                done.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            /// A click opens the item the banner is about.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                done: &DynBlock<dyn Fn()>,
            ) {
                let identifier = response.notification().request().identifier().to_string();
                let id = identifier.split('#').next().unwrap_or_default().to_string();
                open_item(&self.ivars().app, id);
                done.call(());
            }
        }
    );

    impl Delegate {
        fn new(app: AppHandle) -> Retained<Self> {
            let this = Self::alloc().set_ivars(Ivars { app });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// UserNotifications only works inside an app bundle (the installed app), not a development build.
    pub fn available() -> bool {
        let bundle = NSBundle::mainBundle();
        bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
    }

    /// Become the notification delegate (call once, at launch). The delegate lives as long as the app.
    pub fn install(app: AppHandle) {
        if !available() {
            return;
        }
        let delegate = Delegate::new(app);
        UNUserNotificationCenter::currentNotificationCenter()
            .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        std::mem::forget(delegate);
    }

    pub fn send(id: &str, title: &str, body: &str) {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        // Each banner needs its own identifier; the item's id comes first so a click can find it.
        let identifier =
            NSString::from_str(&format!("{id}#{}", NEXT.fetch_add(1, Ordering::Relaxed)));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            &content,
            None,
        );
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, None);
    }

    /// "allowed", "quiet" (alerts only in Notification Center), "denied", "notAsked", or "unknown".
    pub fn permission() -> &'static str {
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            let settings = unsafe { settings.as_ref() };
            let status = settings.authorizationStatus();
            let answer = if status == UNAuthorizationStatus::NotDetermined {
                "notAsked"
            } else if status == UNAuthorizationStatus::Denied {
                "denied"
            } else if settings.alertStyle() == UNAlertStyle::None {
                "quiet"
            } else {
                "allowed"
            };
            let _ = tx.send(answer);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getNotificationSettingsWithCompletionHandler(&block);
        rx.recv_timeout(Duration::from_secs(3)).unwrap_or("unknown")
    }

    /// Ask macOS to allow banners (it prompts the first time), then report what it allows.
    pub fn request() -> &'static str {
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = tx.send(());
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &block,
            );
        // The prompt waits for you; give it a minute before answering with what's known.
        let _ = rx.recv_timeout(Duration::from_secs(60));
        permission()
    }
}

/// At launch: in the installed app, handle banner clicks and show banners while SlayBudget is in front.
#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    user_notifications::install(app.clone());
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle) {}

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
    if user_notifications::available() {
        user_notifications::send(&id, &title, &body);
        return Ok(());
    }
    // A development build: the older API, which waits for the click on its own thread.
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
            open_item(&app, id);
        }
    });
    Ok(())
}

/// What macOS does with SlayBudget's banners: "allowed", "quiet", "denied", "notAsked", or "unknown" (a development
/// build or another platform, where it can't tell).
#[tauri::command]
pub async fn notification_permission() -> String {
    #[cfg(target_os = "macos")]
    if user_notifications::available() {
        return tauri::async_runtime::spawn_blocking(user_notifications::permission)
            .await
            .unwrap_or("unknown")
            .to_string();
    }
    "unknown".into()
}

/// Ask macOS to allow banners (it prompts once), then say what it allows.
#[tauri::command]
pub async fn request_notification_permission() -> String {
    #[cfg(target_os = "macos")]
    if user_notifications::available() {
        return tauri::async_runtime::spawn_blocking(user_notifications::request)
            .await
            .unwrap_or("unknown")
            .to_string();
    }
    "unknown".into()
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
