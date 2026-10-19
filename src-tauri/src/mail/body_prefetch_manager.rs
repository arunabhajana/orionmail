use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify, oneshot};
use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter};
use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::message_body::{self, MessageDetail};
use crate::mail::shutdown::PREFETCH_TOKEN;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrefetchPriority {
    Immediate,
    Search,
    Background,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct BodyKey {
    #[serde(default)]
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
}

pub struct FetchJob {
    pub key: BodyKey,
    pub account: Account,
    pub responders: Vec<oneshot::Sender<Result<MessageDetail, String>>>,
}

struct BodyPrefetchManagerState {
    immediate_queue: VecDeque<FetchJob>,
    search_queue: VecDeque<FetchJob>,
    background_queue: VecDeque<FetchJob>,
    in_progress: std::collections::HashMap<BodyKey, Vec<oneshot::Sender<Result<MessageDetail, String>>>>,
    worker_started: bool,
}

pub struct BodyPrefetchManager {
    state: Mutex<BodyPrefetchManagerState>,
    pub notify: Notify,
}

pub static PREFETCH_MANAGER: Lazy<Arc<BodyPrefetchManager>> = Lazy::new(|| {
    Arc::new(BodyPrefetchManager {
        state: Mutex::new(BodyPrefetchManagerState {
            immediate_queue: VecDeque::new(),
            search_queue: VecDeque::new(),
            background_queue: VecDeque::new(),
            in_progress: std::collections::HashMap::new(),
            worker_started: false,
        }),
        notify: Notify::new(),
    })
});

impl BodyPrefetchManager {
    pub async fn enqueue(
        &self,
        app_handle: AppHandle,
        account: Account,
        folder: String,
        uid: u32,
        priority: PrefetchPriority,
        responder: Option<oneshot::Sender<Result<MessageDetail, String>>>,
    ) {
        if priority == PrefetchPriority::Background {
            let prefs = crate::mail_preferences::load(&app_handle);
            if !prefs.prefetch_bodies || prefs.sync_paused { return; }
        }
        let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
        let key = BodyKey { account_id: account.id.clone(), folder, uid };
        
        // Skip background duplicates if cached
        if priority == PrefetchPriority::Background {
            if database::has_message_body_cache(&app_handle, &key.account_id, &key.folder, key.uid).unwrap_or(false) {
                return;
            }
        }

        let mut state = self.state.lock().await;

        if state.in_progress.contains_key(&key) {
            log::debug!("Appending responder to in-progress prefetch: {} {}", key.folder, key.uid);
            if let Some(tx) = responder {
                if let Some(responders) = state.in_progress.get_mut(&key) {
                    responders.push(tx);
                }
            }
            return;
        }

        let extracted_responder = responder;

        // Deduplicate in immediate
        if let Some(job) = state.immediate_queue.iter_mut().find(|j| j.key == key) {
            if let Some(tx) = extracted_responder {
                job.responders.push(tx);
            }
            return;
        }

        // Deduplicate in search
        if let Some(pos) = state.search_queue.iter().position(|j| j.key == key) {
            if priority == PrefetchPriority::Immediate {
                let mut job = state.search_queue.remove(pos).unwrap();
                if let Some(tx) = extracted_responder {
                    job.responders.push(tx);
                }
                state.immediate_queue.push_back(job);
            } else {
                let job = &mut state.search_queue[pos];
                if let Some(tx) = extracted_responder {
                    job.responders.push(tx);
                }
            }
            return;
        }

        // Deduplicate in background
        if let Some(pos) = state.background_queue.iter().position(|j| j.key == key) {
            if priority == PrefetchPriority::Immediate {
                // Upgrade priority by moving to immediate
                let mut job = state.background_queue.remove(pos).unwrap();
                if let Some(tx) = extracted_responder {
                    job.responders.push(tx);
                }
                state.immediate_queue.push_back(job);
                log::debug!("Body prefetch upgraded to Immediate: {} {}", key.folder, key.uid);
            } else if priority == PrefetchPriority::Search {
                let mut job = state.background_queue.remove(pos).unwrap();
                if let Some(tx) = extracted_responder {
                    job.responders.push(tx);
                }
                state.search_queue.push_back(job);
                log::debug!("Body prefetch upgraded to Search: {} {}", key.folder, key.uid);
            } else {
                let job = &mut state.background_queue[pos];
                if let Some(tx) = extracted_responder {
                    job.responders.push(tx);
                }
            }
            return;
        }

        // It's entirely new
        let mut responders = Vec::new();
        if let Some(tx) = extracted_responder {
            responders.push(tx);
        }
        
        let new_job = FetchJob { key: key.clone(), account, responders };

        if priority == PrefetchPriority::Immediate {
            state.immediate_queue.push_back(new_job);
            log::debug!("Body prefetch queued (Immediate): {} {}", key.folder, key.uid);
        } else if priority == PrefetchPriority::Search {
            state.search_queue.push_back(new_job);
            log::debug!("Body prefetch queued (Search): {} {}", key.folder, key.uid);
        } else {
            // Cap background queue size to avoid memory bloat on massive scrolls
            if state.background_queue.len() >= 16 {
                state.background_queue.pop_front();
            }
            state.background_queue.push_back(new_job);
            log::debug!("Body prefetch queued (Background): {} {}", key.folder, key.uid);
        }

        self.notify.notify_one();

        if !state.worker_started {
            state.worker_started = true;
            drop(state);
            self.spawn_worker(app_handle);
        }
    }

    fn spawn_worker(&self, app_handle: AppHandle) {
        let manager = PREFETCH_MANAGER.clone();
        
        tokio::spawn(async move {
            loop {
                let req_opt = {
                    let mut state = manager.state.lock().await;
                    if let Some(job) = state.immediate_queue.pop_front() {
                        Some((job, PrefetchPriority::Immediate))
                    } else if let Some(job) = state.search_queue.pop_front() {
                        Some((job, PrefetchPriority::Search))
                    } else if let Some(job) = state.background_queue.pop_front() {
                        Some((job, PrefetchPriority::Background))
                    } else {
                        None
                    }
                };

                let (job, priority) = match req_opt {
                    Some(j) => j,
                    None => {
                        tokio::select! {
                            _ = manager.notify.notified() => continue,
                            _ = PREFETCH_TOKEN.cancelled() => break,
                        }
                    }
                };

                {
                    let mut state = manager.state.lock().await;
                    state.in_progress.insert(job.key.clone(), job.responders);
                }

                if priority == PrefetchPriority::Background {
                    let prefs = crate::mail_preferences::load(&app_handle);
                    if !prefs.prefetch_bodies || prefs.sync_paused {
                        manager.state.lock().await.in_progress.remove(&job.key);
                        continue;
                    }
                }
                // If background fetch, strictly reserve 1 permit for UI fast-paths
                if priority == PrefetchPriority::Background && message_body::CONCURRENT_FETCH_LIMIT.available_permits() <= 1 {
                    // Re-enqueue and yield to avoid starving user
                    log::debug!("Body fetch deferred due to active sync");
                    let mut state = manager.state.lock().await;
                    let key = job.key.clone();
                    let responders = state.in_progress.remove(&key).unwrap_or_default();
                    state.background_queue.push_front(FetchJob { key: key.clone(), account: job.account, responders });
                    drop(state);
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => continue,
                        _ = PREFETCH_TOKEN.cancelled() => break,
                    }
                }

                let account = job.account.clone();

                // Double check cache in worker
                let mut should_fetch = true;
                if database::has_message_body_cache(&app_handle, &job.key.account_id, &job.key.folder, job.key.uid).unwrap_or(false) {
                    should_fetch = false;
                }

                let mut fetch_res: Result<MessageDetail, String> = Err("Not fetched".to_string());
                if should_fetch {
                    if priority == PrefetchPriority::Search {
                        fetch_res = crate::mail::search::fetch_and_index_search_message(&app_handle, &account, &job.key.folder, job.key.uid).await;
                    } else {
                        fetch_res = message_body::fetch_and_cache_body_internal(&app_handle, &account, &job.key.folder, job.key.uid).await;
                    }
                }
                
                let responders = {
                    let mut state = manager.state.lock().await;
                    state.in_progress.remove(&job.key).unwrap_or_default()
                };

                // Reply to oneshot waiters inline
                // Try to read from cache regardless of fetch_res (it may already have been cached)
                if priority == PrefetchPriority::Search && should_fetch {
                    // Search downloads headers only; a body-cache entry is not expected.
                    for tx in responders {
                        let _ = tx.send(fetch_res.clone());
                    }
                } else if responders.is_empty() {
                    // Background jobs have no UI waiter. Do not load and parse
                    // the entire cached body a second time just to discard it.
                } else if fetch_res.is_ok() || !should_fetch {
                    if let Ok(Some((cached_body, attachments_json, extracted_data_json))) = database::get_message_body_cache(&app_handle, &job.key.account_id, &job.key.folder, job.key.uid) {
                        let attachments = if let Some(json) = attachments_json {
                            serde_json::from_str(&json).unwrap_or_default()
                        } else {
                            Vec::new()
                        };
                        let extracted_data = extracted_data_json.and_then(|json| serde_json::from_str(&json).ok());
                        
                        let detail = MessageDetail { body: cached_body, attachments, extracted_data };
                        
                        for tx in responders {
                            let _ = tx.send(Ok(detail.clone()));
                        }
                    } else {
                        for tx in responders {
                            let _ = tx.send(Err("Failed to read cache after fetch".to_string()));
                        }
                    }
                } else {
                    let err_msg = fetch_res.as_ref().err().unwrap().to_string();
                    for tx in responders {
                        let _ = tx.send(Err(err_msg.clone()));
                    }
                }

                if fetch_res.is_ok() {
                    // Emit event for frontend
                    #[derive(serde::Serialize, Clone)]
                    struct BodyCachedPayload {
                        folder: String,
                        uid: u32,
                    }
                    let _ = app_handle.emit("mail:body_cached", BodyCachedPayload {
                        folder: job.key.folder.clone(),
                        uid: job.key.uid,
                    });
                }

                // State was already cleaned up
            }
            log::info!("Prefetch worker gracefully shut down");
        });
    }
    
    pub async fn clear_background_queue(&self) {
        let mut state = self.state.lock().await;
        state.background_queue.clear();
    }
}
