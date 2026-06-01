use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use once_cell::sync::Lazy;
use tokio::time::{sleep, Duration};

struct TrayState {
    unread_count: u32,
    last_sync_timestamp: i64,
}

static STATE: Lazy<Mutex<TrayState>> = Lazy::new(|| Mutex::new(TrayState {
    unread_count: 0,
    last_sync_timestamp: 0,
}));

pub fn set_unread_count(app: &AppHandle, count: u32) {
    {
        let mut state = STATE.lock().unwrap();
        state.unread_count = count;
    }
    update_tray_now(app);
}

pub fn set_last_sync_time(app: &AppHandle) {
    {
        let mut state = STATE.lock().unwrap();
        state.last_sync_timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    }
    update_tray_now(app);
}

fn format_time_ago(timestamp: i64) -> String {
    if timestamp == 0 {
        return "Never synced".to_string();
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let diff = now.saturating_sub(timestamp);
    
    if diff < 60 {
        "just now".to_string()
    } else if diff < 3600 {
        let mins = diff / 60;
        format!("{} min ago", mins)
    } else if diff < 86400 {
        let hours = diff / 3600;
        format!("{} hour{} ago", hours, if hours == 1 { "" } else { "s" })
    } else {
        let days = diff / 86400;
        format!("{} day{} ago", days, if days == 1 { "" } else { "s" })
    }
}

pub fn update_tray_now(app: &AppHandle) {
    let (count, ts) = {
        let state = STATE.lock().unwrap();
        (state.unread_count, state.last_sync_timestamp)
    };
    
    if let Some(tray) = app.tray_by_id("main") {
        let time_str = format_time_ago(ts);
        
        let text = format!(
            "OrionMail\n{} unread email{}\nLast synced {}",
            count,
            if count == 1 { "" } else { "s" },
            time_str
        );
        let _ = tray.set_tooltip(Some(text));
    }
}

pub fn spawn_tray_update_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(60)).await;
            update_tray_now(&app);
        }
    });
}
