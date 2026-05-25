use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use tokio::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::{AppHandle, Manager, Emitter};
use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::message_body;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrefetchPriority {
    Immediate,
    Background,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct PrefetchRequest {
    pub folder: String,
    pub uid: u32,
}

struct BodyPrefetchManagerState {
    immediate_queue: VecDeque<PrefetchRequest>,
    background_queue: VecDeque<PrefetchRequest>,
    in_progress: HashSet<PrefetchRequest>,
    worker_running: bool,
}

pub struct BodyPrefetchManager {
    state: Mutex<BodyPrefetchManagerState>,
}

pub static PREFETCH_MANAGER: Lazy<Arc<BodyPrefetchManager>> = Lazy::new(|| {
    Arc::new(BodyPrefetchManager {
        state: Mutex::new(BodyPrefetchManagerState {
            immediate_queue: VecDeque::new(),
            background_queue: VecDeque::new(),
            in_progress: HashSet::new(),
            worker_running: false,
        }),
    })
});

impl BodyPrefetchManager {
    pub async fn enqueue(
        &self,
        app_handle: AppHandle,
        account: Account,
        mut request: PrefetchRequest,
        priority: PrefetchPriority,
    ) {
        request.folder = request.folder.to_lowercase();
        
        // Check if already fetched locally
        if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, &request.folder, request.uid) {
            log::debug!("Body cache hit: {} {}", request.folder, request.uid);
            return;
        }

        let mut state = self.state.lock().await;

        if state.in_progress.contains(&request) {
            log::debug!("Skipping duplicate prefetch: {} {}", request.folder, request.uid);
            return;
        }

        // Deduplicate in queues and handle priority upgrades
        let in_immediate = state.immediate_queue.contains(&request);
        let in_background = state.background_queue.contains(&request);

        if priority == PrefetchPriority::Immediate {
            if in_immediate {
                return; // Already high priority
            }
            if in_background {
                // Upgrade priority by removing from background
                state.background_queue.retain(|r| r != &request);
            }
            state.immediate_queue.push_back(request.clone());
            log::debug!("Body prefetch queued (Immediate): {} {}", request.folder, request.uid);
        } else {
            // Background priority
            if in_immediate || in_background {
                return; // Already queued at same or higher priority
            }
            // Cap background queue size to avoid memory bloat on massive scrolls
            if state.background_queue.len() >= 50 {
                state.background_queue.pop_front();
            }
            state.background_queue.push_back(request.clone());
            log::debug!("Body prefetch queued (Background): {} {}", request.folder, request.uid);
        }

        if !state.worker_running {
            state.worker_running = true;
            drop(state);
            self.spawn_worker(app_handle, account);
        }
    }

    fn spawn_worker(&self, app_handle: AppHandle, account: Account) {
        let manager = PREFETCH_MANAGER.clone();
        
        tokio::spawn(async move {
            loop {
                let req_opt = {
                    let mut state = manager.state.lock().await;
                    if let Some(req) = state.immediate_queue.pop_front() {
                        Some((req, PrefetchPriority::Immediate))
                    } else if let Some(req) = state.background_queue.pop_front() {
                        Some((req, PrefetchPriority::Background))
                    } else {
                        None
                    }
                };

                let (request, priority) = match req_opt {
                    Some(r) => r,
                    None => {
                        let mut state = manager.state.lock().await;
                        state.worker_running = false;
                        break;
                    }
                };

                {
                    let mut state = manager.state.lock().await;
                    state.in_progress.insert(request.clone());
                }

                // If background fetch, strictly reserve 1 permit for UI fast-paths
                if priority == PrefetchPriority::Background && message_body::CONCURRENT_FETCH_LIMIT.available_permits() <= 1 {
                    // Re-enqueue and yield to avoid starving user
                    log::debug!("Body fetch deferred due to active sync");
                    let mut state = manager.state.lock().await;
                    state.background_queue.push_front(request.clone());
                    state.in_progress.remove(&request);
                    drop(state);
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    continue;
                }

                // Check again to see if another process cached it while waiting
                if let Ok(None) = database::get_message_body_cache(&app_handle, &request.folder, request.uid) {
                    let fetch_res = message_body::fetch_and_cache_body_internal(&app_handle, &account, &request.folder, request.uid).await;
                    if fetch_res.is_ok() {
                        // Emit event for frontend
                        #[derive(serde::Serialize, Clone)]
                        struct BodyCachedPayload {
                            folder: String,
                            uid: u32,
                        }
                        let _ = app_handle.emit("mail:body_cached", BodyCachedPayload {
                            folder: request.folder.clone(),
                            uid: request.uid,
                        });
                    }
                } else {
                    log::debug!("Body cache hit (in worker) for {} {}", request.folder, request.uid);
                }

                {
                    let mut state = manager.state.lock().await;
                    state.in_progress.remove(&request);
                }

                tokio::task::yield_now().await;
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });
    }
    
    pub async fn clear_background_queue(&self) {
        let mut state = self.state.lock().await;
        state.background_queue.clear();
    }
}
