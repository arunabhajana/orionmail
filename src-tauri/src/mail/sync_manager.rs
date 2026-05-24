use std::collections::HashSet;
use tokio::sync::Mutex as AsyncMutex;
use once_cell::sync::Lazy;
use tauri::AppHandle;
use crate::auth::account::Account;
use crate::mail::folder::MailFolder;

// Tracks which folders are currently waiting in the queue
pub static SYNC_QUEUE: Lazy<AsyncMutex<HashSet<MailFolder>>> = Lazy::new(|| AsyncMutex::new(HashSet::new()));

// Ensures only one folder syncs at a time across the entire application
pub static SYNC_LOCK: Lazy<AsyncMutex<()>> = Lazy::new(|| AsyncMutex::new(()));

pub async fn enqueue_sync(app_handle: AppHandle, account: Account, folder: MailFolder) {
    // 1. Deduplication Check
    let mut queue = SYNC_QUEUE.lock().await;
    if queue.contains(&folder) {
        log::info!("Sync for folder {} is already pending. Ignoring duplicate.", folder);
        return;
    }
    queue.insert(folder.clone());
    drop(queue);

    // 2. Spawn worker that waits for the global sync lock
    tokio::spawn(async move {
        let _guard = SYNC_LOCK.lock().await;

        // Remove from queue because we are now the active sync
        {
            let mut q = SYNC_QUEUE.lock().await;
            q.remove(&folder);
        }

        // Check folder-specific minimum sync intervals
        let last_synced_at = crate::mail::database::get_folder_sync_state(&app_handle, &folder.to_string())
            .unwrap_or(None)
            .map(|state| state.last_synced_at)
            .unwrap_or(0);
        
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let elapsed = now - last_synced_at;

        let min_interval = match folder {
            MailFolder::Inbox => 30, // Aggressive refresh (30 seconds)
            MailFolder::Sent => 300, // Lazy opportunistic refresh (5 minutes)
            MailFolder::Starred => 0, // Not synced from IMAP
        };

        if elapsed < min_interval {
            log::info!("Skipping sync for {}: only {} seconds elapsed (min: {}).", folder, elapsed, min_interval);
            return;
        }

        // 3. Execute the actual sync logic
        if let Err(e) = crate::mail::sync::sync_folder(&app_handle, account, folder.clone()).await {
            log::error!("Sync failed for folder {}: {}", folder, e);
            let _ = crate::mail::database::set_folder_sync_error(&app_handle, &folder.to_string(), &e);
        }
    });
}
