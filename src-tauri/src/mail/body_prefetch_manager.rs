use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify, oneshot};
use once_cell::sync::Lazy;
use tauri::AppHandle;
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
    #[serde(default)]
    pub uid_validity: u32,
}

pub struct FetchJob {
    pub key: BodyKey,
    pub account: Account,
    pub responders: Vec<oneshot::Sender<Result<MessageDetail, String>>>,
}

#[derive(Default)]
struct BodyPrefetchManagerState {
    immediate_queue: VecDeque<FetchJob>,
    search_queue: VecDeque<FetchJob>,
    background_queue: VecDeque<FetchJob>,
    in_progress: std::collections::HashMap<BodyKey, Vec<oneshot::Sender<Result<MessageDetail, String>>>>,
    worker_started: bool,
}

impl BodyPrefetchManagerState {
    fn take_next(&mut self, foreground: bool) -> Option<(FetchJob, PrefetchPriority)> {
        let next = if foreground {
            self.immediate_queue.pop_front().map(|job| (job, PrefetchPriority::Immediate))
        } else if let Some(job) = self.search_queue.pop_front() {
            Some((job, PrefetchPriority::Search))
        } else {
            self.background_queue.pop_front().map(|job| (job, PrefetchPriority::Background))
        };
        next.map(|(mut job, priority)| {
            self.in_progress.insert(job.key.clone(), std::mem::take(&mut job.responders));
            (job, priority)
        })
    }
}



pub struct BodyPrefetchManager {
    state: Mutex<BodyPrefetchManagerState>,
    pub notify: Notify,
    foreground_notify: Notify,
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
        foreground_notify: Notify::new(),
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
            if !crate::window_activity::is_displayed() { return; }
            let prefs = crate::mail_preferences::load(&app_handle);
            if !prefs.prefetch_bodies || prefs.sync_paused { return; }
        }
        let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
        let cache_app = app_handle.clone();
        let cache_account = account.id.clone();
        let cache_folder = folder.clone();
        let validity = tokio::task::spawn_blocking(move || database::message_uid_validity(&cache_app, &cache_account, &cache_folder, uid))
            .await.map_err(|e| e.to_string()).and_then(|value| value);
        let uid_validity = match validity {
            Ok(value) => value,
            // Remote search discovers UIDs before their headers are cached.
            Err(_) if priority == PrefetchPriority::Search => 0,
            Err(error) => { if let Some(tx) = responder { let _ = tx.send(Err(error)); } return; }
        };
        let key = BodyKey { account_id: account.id.clone(), folder, uid, uid_validity };
        
        // The worker checks SQLite off the async executor. Enqueuing every
        // visible row must not perform synchronous filesystem/database work.

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
                self.foreground_notify.notify_one();
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
                self.foreground_notify.notify_one();
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

        if priority == PrefetchPriority::Immediate { self.foreground_notify.notify_one(); }
        else { self.notify.notify_one(); }

        if !state.worker_started {
            state.worker_started = true;
            drop(state);
            self.spawn_worker(app_handle.clone(), true);
            self.spawn_worker(app_handle, false);
        }
    }

    fn spawn_worker(&self, app_handle: AppHandle, foreground: bool) {
        let manager = PREFETCH_MANAGER.clone();
        
        tokio::spawn(async move {
            loop {
                let allow_background = crate::window_activity::is_displayed() && {
                    let prefs = crate::mail_preferences::load(&app_handle);
                    prefs.prefetch_bodies && !prefs.sync_paused
                };
                let req_opt = {
                    let mut state = manager.state.lock().await;
                    if !allow_background {
                        while let Some(job) = state.background_queue.pop_front() {
                            if !job.responders.is_empty() {
                                state.immediate_queue.push_back(job);
                                manager.foreground_notify.notify_one();
                            }
                        }
                    }
                    state.take_next(foreground)
                };

                let (job, priority) = match req_opt {
                    Some(j) => j,
                    None => {
                        tokio::select! {
                            _ = async {
                                if foreground { manager.foreground_notify.notified().await; }
                                else { manager.notify.notified().await; }
                            } => continue,
                            _ = PREFETCH_TOKEN.cancelled() => break,
                        }
                    }
                };

                // If background fetch, strictly reserve 1 permit for UI fast-paths
                if priority != PrefetchPriority::Immediate && message_body::CONCURRENT_FETCH_LIMIT.available_permits() <= 1 {
                    // Re-enqueue and yield to avoid starving user
                    log::debug!("Body fetch deferred due to active sync");
                    let mut state = manager.state.lock().await;
                    let key = job.key.clone();
                    let responders = state.in_progress.remove(&key).unwrap_or_default();
                    let deferred = FetchJob { key, account: job.account, responders };
                    if deferred.responders.is_empty() {
                        if priority == PrefetchPriority::Search { state.search_queue.push_front(deferred); }
                        else { state.background_queue.push_front(deferred); }
                    } else {
                        state.immediate_queue.push_front(deferred);
                        manager.foreground_notify.notify_one();
                    }
                    drop(state);
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => continue,
                        _ = PREFETCH_TOKEN.cancelled() => break,
                    }
                }

                let account = job.account.clone();

                // Double check cache in worker
                let cache_app = app_handle.clone();
                let cache_key = job.key.clone();
                let should_fetch = priority == PrefetchPriority::Immediate || !tokio::task::spawn_blocking(move || {
                    database::has_message_body_cache(&cache_app, &cache_key.account_id, &cache_key.folder, cache_key.uid).unwrap_or(false)
                }).await.unwrap_or(false);

                let mut fetch_res: Result<MessageDetail, String> = Err("Not fetched".to_string());
                if should_fetch {
                    if priority == PrefetchPriority::Search {
                        fetch_res = crate::mail::search::fetch_and_index_search_message(&app_handle, &account, &job.key.folder, job.key.uid).await;
                    } else {
                        let kind = if foreground { crate::mail::imap_session::SessionKind::Body } else { crate::mail::imap_session::SessionKind::Prefetch };
                        fetch_res = message_body::fetch_and_cache_body_with_session(&app_handle, &account, &job.key.folder, job.key.uid, kind, Some(job.key.uid_validity)).await;
                    }
                }
                
                let responders = {
                    let mut state = manager.state.lock().await;
                    state.in_progress.remove(&job.key).unwrap_or_default()
                };

                // Reply to oneshot waiters inline
                // Try to read from cache regardless of fetch_res (it may already have been cached)
                if should_fetch {
                    // The fetch already returns the decoded detail. Avoid a
                    // second SQLite body read and attachment JSON parse.
                    for tx in responders {
                        let _ = tx.send(fetch_res.clone());
                    }
                } else if responders.is_empty() {
                    // Background jobs have no UI waiter. Do not load and parse
                    // the entire cached body a second time just to discard it.
                } else if fetch_res.is_ok() || !should_fetch {
                    let cache_app = app_handle.clone();
                    let cache_key = job.key.clone();
                    let cached = tokio::task::spawn_blocking(move || {
                        database::get_message_body_cache(&cache_app, &cache_key.account_id, &cache_key.folder, cache_key.uid)
                    }).await;
                    if let Ok(Ok(Some((cached_body, attachments_json, extracted_data_json)))) = cached {
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

                // Selected mail already receives its result through the oneshot
                // responder. No renderer broadcast is needed for each body.
                // Space speculative processing out; a newly queued foreground
                // request wakes the worker without waiting for this interval.
                if priority == PrefetchPriority::Background && should_fetch {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {},
                        _ = manager.notify.notified() => {},
                        _ = PREFETCH_TOKEN.cancelled() => break,
                    }
                }
            }
            log::info!("Prefetch worker gracefully shut down");
        });
    }
    
    pub async fn clear_background_queue(&self, account_id: &str) {
        let mut state = self.state.lock().await;
        let mut retained = VecDeque::new();
        while let Some(job) = state.background_queue.pop_front() {
            if job.key.account_id != account_id { retained.push_back(job); continue; }
            if !job.responders.is_empty() { state.immediate_queue.push_back(job); self.foreground_notify.notify_one(); }
        }
        state.background_queue = retained;
    }

    pub async fn remove_account(&self, account_id: &str) {
        let mut state = self.state.lock().await;
        let BodyPrefetchManagerState { immediate_queue, search_queue, background_queue, .. } = &mut *state;
        for queue in [immediate_queue, search_queue, background_queue] {
            queue.retain_mut(|job| {
                if job.key.account_id != account_id { return true; }
                for tx in job.responders.drain(..) { let _ = tx.send(Err("Account was removed".into())); }
                false
            });
        }
        for (key, responders) in &mut state.in_progress {
            if key.account_id == account_id {
                for tx in responders.drain(..) { let _ = tx.send(Err("Account was removed".into())); }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(account: &str, uid: u32, validity: u32) -> FetchJob {
        FetchJob {
            key: BodyKey { account_id:account.into(),folder:"inbox".into(),uid,uid_validity:validity },
            account: Account { id:account.into(),email:"same@example.com".into(),provider:crate::auth::account::MailProvider::Google,access_token:String::new(),refresh_token:String::new(),needs_reauth:false,expires_at:0,last_sync:None,profile_name:String::new(),profile_picture:String::new() },
            responders:vec![],
        }
    }
    #[test]
    fn foreground_lane_does_not_wait_for_unrelated_speculation() {
        let mut state = BodyPrefetchManagerState::default();
        state.background_queue.push_back(job("a",1,9));
        state.immediate_queue.push_back(job("a",2,9));
        let (background, _) = state.take_next(false).unwrap(); // Simulates slow in-flight body.
        let (selected, priority) = state.take_next(true).unwrap();
        assert_eq!(priority,PrefetchPriority::Immediate);
        assert_eq!(selected.key.uid,2);
        assert_ne!(selected.key,background.key);
        assert_eq!(state.in_progress.len(),2);
    }
    #[test]
    fn matching_uids_in_other_accounts_and_epochs_are_separate_jobs() {
        let mut state = BodyPrefetchManagerState::default();
        for item in [job("a",42,9),job("b",42,9),job("a",42,10)] { state.immediate_queue.push_back(item); }
        for _ in 0..3 { state.take_next(true).unwrap(); }
        assert_eq!(state.in_progress.len(),3);
        assert!(state.take_next(false).is_none());
    }
    #[tokio::test]
    async fn viewport_clearing_and_logout_only_remove_owned_jobs() {
        let mut state = BodyPrefetchManagerState::default();
        state.background_queue.extend([job("a",1,9),job("b",1,9)]);
        state.immediate_queue.push_back(job("a",2,9));
        let (tx,rx) = oneshot::channel();
        state.immediate_queue[0].responders.push(tx);
        let manager = BodyPrefetchManager { state:Mutex::new(state),notify:Notify::new(),foreground_notify:Notify::new() };
        manager.clear_background_queue("a").await;
        assert_eq!(manager.state.lock().await.background_queue[0].key.account_id,"b");
        manager.remove_account("a").await;
        assert!(rx.await.unwrap().is_err());
        assert_eq!(manager.state.lock().await.background_queue.len(),1);
    }
}
