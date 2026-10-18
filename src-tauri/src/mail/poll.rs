use crate::auth::account::Account;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tokio::task::JoinHandle;

static POLL_HANDLE: Lazy<Mutex<Option<JoinHandle<()>>>> = Lazy::new(|| Mutex::new(None));

pub fn start_polling(app_handle: AppHandle, account: Account) {
    let mut lock = POLL_HANDLE.lock().unwrap();
    if lock.is_some() {
        log::info!("[POLL] Already running");
        return;
    }

    let handle = tokio::spawn(async move {
        log::info!("[POLL] Starting fallback poll loop...");
        let mut interval = tokio::time::interval(Duration::from_secs(180));
        
        // Ensure the first poll does NOT run immediately.
        // The first tick fires immediately at t=0, so we consume it.
        // We do this to wait 3 minutes before the true first fallback sync.
        interval.tick().await; 

        loop {
            // Wait 180 seconds before processing
            tokio::select! {
                _ = interval.tick() => {}
                _ = crate::mail::shutdown::POLL_TOKEN.cancelled() => {
                    log::info!("[POLL] Shutdown requested, exiting loop.");
                    break;
                }
            }
            log::info!("[POLL] Tick: Attempting fallback sync...");

            let app_clone = app_handle.clone();
            let account_clone = account.clone();

            crate::mail::sync_manager::enqueue_sync(app_clone, account_clone, crate::mail::folder::MailFolder::Inbox).await;
        }
    });

    *lock = Some(handle);
}

pub fn stop_polling() {
    // SHUTDOWN_TOKEN handles graceful exit now
}
