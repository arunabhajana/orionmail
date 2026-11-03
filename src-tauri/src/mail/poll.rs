use crate::auth::account::Account;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tokio::task::JoinHandle;

static POLL_HANDLE: Lazy<Mutex<std::collections::HashMap<String, JoinHandle<()>>>> = Lazy::new(Default::default);

pub fn start_polling(app_handle: AppHandle, account: Account) {
    let mut lock = POLL_HANDLE.lock().unwrap();
    if lock.get(&account.id).is_some_and(|handle| !handle.is_finished()) {
        log::info!("[POLL] Already running");
        return;
    }

    let account_id = account.id.clone();
    let handle = tokio::spawn(async move {
        log::info!("[POLL] Starting fallback poll loop...");
        loop {
            let seconds = crate::mail_preferences::load(&app_handle).poll_interval.parse::<u64>().unwrap_or(180);
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(seconds)) => {}
                _ = crate::mail::shutdown::POLL_TOKEN.cancelled() => { break; }
            }
            crate::cache_preferences::kick(&app_handle,false);
            log::info!("[POLL] Tick: Attempting fallback sync...");

            let app_clone = app_handle.clone();
            let account_clone = account.clone();

            crate::mail::sync_manager::enqueue_sync(app_clone, account_clone, crate::mail::folder::MailFolder::Inbox).await;
        }
    });

    lock.insert(account_id, handle);
}

pub fn stop_account(account_id: &str) {
    if let Some(handle) = POLL_HANDLE.lock().unwrap().remove(account_id) { handle.abort(); }
}
