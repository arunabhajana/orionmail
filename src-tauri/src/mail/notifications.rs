//! Windows mail toasts use opaque snapshot IDs. Action scope stays in Rust.
mod store;
#[cfg(target_os = "windows")]
mod windows;
use crate::mail::{database, message_actions};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
struct Item {
    uid: u32,
    validity: u32,
    sender: String,
    subject: String,
}
#[derive(Clone)]
struct Batch {
    token: String,
    account_id: String,
    display_tag: String,
    items: Vec<Item>,
    created_at: i64,
}
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static PENDING: Lazy<Mutex<VecDeque<(String, String)>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static REFRESHING: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

static READY: Lazy<tokio::sync::watch::Sender<Option<Result<(), String>>>> =
    Lazy::new(|| tokio::sync::watch::channel(None).0);
async fn wait_ready() -> Result<(), String> {
    let mut ready = READY.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(12), async {
        loop {
            if let Some(result) = ready.borrow().clone() {
                return result;
            }
            ready
                .changed()
                .await
                .map_err(|_| "Notification initialization stopped".to_string())?;
        }
    })
    .await
    .map_err(|_| {
        "Windows notification registration is still unavailable; check the Tauri terminal"
            .to_string()
    })?
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let result = (|| {
        store::init(app)?;
        #[cfg(target_os = "windows")]
        windows::initialize(app)?;
        Ok(())
    })();
    READY.send_replace(Some(result.clone()));
    result
}
pub fn refresh_policy(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if wait_ready().await.is_ok() {
            let _ = tauri::async_runtime::spawn_blocking(move || refresh_policy_inner(&app)).await;
        }
    });
}
fn refresh_policy_inner(app: &AppHandle) {
    let result = (|| -> Result<(), String> {
        let _guard = WRITE_LOCK.lock().map_err(|_| "Notifications unavailable")?;
        for account in crate::auth::session::load_profile_metadata(app).0 {
            if let Some(batch) = store::latest(app, &account.id)? {
                if permitted(app) {
                    let items = store::unread(app, &account.id, batch.items.clone())?;
                    let batch = Batch {
                        token: uuid::Uuid::new_v4().simple().to_string(),
                        items,
                        created_at: chrono::Utc::now().timestamp(),
                        ..batch
                    };
                    store::save(app, &batch)?;
                    render(app, &batch, false)?;
                } else {
                    #[cfg(target_os = "windows")]
                    windows::remove(&batch.display_tag)?;
                }
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("Could not apply notification preferences: {}", e);
    }
}
pub fn forget_account(app: &AppHandle, account: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Notifications unavailable")?;
    let previous = store::latest(app, account)?;
    database::open_connection(app)?
        .execute(
            "DELETE FROM mail_notification_snapshots WHERE account_id=?1",
            [account],
        )
        .map_err(|e| e.to_string())?;
    if let Some(batch) = previous {
        #[cfg(target_os = "windows")]
        if let Err(e) = windows::remove(&batch.display_tag) {
            log::warn!("Could not dismiss removed account's notification: {}", e);
        }
    }
    Ok(())
}
pub fn is_activation_launch() -> bool {
    std::env::args().any(|arg| arg == "--notification-server")
}
pub fn display_name() -> &'static str {
    if cfg!(debug_assertions) {
        "OrionMail Dev"
    } else {
        "OrionMail"
    }
}
fn xml(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn clip(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}
fn sender(value: &str) -> String {
    let name = value
        .split('<')
        .next()
        .unwrap_or(value)
        .trim()
        .trim_matches('"');
    clip(if name.is_empty() { value } else { name }, 80)
}
fn show_window(app: &AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}
fn permitted(app: &AppHandle) -> bool {
    crate::mail_preferences::load(app).notifications_allowed()
        && crate::auth::app_lock::require_unlocked(app).is_ok()
}
fn render(app: &AppHandle, batch: &Batch, popup: bool) -> Result<(), String> {
    if batch.items.is_empty() {
        #[cfg(target_os = "windows")]
        windows::remove(&batch.display_tag)?;
        return Ok(());
    }
    if !permitted(app) {
        return Ok(());
    }
    let prefs = crate::mail_preferences::load(app);
    let count = batch.items.len();
    let title = if prefs.hide_notification_content {
        if count == 1 {
            "New email".into()
        } else {
            format!("{count} new emails")
        }
    } else if count == 1 {
        sender(&batch.items[0].sender)
    } else {
        format!("{count} new emails")
    };
    let body = if prefs.hide_notification_content {
        "Open OrionMail to read your messages.".into()
    } else if count == 1 {
        clip(&batch.items[0].subject, 180)
    } else {
        let mut lines = batch
            .items
            .iter()
            .take(3)
            .map(|i| format!("{} — {}", sender(&i.sender), clip(&i.subject, 90)))
            .collect::<Vec<_>>();
        if count > 3 {
            lines.push(format!("+{} more in Inbox", count - 3));
        }
        lines.join("\n")
    };
    let account = crate::auth::session::load_profile_metadata(app).0
        .into_iter()
        .find(|a| a.id == batch.account_id)
        .ok_or("Notification account was removed")?;
    let attribution = if prefs.hide_notification_content {
        "Inbox".to_string()
    } else {
        clip(&account.email, 100)
    };
    #[cfg(target_os = "windows")]
    windows::show(
        batch,
        &title,
        &body,
        &attribution,
        prefs.notification_sound && popup,
        popup,
    )?;
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
static NEW_MAIL: Lazy<Mutex<std::collections::HashMap<String, HashSet<u32>>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
pub fn show_new_emails(app: &AppHandle, account: &str, new_emails: &[(String, String, u32)]) {
    let Ok(mut batches) = NEW_MAIL.lock() else {
        return;
    };
    let start = !batches.contains_key(account);
    let pending = batches.entry(account.to_string()).or_default();
    for (_, _, uid) in new_emails {
        if pending.len() < 500 {
            pending.insert(*uid);
        }
    }
    if !start {
        return;
    }
    drop(batches);
    let app = app.clone();
    let account = account.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let ready = wait_ready().await;
        let uids = NEW_MAIL
            .lock()
            .ok()
            .and_then(|mut batches| batches.remove(&account))
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();
        if let Err(error) = ready {
            log::warn!("New mail notification unavailable: {}", error);
            return;
        }
        let _ = tauri::async_runtime::spawn_blocking(move || {
            show_new_emails_inner(&app, &account, &uids)
        })
        .await;
    });
}
fn show_new_emails_inner(app: &AppHandle, account: &str, uids: &[u32]) {
    if !permitted(app) {
        return;
    }
    if !crate::auth::session::load_profile_metadata(app).0.iter().any(|profile|profile.id==account){return;}
    let result = (|| -> Result<(), String> {
        let _guard = WRITE_LOCK.lock().map_err(|_| "Notifications unavailable")?;
        let previous = store::latest(app, account)?;
        let now = chrono::Utc::now().timestamp();
        let mut keep_previous = previous
            .as_ref()
            .is_some_and(|batch| batch.created_at + 1800 > now);
        #[cfg(target_os = "windows")]
        if let Some(batch) = &previous {
            keep_previous &= windows::present(&batch.display_tag)?;
        }
        let mut items = if keep_previous {
            store::unread(app, account, previous.as_ref().unwrap().items.clone())?
        } else {
            Vec::new()
        };
        let messages = database::get_messages_by_uids(app, account, "inbox", uids)?;
        let mut added = false;
        for message in messages
            .into_iter()
            .filter(|m| !m.seen && m.uid_validity > 0)
        {
            if items
                .iter()
                .any(|i| i.uid == message.uid && i.validity == message.uid_validity)
            {
                continue;
            }
            added = true;
            items.insert(
                0,
                Item {
                    uid: message.uid,
                    validity: message.uid_validity,
                    sender: message.from,
                    subject: message.subject,
                },
            );
        }
        if !added {
            return Ok(());
        }
        items.truncate(500);
        let token = uuid::Uuid::new_v4().simple().to_string();
        let batch = Batch {
            display_tag: previous
                .as_ref()
                .map(|b| b.display_tag.clone())
                .unwrap_or_else(|| token[..16].to_string()),
            token,
            account_id: account.into(),
            items,
            created_at: now,
        };
        store::save(app, &batch)?;
        render(app, &batch, true)?;
        database::update_global_notification_time(app, account, now)
    })();
    if let Err(error) = result {
        log::warn!("Could not display mail notification: {}", error);
    }
}
pub fn schedule_refresh(app: &AppHandle, account: &str) {
    let Ok(mut pending) = REFRESHING.lock() else {
        return;
    };
    if !pending.insert(account.into()) {
        return;
    }
    let app = app.clone();
    let account = account.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if let Err(error) = wait_ready().await {
            if let Ok(mut pending) = REFRESHING.lock() {
                pending.remove(&account);
            }
            log::warn!("Notification refresh unavailable: {}", error);
            return;
        }
        let refresh_app = app.clone();
        let refresh_account = account.clone();
        let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let app = refresh_app;
            let account = refresh_account;
            let _guard = WRITE_LOCK.lock().map_err(|_| "Notifications unavailable")?;
            let Some(previous) = store::latest(&app, &account)? else {
                return Ok(());
            };
            let items = store::unread(&app, &account, previous.items.clone())?;
            if items.len() == previous.items.len() {
                return Ok(());
            }
            let batch = Batch {
                token: uuid::Uuid::new_v4().simple().to_string(),
                items,
                created_at: chrono::Utc::now().timestamp(),
                ..previous
            };
            store::save(&app, &batch)?;
            render(&app, &batch, false)
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|value| value);
        if let Ok(mut pending) = REFRESHING.lock() {
            pending.remove(&account);
        }
        if let Err(e) = result {
            log::warn!("Could not refresh mail notification: {}", e);
        }
    });
}
// Callback arguments can select only an existing, short-lived snapshot/action.
fn receive(app: &AppHandle, args: &str) {
    if args == "app:open" {
        show_window(app);
        return;
    }
    if args.len() > 80 {
        return;
    }
    let Some((token, action)) = args.split_once(':') else {
        return;
    };
    if token.len() != 32
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
        || !matches!(action, "open" | "read")
    {
        return;
    }
    if action == "read" && crate::auth::app_lock::require_unlocked(app).is_ok() {
        let app = app.clone();
        let token = token.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = mark_snapshot_read(&app, &token).await {
                report_error(&app, &error);
            }
        });
    } else {
        if let Ok(mut pending) = PENDING.lock() {
            if pending.len() < 20 {
                pending.push_back((token.into(), action.into()));
            }
        }
        show_window(app);
        let _ = app.emit("mail:notification_navigation", ());
    }
}
fn report_error(app: &AppHandle, error: &str) {
    refresh_policy(app);
    log::warn!("Notification action could not finish: {}", error);
    let _ = app.emit("mail:notification_error", error);
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(|| {
        if let Err(e) = windows::status(
            "Mail action needs attention",
            "Open OrionMail to check the action. Saved operations retry during sync.",
        ) {
            log::warn!("Notification status failed: {}", e);
        }
    });
}
async fn mark_snapshot_read(app: &AppHandle, token: &str) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(app)?;
    let batch = store::find(app, token)?;
    let account = crate::auth::bootstrap::ensure_active_account(app).await?;
    if account.id != batch.account_id {
        return Err(
            "Switch to the account shown on this notification before acting on its mail.".into(),
        );
    }
    let mut queued = 0;
    let mut conflicts = 0;
    {
        let _mutation = message_actions::MUTATION_LOCK.lock().await;
        for item in &batch.items {
            let cached = database::get_messages_by_uids(app, &account.id, "inbox", &[item.uid])?;
            let Some(message) = cached.first() else {
                conflicts += 1;
                continue;
            };
            if message.uid_validity != item.validity {
                conflicts += 1;
                continue;
            }
            if message.seen {
                continue;
            }
            database::enqueue_message_action(
                app,
                &account.id,
                "inbox",
                "INBOX",
                item.uid,
                "seen",
                Some(true),
                matches!(account.provider, crate::auth::account::MailProvider::Google),
            )?;
            queued += 1;
        }
    }
    if queued > 0 {
        // Drain healthy bulk work without waiting for the next polling cycle.
        // Stop as soon as a pass makes no progress (offline/provider rejection).
        let mut remaining = store::unread(app, &account.id, batch.items.clone())?.len();
        for _ in 0..((queued + 49) / 50 + 1) {
            message_actions::retry_pending(app, &account).await;
            let count = store::unread(app, &account.id, batch.items.clone())?.len();
            if count == 0 || count >= remaining {
                break;
            }
            remaining = count;
        }
    }
    schedule_refresh(app, &account.id);
    let remaining = store::unread(app, &account.id, batch.items)?;
    if conflicts > 0 {
        return Err(
            "Some messages changed or left Inbox. Refresh Inbox before trying again.".into(),
        );
    }
    if !remaining.is_empty() {
        return Err("Read updates are saved on this device and will retry during sync.".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct Navigation {
    account_id: String,
    message: Option<crate::mail::message_list::MessageHeader>,
}
#[tauri::command]
pub async fn consume_notification_navigation(
    app_handle: AppHandle,
) -> Result<Option<Navigation>, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    loop {
        let next = PENDING
            .lock()
            .map_err(|_| "Notification actions unavailable")?
            .pop_front();
        let Some((token, action)) = next else {
            return Ok(None);
        };
        if action == "read" {
            mark_snapshot_read(&app_handle, &token).await?;
            continue;
        }
        let batch = store::find(&app_handle, &token)?;
        let active = crate::auth::session::get_active_account(&app_handle)
            .ok_or("Sign in to open this notification")?;
        if active.id != batch.account_id {
            return Err(
                "Switch to the account shown on this notification to open its mail.".into(),
            );
        }
        let message = if batch.items.len() == 1 {
            let item = &batch.items[0];
            database::get_messages_by_uids(&app_handle, &batch.account_id, "inbox", &[item.uid])?
                .into_iter()
                .find(|m| m.uid_validity == item.validity)
        } else {
            None
        };
        return Ok(Some(Navigation {
            account_id: batch.account_id,
            message,
        }));
    }
}
#[tauri::command]
pub async fn show_background_notification(app_handle: AppHandle) -> Result<(), String> {
    wait_ready().await?;
    tauri::async_runtime::spawn_blocking(move || background_notification_inner(&app_handle))
        .await
        .map_err(|e| e.to_string())?
}
fn background_notification_inner(app_handle: &AppHandle) -> Result<(), String> {
    if !permitted(&app_handle) {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    windows::status(
        "Running in the background",
        "OrionMail will keep syncing mail and notifying you. Use the tray icon to reopen it.",
    )?;
    Ok(())
}

#[tauri::command]
pub async fn preview_notification(app_handle: AppHandle) -> Result<(), String> {
    wait_ready().await?;
    tauri::async_runtime::spawn_blocking(move || preview_inner(&app_handle))
        .await
        .map_err(|e| e.to_string())?
}
fn preview_inner(app_handle: &AppHandle) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    if !permitted(&app_handle) {
        return Err("Save your notification preferences and turn off Do Not Disturb or quiet hours before previewing.".into());
    }
    #[cfg(target_os = "windows")]
    windows::status(
        "Notifications are ready",
        &format!(
            "{} will show new mail here. Incoming messages include Inbox and read actions.",
            display_name()
        ),
    )?;
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app_handle
            .notification()
            .builder()
            .title(display_name())
            .body("Notifications are ready.")
            .show()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn open_notification_settings(app_handle: AppHandle) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| open::that("ms-settings:notifications"))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Use your operating system's notification settings.".into())
    }
}
