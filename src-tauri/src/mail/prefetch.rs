use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::message_body::fetch_and_cache_body_internal;
use tauri::AppHandle;
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;

static PREFETCH_QUEUE: Lazy<Mutex<VecDeque<u32>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static PREFETCH_IN_PROGRESS: Lazy<Mutex<HashSet<u32>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static PREFETCH_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

pub async fn enqueue_prefetch(app_handle: AppHandle, account: Account, uid: u32) {
    // Check if already fetched locally
    if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, "INBOX", uid) {
        return;
    }

    {
        let in_progress = PREFETCH_IN_PROGRESS.lock().await;
        if in_progress.contains(&uid) {
            return;
        }
    }

    let mut queue = PREFETCH_QUEUE.lock().await;
    if queue.contains(&uid) {
        return;
    }

    if queue.len() >= 25 {
        queue.pop_front();
    }
    
    queue.push_back(uid);
    log::debug!("Prefetch enqueue: {}", uid);

    if !PREFETCH_WORKER_RUNNING.swap(true, Ordering::SeqCst) {
        spawn_prefetch_worker(app_handle, account);
    }
}

pub async fn clear_prefetch_queue() {
    let mut queue = PREFETCH_QUEUE.lock().await;
    let cleared_count = queue.len();
    queue.clear();
    if cleared_count > 0 {
        log::debug!("Cleared {} stale items from prefetch queue due to rapid scrolling", cleared_count);
    }
}

fn spawn_prefetch_worker(app_handle: AppHandle, account: Account) {
    tokio::spawn(async move {
        loop {
            let uid_opt = {
                let mut queue = PREFETCH_QUEUE.lock().await;
                queue.pop_front()
            };

            if let Some(uid) = uid_opt {
                {
                    let mut in_progress = PREFETCH_IN_PROGRESS.lock().await;
                    in_progress.insert(uid);
                }

                // Backpressure: Reserve 1 permit strictly for foreground user fetches
                if crate::mail::message_body::CONCURRENT_FETCH_LIMIT.available_permits() <= 1 {
                    // Re-enqueue for later, as we don't want to starve the user
                    let mut queue = PREFETCH_QUEUE.lock().await;
                    queue.push_front(uid);
                    
                    let mut in_progress = PREFETCH_IN_PROGRESS.lock().await;
                    in_progress.remove(&uid);
                    
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    continue;
                }

                log::debug!("Prefetch start: {}", uid);

                // Double check it wasn't fetched while sitting in queue
                if let Ok(None) = database::get_message_body_cache(&app_handle, "INBOX", uid) {
                    let _ = fetch_and_cache_body_internal(&app_handle, &account, uid).await;
                }

                log::debug!("Prefetch complete: {}", uid);

                {
                    let mut in_progress = PREFETCH_IN_PROGRESS.lock().await;
                    in_progress.remove(&uid);
                }

                tokio::task::yield_now().await;
                tokio::time::sleep(Duration::from_millis(50)).await;
            } else {
                PREFETCH_WORKER_RUNNING.store(false, Ordering::SeqCst);
                
                // One final check to prevent race conditions during shutdown
                let queue = PREFETCH_QUEUE.lock().await;
                if !queue.is_empty() {
                    if !PREFETCH_WORKER_RUNNING.swap(true, Ordering::SeqCst) {
                        continue;
                    }
                }
                break;
            }
        }
    });
}
