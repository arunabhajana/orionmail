use crate::auth::account::Account;
use crate::mail::sync::sync_inbox;
use crate::mail::sync::SYNC_LOCK;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tokio::task::JoinHandle;
use futures::FutureExt;

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
            interval.tick().await;
            log::info!("[POLL] Tick: Attempting fallback sync...");

            let app_clone = app_handle.clone();
            let account_clone = account.clone();

            // Check if a sync is already running via IDLE or manual refresh
            if let Ok(_guard) = SYNC_LOCK.try_lock() {
                // Ensure a panic inside sync block does not silently kill the poll loop
                let result = std::panic::AssertUnwindSafe(sync_inbox(&app_clone, account_clone))
                    .catch_unwind()
                    .await;

                match result {
                    Ok(Ok(_)) => {
                        log::info!("[POLL] Sync completed successfully");
                    }
                    Ok(Err(e)) => {
                        log::error!("[POLL] Sync failed: {}", e);
                    }
                    Err(_) => {
                        log::error!("[POLL] Panic recovered in polling loop during sync_inbox");
                    }
                }
            } else {
                log::info!("[POLL] Sync already running. Skipping tick.");
            }
        }
    });

    *lock = Some(handle);
}

pub fn stop_polling() {
    let mut lock = POLL_HANDLE.lock().unwrap();
    if let Some(handle) = lock.take() {
        log::info!("[POLL] Stopping fallback poll loop...");
        handle.abort();
    }
}
