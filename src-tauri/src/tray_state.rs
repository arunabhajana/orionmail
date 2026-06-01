use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use once_cell::sync::Lazy;
use tokio::time::{sleep, Duration};

struct TrayState {
    unread_count: u32,
    last_sync_timestamp: Option<i64>,
}

static STATE: Lazy<Mutex<TrayState>> = Lazy::new(|| Mutex::new(TrayState {
    unread_count: 0,
    last_sync_timestamp: None,
}));

pub fn init_from_db(app: &AppHandle) {
    let mut state = STATE.lock().unwrap();
    if let Ok(db_state) = crate::mail::database::get_global_sync_state(app) {
        state.last_sync_timestamp = db_state.last_sync_at;
    }
    if let Ok(count) = crate::mail::database::get_global_unread_count(app) {
        state.unread_count = count;
    }
}

pub fn refresh_unread_count_from_db(app: &AppHandle) {
    if let Ok(count) = crate::mail::database::get_global_unread_count(app) {
        {
            let mut state = STATE.lock().unwrap();
            state.unread_count = count;
        }
        update_tray_now(app);
    }
}

pub fn set_last_sync_time(app: &AppHandle) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    {
        let mut state = STATE.lock().unwrap();
        state.last_sync_timestamp = Some(now);
    }
    update_tray_now(app);
}

fn format_time_ago(timestamp: Option<i64>) -> String {
    if let Some(ts) = timestamp {
        if ts == 0 {
            return "Never synced".to_string();
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let diff = now.saturating_sub(ts);
        
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
    } else {
        "Never synced".to_string()
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
    init_from_db(&app);
    update_tray_now(&app);
    
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(60)).await;
            update_tray_now(&app);
        }
    });
}
