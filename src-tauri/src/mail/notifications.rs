use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use std::sync::Mutex;
use std::time::{Instant, Duration};
use std::collections::HashMap;
use once_cell::sync::Lazy;

struct NotificationState {
    last_notification_time: Instant,
    recent_uids: HashMap<(String, u32), Instant>,
}

static STATE: Lazy<Mutex<NotificationState>> = Lazy::new(|| Mutex::new(NotificationState {
    last_notification_time: Instant::now() - Duration::from_secs(60),
    recent_uids: HashMap::new(),
}));

fn clean_sender(from: &str) -> String {
    let name_part = from.split('<').next().unwrap_or(from).trim();
    if !name_part.is_empty() && name_part != from {
        name_part.to_string()
    } else {
        // Fallback to extracting just the email address without the brackets
        if let Some(start) = from.find('<') {
            if let Some(end) = from.find('>') {
                return from[start+1..end].to_string();
            }
        }
        from.to_string()
    }
}

pub fn show_new_emails(app: &AppHandle, account_id: &str, new_emails: &[(String, String, u32)]) {
    let prefs = crate::mail_preferences::load(app);
    // Do not expose message content while the native app lock is closed.
    if !prefs.notifications_allowed() || crate::auth::app_lock::require_unlocked(app).is_err() { return; }
    let mut state = match STATE.lock() { Ok(state) => state, Err(_) => return };
    let now = Instant::now();
    
    // Clean up expired UIDs (older than 5 minutes)
    state.recent_uids.retain(|_, time| now.duration_since(*time) < Duration::from_secs(300));
    
    // Deduplicate
    let mut deduped_emails = Vec::new();
    for email in new_emails {
        let key = (account_id.to_string(), email.2);
        if !state.recent_uids.contains_key(&key) {
            state.recent_uids.insert(key, now);
            deduped_emails.push(email.clone());
        }
    }
    
    if deduped_emails.is_empty() {
        return;
    }
    
    state.last_notification_time = now;
    
    let count = deduped_emails.len();
    
    let current_timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let _ = crate::mail::database::update_global_notification_time(app, account_id, current_timestamp);

    if count >= 4 {
        // Summary notification
        let mut body = String::new();
        for (i, (from, subject, _)) in deduped_emails.iter().enumerate() {
            if i == 3 {
                body.push_str(&format!("+{} more\n", count - 3));
                break;
            }
            body.push_str(&format!("{} - {}\n", clean_sender(from), subject));
        }
        
        let body = if prefs.hide_notification_content { format!("{} new messages in your Inbox", count) } else { body.trim().to_string() };
        app.notification()
            .builder()
            .sound(if prefs.notification_sound { "Default" } else { "" })
            .title(format!("{} new emails", count))
            .body(body)
            .icon("icons/128x128.png")
            .action_type_id("summary_email")
            .show()
            .ok();
    } else {
        // Individual notifications
        for (from, subject, uid) in deduped_emails {
            app.notification()
                .builder()
                .title(if prefs.hide_notification_content { "New email".to_string() } else { clean_sender(&from) })
                .body(if prefs.hide_notification_content { "You have a new message in your Inbox." } else { &subject })
                .sound(if prefs.notification_sound { "Default" } else { "" })
                .icon("icons/128x128.png")
                .action_type_id("new_email")
                .extra("uid", uid.to_string())
                .show()
                .ok();
        }
    }
}
