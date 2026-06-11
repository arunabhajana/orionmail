use std::collections::{HashSet, VecDeque};
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
    Background,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct BodyKey {
    pub folder: String,
    pub uid: u32,
}

pub struct FetchJob {
    pub key: BodyKey,
    pub responders: Vec<oneshot::Sender<Result<MessageDetail, String>>>,
}

struct BodyPrefetchManagerState {
    immediate_queue: VecDeque<FetchJob>,
    background_queue: VecDeque<FetchJob>,
    in_progress: HashSet<BodyKey>,
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
            background_queue: VecDeque::new(),
            in_progress: HashSet::new(),
            worker_started: false,
        }),
        notify: Notify::new(),
    })
});

impl BodyPrefetchManager {
    pub async fn enqueue(
        &self,
        app_handle: AppHandle,
        _account: Account,
        folder: String,
        uid: u32,
        priority: PrefetchPriority,
        responder: Option<oneshot::Sender<Result<MessageDetail, String>>>,
    ) {
        let key = BodyKey { folder: folder.to_lowercase(), uid };
        
        // Skip background duplicates if cached
        if priority == PrefetchPriority::Background {
            if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, &key.folder, key.uid) {
                return;
            }
        }

        let mut state = self.state.lock().await;

        if state.in_progress.contains(&key) {
            log::debug!("Skipping duplicate prefetch: {} {}", key.folder, key.uid);
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
        
        let new_job = FetchJob { key: key.clone(), responders };

        if priority == PrefetchPriority::Immediate {
            state.immediate_queue.push_back(new_job);
            log::debug!("Body prefetch queued (Immediate): {} {}", key.folder, key.uid);
        } else {
            // Cap background queue size to avoid memory bloat on massive scrolls
            if state.background_queue.len() >= 50 {
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
                    state.in_progress.insert(job.key.clone());
                }

                // If background fetch, strictly reserve 1 permit for UI fast-paths
                if priority == PrefetchPriority::Background && message_body::CONCURRENT_FETCH_LIMIT.available_permits() <= 1 {
                    // Re-enqueue and yield to avoid starving user
                    log::debug!("Body fetch deferred due to active sync");
                    let mut state = manager.state.lock().await;
                    let key = job.key.clone();
                    state.background_queue.push_front(job);
                    state.in_progress.remove(&key);
                    drop(state);
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => continue,
                        _ = PREFETCH_TOKEN.cancelled() => break,
                    }
                }

                let account = match crate::auth::bootstrap::ensure_active_account(&app_handle).await {
                    Ok(acc) => acc,
                    Err(_) => {
                        log::warn!("Body fetch deferred: No active account");
                        for tx in job.responders {
                            let _ = tx.send(Err("No active account".to_string()));
                        }
                        let mut state = manager.state.lock().await;
                        state.in_progress.remove(&job.key);
                        continue;
                    }
                };

                // Double check cache in worker
                let mut should_fetch = true;
                if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, &job.key.folder, job.key.uid) {
                    should_fetch = false;
                }

                let mut fetch_res: Result<MessageDetail, String> = Err("Not fetched".to_string());
                if should_fetch {
                    fetch_res = message_body::fetch_and_cache_body_internal(&app_handle, &account, &job.key.folder, job.key.uid).await;
                }
                
                // Reply to oneshot waiters inline
                if fetch_res.is_ok() {
                    if let Ok(Some((cached_body, attachments_json, extracted_data_json))) = database::get_message_body_cache(&app_handle, &job.key.folder, job.key.uid) {
                        let attachments = if let Some(json) = attachments_json {
                            serde_json::from_str(&json).unwrap_or_default()
                        } else {
                            Vec::new()
                        };
                        let extracted_data = extracted_data_json.and_then(|json| serde_json::from_str(&json).ok());
                        
                        let detail = MessageDetail { body: cached_body, attachments, extracted_data };
                        
                        for tx in job.responders {
                            let _ = tx.send(Ok(detail.clone()));
                        }
                    } else {
                        for tx in job.responders {
                            let _ = tx.send(Err("Failed to read cache after fetch".to_string()));
                        }
                    }
                } else {
                    let err_msg = fetch_res.as_ref().err().unwrap().to_string();
                    for tx in job.responders {
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

                {
                    let mut state = manager.state.lock().await;
                    state.in_progress.remove(&job.key);
                }
            }
            log::info!("Prefetch worker gracefully shut down");
        });
    }
    
    pub async fn clear_background_queue(&self) {
        let mut state = self.state.lock().await;
        state.background_queue.clear();
    }
}
