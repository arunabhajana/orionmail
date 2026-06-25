use crate::auth::account::{Account, MailProvider};
use crate::mail::database;
use crate::mail::message_list::MessageHeader;
use crate::mail::imap_session::{execute_with_session, SessionKind};
use crate::mail::message_body::MessageDetail;
use crate::mail::body_prefetch_manager::{PREFETCH_MANAGER, PrefetchPriority};
use tauri::{AppHandle, Emitter};
use once_cell::sync::Lazy;
use dashmap::DashMap;
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};
use std::time::{Instant, Duration};
use tokio_util::sync::CancellationToken;
use serde::{Serialize, Deserialize};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SearchState {
    Idle,
    SearchingLocal,
    SearchingRemote,
    Reconciling,
    Downloading,
    Indexing,
    Streaming,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemoteSearchState {
    NotStarted,
    Running,
    Completed,
    Unsupported,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub search_id: String,
    pub account_id: String,
    pub folder: String,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchProgress {
    pub search_id: String,
    pub state: SearchState,
    pub matched: usize,
    pub downloaded: usize,
    pub indexed: usize,
    pub streamed: usize,
    pub total: usize,
    pub progress_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchIncrementalPayload {
    pub search_id: String,
    pub query: String,
    pub folder: String,
    pub new_messages: Vec<MessageHeader>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchMetrics {
    pub local_ms: u128,
    pub remote_ms: u128,
    pub download_ms: u128,
    pub indexed: usize,
    pub cache_hit: bool,
    pub cache_miss: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub supports_gmail_raw: bool,
    pub supports_server_or: bool,
    pub supports_server_phrase: bool,
    pub supports_label_search: bool,
    pub supports_thread_search: bool,
}

pub trait LocalSearchEngine: Send + Sync {
    fn search(&self, app_handle: &AppHandle, folder: &str, query: &str, limit: u32) -> Result<Vec<MessageHeader>, String>;
}

pub struct FTS5SearchEngine;
impl LocalSearchEngine for FTS5SearchEngine {
    fn search(&self, app_handle: &AppHandle, folder: &str, query: &str, limit: u32) -> Result<Vec<MessageHeader>, String> {
        database::search_messages_local(app_handle, folder, query, limit)
    }
}

pub trait SearchBackend: Send + Sync {
    fn search(&self, account: &Account, folder: &str, query: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>>;
    fn load_more(&self, account: &Account, folder: &str, query: &str, cursor_uid: u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>>;
    fn supports_feature(&self) -> ProviderCapabilities;
}

pub struct GmailSearchBackend;
impl SearchBackend for GmailSearchBackend {
    fn search(&self, account: &Account, folder: &str, query: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("X-GM-RAW \"{}\"", query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a)); // Newest first
                Ok(uid_vec)
            }).await
        })
    }

    fn load_more(&self, account: &Account, folder: &str, query: &str, cursor_uid: u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("UID 1:{} X-GM-RAW \"{}\"", cursor_uid.saturating_sub(1), query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a));
                Ok(uid_vec)
            }).await
        })
    }

    fn supports_feature(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_gmail_raw: true,
            supports_server_or: true,
            supports_server_phrase: true,
            supports_label_search: true,
            supports_thread_search: true,
        }
    }
}

pub struct OutlookSearchBackend;
impl SearchBackend for OutlookSearchBackend {
    fn search(&self, account: &Account, folder: &str, query: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("TEXT \"{}\"", query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a));
                Ok(uid_vec)
            }).await
        })
    }

    fn load_more(&self, account: &Account, folder: &str, query: &str, cursor_uid: u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("UID 1:{} TEXT \"{}\"", cursor_uid.saturating_sub(1), query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a));
                Ok(uid_vec)
            }).await
        })
    }

    fn supports_feature(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_gmail_raw: false,
            supports_server_or: true,
            supports_server_phrase: true,
            supports_label_search: false,
            supports_thread_search: false,
        }
    }
}

pub struct GenericImapSearchBackend;
impl SearchBackend for GenericImapSearchBackend {
    fn search(&self, account: &Account, folder: &str, query: &str) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("TEXT \"{}\"", query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a));
                Ok(uid_vec)
            }).await
        })
    }

    fn load_more(&self, account: &Account, folder: &str, query: &str, cursor_uid: u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u32>, String>> + Send>> {
        let account_clone = account.clone();
        let folder_clone = folder.to_string();
        let query_clone = query.to_string();
        Box::pin(async move {
            let provider_clone = account_clone.provider.clone();
            execute_with_session(&account_clone, SessionKind::Search, move |session| {
                let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
                    Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                        Some(mb) => mb.to_string(),
                        None => return Err("Cannot fetch from virtual folder".to_string()),
                    },
                    Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
                };
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
                let search_query = format!("UID 1:{} TEXT \"{}\"", cursor_uid.saturating_sub(1), query_clone.replace('"', "\\\""));
                let uids = session.uid_search(&search_query).map_err(|e| format!("IMAP Search Error: {}", e))?;
                let mut uid_vec: Vec<u32> = uids.into_iter().collect();
                uid_vec.sort_unstable_by(|a, b| b.cmp(a));
                Ok(uid_vec)
            }).await
        })
    }

    fn supports_feature(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            supports_gmail_raw: false,
            supports_server_or: false,
            supports_server_phrase: true,
            supports_label_search: false,
            supports_thread_search: false,
        }
    }
}

pub fn get_search_backend(provider: &MailProvider) -> Box<dyn SearchBackend> {
    match provider {
        MailProvider::Google => Box::new(GmailSearchBackend),
        MailProvider::Outlook => Box::new(OutlookSearchBackend),
        MailProvider::Custom { .. } => Box::new(GenericImapSearchBackend),
    }
}

pub struct SearchCacheEntry {
    pub account_id: String,
    pub folder: String,
    pub query: String,
    pub provider: String,
    pub uidvalidity: u32,
    pub timestamp: Instant,
    pub uids: Vec<u32>,
}

pub static SEARCH_CACHE: Lazy<DashMap<String, SearchCacheEntry>> = Lazy::new(|| DashMap::new());

pub struct SearchContextState {
    pub pending: VecDeque<u32>,
    pub streamed: HashSet<u32>,
    pub cursor: Option<u32>,
    pub last_activity: Instant,
    pub metrics: SearchMetrics,
    pub remote_state: RemoteSearchState,
}

pub struct SearchContext {
    pub search_id: String,
    pub account: Account,
    pub folder: String,
    pub query: String,
    pub cancellation_token: CancellationToken,
    pub state: Mutex<SearchContextState>,
}

pub static ACTIVE_SEARCHES: Lazy<DashMap<String, Arc<SearchContext>>> = Lazy::new(|| DashMap::new());

pub async fn fetch_and_index_search_message(app_handle: &AppHandle, account: &Account, folder: &str, uid: u32) -> Result<MessageDetail, String> {
    let folder_clone = folder.to_string();
    let provider_clone = account.provider.clone();
    
    let fetch_res = execute_with_session(account, SessionKind::Search, move |session| {
        let imap_mailbox = match crate::mail::folder::MailFolder::from_str(&folder_clone) {
            Ok(mf) => match mf.to_imap_mailbox(&provider_clone) {
                Some(mb) => mb.to_string(),
                None => return Err("Cannot fetch from virtual folder".to_string()),
            },
            Err(_) => return Err(format!("Unknown folder: {}", folder_clone)),
        };
        session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?;
        
        let fetch_query = "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO CC REPLY-TO)])";
        let results = session.uid_fetch(uid.to_string(), fetch_query).map_err(|e| format!("IMAP fetch header error: {}", e))?;
        
        if let Some(msg) = results.iter().next() {
            let subject = if let Some(h) = msg.header() {
                if let Ok(parsed) = mailparse::parse_mail(h) {
                    parsed.headers.iter().find(|hdr| hdr.get_key().to_lowercase() == "subject").map(|hdr| hdr.get_value()).unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            let sender = if let Some(h) = msg.header() {
                if let Ok(parsed) = mailparse::parse_mail(h) {
                    parsed.headers.iter().find(|hdr| hdr.get_key().to_lowercase() == "from").map(|hdr| hdr.get_value()).unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            let date = if let Some(h) = msg.header() {
                if let Ok(parsed) = mailparse::parse_mail(h) {
                    parsed.headers.iter().find(|hdr| hdr.get_key().to_lowercase() == "date").map(|hdr| hdr.get_value())
                        .and_then(|d| chrono::DateTime::parse_from_rfc2822(&d).ok()).map(|dt| dt.timestamp()).unwrap_or_else(|| chrono::Utc::now().timestamp())
                } else {
                    chrono::Utc::now().timestamp()
                }
            } else {
                chrono::Utc::now().timestamp()
            };

            let mut seen = false;
            let mut flagged = false;
            for flag in msg.flags() {
                match flag {
                    imap::types::Flag::Seen => seen = true,
                    imap::types::Flag::Flagged => flagged = true,
                    _ => {}
                }
            }

            let header = MessageHeader {
                uid,
                uid_validity: 1,
                subject: if subject.is_empty() { "(No Subject)".to_string() } else { subject },
                from: if sender.is_empty() { "Unknown".to_string() } else { sender },
                date,
                seen,
                flagged,
                snippet: Some("Search match found in mailbox history.".to_string()),
                folder: folder_clone.clone(),
                has_attachments: false,
                thread_id: None,
                to: None,
                message_id: None,
            };
            
            return Ok(header);
        }
        Err("Could not retrieve message header.".to_string())
    }).await?;

    let _ = database::insert_or_update_messages(app_handle, &[fetch_res]);

    Ok(MessageDetail {
        body: "Search match found in mailbox history.".to_string(),
        attachments: Vec::new(),
        extracted_data: None,
    })
}

pub async fn start_search(app_handle: AppHandle, account: Account, folder: String, query: String) -> Result<(String, Vec<MessageHeader>, RemoteSearchState), String> {
    let start_time = Instant::now();
    let search_id = uuid::Uuid::new_v4().to_string();

    // 1. Cancel previous searches for this account+folder
    let mut to_remove = Vec::new();
    for entry in ACTIVE_SEARCHES.iter() {
        if entry.value().account.email == account.email && entry.value().folder == folder {
            entry.value().cancellation_token.cancel();
            to_remove.push(entry.key().clone());
        }
    }
    for key in to_remove {
        ACTIVE_SEARCHES.remove(&key);
    }

    // 2. Perform Local FTS5 Search instantly
    let local_engine = FTS5SearchEngine;
    let local_results = local_engine.search(&app_handle, &folder, &query, 100)?;
    let local_ms = start_time.elapsed().as_millis();

    // 3. Create SearchContext
    let token = CancellationToken::new();
    let context = Arc::new(SearchContext {
        search_id: search_id.clone(),
        account: account.clone(),
        folder: folder.clone(),
        query: query.clone(),
        cancellation_token: token.clone(),
        state: Mutex::new(SearchContextState {
            pending: VecDeque::new(),
            streamed: HashSet::new(),
            cursor: None,
            last_activity: Instant::now(),
            metrics: SearchMetrics {
                local_ms,
                remote_ms: 0,
                download_ms: 0,
                indexed: 0,
                cache_hit: false,
                cache_miss: true,
                cancelled: false,
            },
            remote_state: RemoteSearchState::Running,
        }),
    });

    ACTIVE_SEARCHES.insert(search_id.clone(), context.clone());

    // 4. Spawn Background Remote Search Service
    let app_handle_bg = app_handle.clone();
    let search_id_bg = search_id.clone();
    let query_bg = query.clone();
    let folder_bg = folder.clone();

    tokio::spawn(async move {
        let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
            search_id: search_id_bg.clone(),
            state: SearchState::SearchingRemote,
            matched: 0,
            downloaded: 0,
            indexed: 0,
            streamed: 0,
            total: 0,
            progress_text: "Searching server...".to_string(),
        });

        let remote_start = Instant::now();
        let cache_key = format!("{}_{}_{}", account.email, folder_bg, query_bg.to_lowercase());
        let uidvalidity = database::get_mailbox_validity(&app_handle_bg, &folder_bg).unwrap_or(Some(1)).unwrap_or(1);

        let mut cached_uids = None;
        if let Some(entry) = SEARCH_CACHE.get(&cache_key) {
            if entry.uidvalidity == uidvalidity && entry.timestamp.elapsed() < Duration::from_secs(300) {
                cached_uids = Some(entry.uids.clone());
            }
        }

        let uids = if let Some(u) = cached_uids {
            {
                let mut state = context.state.lock().await;
                state.metrics.cache_hit = true;
                state.metrics.cache_miss = false;
            }
            u
        } else {
            let backend = get_search_backend(&account.provider);
            let search_future = backend.search(&account, &folder_bg, &query_bg);
            
            let search_res = tokio::select! {
                res = tokio::time::timeout(Duration::from_secs(10), search_future) => match res {
                    Ok(r) => r,
                    Err(_) => Err("IMAP search timeout".to_string()),
                },
                _ = token.cancelled() => {
                    let mut state = context.state.lock().await;
                    state.metrics.cancelled = true;
                    state.remote_state = RemoteSearchState::Completed;
                    let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
                        search_id: search_id_bg.clone(),
                        state: SearchState::Cancelled,
                        matched: 0, downloaded: 0, indexed: 0, streamed: 0, total: 0,
                        progress_text: "Cancelled.".to_string(),
                    });
                    return;
                }
            };

            match search_res {
                Ok(mut u) => {
                    u.truncate(500); // Cap at 500 newest UIDs
                    SEARCH_CACHE.insert(cache_key, SearchCacheEntry {
                        account_id: account.email.clone(),
                        folder: folder_bg.clone(),
                        query: query_bg.clone(),
                        provider: format!("{:?}", account.provider),
                        uidvalidity,
                        timestamp: Instant::now(),
                        uids: u.clone(),
                    });
                    u
                },
                Err(e) => {
                    let mut state = context.state.lock().await;
                    state.remote_state = RemoteSearchState::Offline;
                    let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
                        search_id: search_id_bg.clone(),
                        state: SearchState::Completed,
                        matched: 0, downloaded: 0, indexed: 0, streamed: 0, total: 0,
                        progress_text: if e.contains("Offline") { "Offline (Local results only)".to_string() } else { "Complete (Local results only)".to_string() },
                    });
                    return;
                }
            }
        };

        let remote_ms = remote_start.elapsed().as_millis();
        let total_matches = uids.len();

        let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
            search_id: search_id_bg.clone(),
            state: SearchState::Reconciling,
            matched: total_matches,
            downloaded: 0,
            indexed: 0,
            streamed: 0,
            total: total_matches,
            progress_text: format!("{} matches found...", total_matches),
        });

        // Reconcile UIDs
        let existing = database::get_existing_uids(&app_handle_bg, &folder_bg, &uids).unwrap_or_default();
        if !existing.is_empty() {
            let existing_vec: Vec<u32> = existing.iter().copied().collect();
            if let Ok(existing_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder_bg, &existing_vec) {
                let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                    search_id: search_id_bg.clone(),
                    query: query_bg.clone(),
                    folder: folder_bg.clone(),
                    new_messages: existing_msgs,
                });
            }
        }
        let missing_uids: Vec<u32> = uids.iter().filter(|&&uid| !existing.contains(&uid)).copied().collect();

        {
            let mut state = context.state.lock().await;
            state.metrics.remote_ms = remote_ms;
            state.pending = VecDeque::from(missing_uids.clone());
            state.cursor = uids.last().copied();
        }

        // Enqueue newest 100 missing UIDs into BodyPrefetchManager at Priority::Search
        let to_download: Vec<u32> = missing_uids.iter().take(100).copied().collect();
        let download_start = Instant::now();
        let mut downloaded_count = 0;
        let mut batch_buffer = Vec::new();
        let mut last_emit = Instant::now();

        for &uid in &to_download {
            if token.is_cancelled() {
                let mut state = context.state.lock().await;
                state.metrics.cancelled = true;
                state.remote_state = RemoteSearchState::Completed;
                let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
                    search_id: search_id_bg.clone(),
                    state: SearchState::Cancelled,
                    matched: total_matches, downloaded: downloaded_count, indexed: downloaded_count, streamed: downloaded_count, total: total_matches,
                    progress_text: "Cancelled.".to_string(),
                });
                return;
            }

            let (tx, rx) = oneshot::channel();
            PREFETCH_MANAGER.enqueue(
                app_handle_bg.clone(),
                account.clone(),
                folder_bg.clone(),
                uid,
                PrefetchPriority::Search,
                Some(tx)
            ).await;

            if let Ok(Ok(_)) = rx.await {
                downloaded_count += 1;
                batch_buffer.push(uid);

                {
                    let mut state = context.state.lock().await;
                    state.pending.retain(|&p| p != uid);
                    state.streamed.insert(uid);
                    state.metrics.indexed += 1;
                }

                let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
                    search_id: search_id_bg.clone(),
                    state: SearchState::Downloading,
                    matched: total_matches,
                    downloaded: downloaded_count,
                    indexed: downloaded_count,
                    streamed: downloaded_count,
                    total: total_matches,
                    progress_text: format!("Downloading {}/{}...", downloaded_count, total_matches),
                });

                // Coalesce updates every 150ms in batches of 25
                if batch_buffer.len() >= 25 || last_emit.elapsed() >= Duration::from_millis(150) {
                    if let Ok(new_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder_bg, &batch_buffer) {
                        let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                            search_id: search_id_bg.clone(),
                            query: query_bg.clone(),
                            folder: folder_bg.clone(),
                            new_messages: new_msgs,
                        });
                    }
                    batch_buffer.clear();
                    last_emit = Instant::now();
                }
            }
        }

        if !batch_buffer.is_empty() {
            if let Ok(new_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder_bg, &batch_buffer) {
                let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                    search_id: search_id_bg.clone(),
                    query: query_bg.clone(),
                    folder: folder_bg.clone(),
                    new_messages: new_msgs,
                });
            }
        }

        {
            let mut state = context.state.lock().await;
            state.metrics.download_ms = download_start.elapsed().as_millis();
            state.remote_state = RemoteSearchState::Completed;
            state.last_activity = Instant::now();
        }

        let _ = app_handle_bg.emit("mail:search_progress", SearchProgress {
            search_id: search_id_bg.clone(),
            state: SearchState::Completed,
            matched: total_matches,
            downloaded: downloaded_count,
            indexed: downloaded_count,
            streamed: downloaded_count,
            total: total_matches,
            progress_text: "Complete.".to_string(),
        });
    });

    Ok((search_id, local_results, RemoteSearchState::Running))
}

pub async fn load_more_results(app_handle: AppHandle, search_id: String) -> Result<RemoteSearchState, String> {
    let context = match ACTIVE_SEARCHES.get(&search_id) {
        Some(c) => c.clone(),
        None => return Err("Search session expired or not found".to_string()),
    };

    let (account, folder, query, token) = (context.account.clone(), context.folder.clone(), context.query.clone(), context.cancellation_token.clone());
    
    let mut pending_uids = Vec::new();
    let mut cursor = None;
    {
        let mut state = context.state.lock().await;
        state.last_activity = Instant::now();
        if state.pending.is_empty() {
            cursor = state.cursor;
        } else {
            pending_uids = state.pending.iter().take(100).copied().collect();
        }
    }

    if pending_uids.is_empty() && cursor.is_none() {
        return Ok(RemoteSearchState::Completed);
    }

    let app_handle_bg = app_handle.clone();
    let search_id_bg = search_id.clone();

    tokio::spawn(async move {
        if pending_uids.is_empty() {
            if let Some(cur) = cursor {
                let backend = get_search_backend(&account.provider);
                if let Ok(Ok(mut uids)) = tokio::time::timeout(Duration::from_secs(10), backend.load_more(&account, &folder, &query, cur)).await {
                    uids.truncate(500);
                    let existing = database::get_existing_uids(&app_handle_bg, &folder, &uids).unwrap_or_default();
                    if !existing.is_empty() {
                        let existing_vec: Vec<u32> = existing.iter().copied().collect();
                        if let Ok(existing_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder, &existing_vec) {
                            let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                                search_id: search_id_bg.clone(),
                                query: query.clone(),
                                folder: folder.clone(),
                                new_messages: existing_msgs,
                            });
                        }
                    }
                    pending_uids = uids.iter().filter(|&&uid| !existing.contains(&uid)).take(100).copied().collect();
                    {
                        let mut state = context.state.lock().await;
                        state.cursor = uids.last().copied();
                        for &p in &pending_uids {
                            state.pending.push_back(p);
                        }
                    }
                }
            }
        }

        let mut batch_buffer = Vec::new();
        let mut last_emit = Instant::now();

        for &uid in &pending_uids {
            if token.is_cancelled() { return; }
            let (tx, rx) = oneshot::channel();
            PREFETCH_MANAGER.enqueue(
                app_handle_bg.clone(),
                account.clone(),
                folder.clone(),
                uid,
                PrefetchPriority::Search,
                Some(tx)
            ).await;

            if let Ok(Ok(_)) = rx.await {
                batch_buffer.push(uid);
                {
                    let mut state = context.state.lock().await;
                    state.pending.retain(|&p| p != uid);
                    state.streamed.insert(uid);
                    state.metrics.indexed += 1;
                }

                if batch_buffer.len() >= 25 || last_emit.elapsed() >= Duration::from_millis(150) {
                    if let Ok(new_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder, &batch_buffer) {
                        let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                            search_id: search_id_bg.clone(),
                            query: query.clone(),
                            folder: folder.clone(),
                            new_messages: new_msgs,
                        });
                    }
                    batch_buffer.clear();
                    last_emit = Instant::now();
                }
            }
        }

        if !batch_buffer.is_empty() {
            if let Ok(new_msgs) = database::get_messages_by_uids(&app_handle_bg, &folder, &batch_buffer) {
                let _ = app_handle_bg.emit("mail:search_incremental", SearchIncrementalPayload {
                    search_id: search_id_bg.clone(),
                    query: query.clone(),
                    folder: folder.clone(),
                    new_messages: new_msgs,
                });
            }
        }

        {
            let mut state = context.state.lock().await;
            state.remote_state = RemoteSearchState::Completed;
            state.last_activity = Instant::now();
        }
    });

    Ok(RemoteSearchState::Running)
}

pub async fn clear_search(_app_handle: AppHandle, search_id: String) -> Result<(), String> {
    if let Some(entry) = ACTIVE_SEARCHES.remove(&search_id) {
        entry.1.cancellation_token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_cache_entry() {
        let entry = SearchCacheEntry {
            account_id: "test@example.com".to_string(),
            folder: "inbox".to_string(),
            query: "invoice".to_string(),
            provider: "Google".to_string(),
            uidvalidity: 12345,
            timestamp: Instant::now(),
            uids: vec![100, 99, 98],
        };
        assert_eq!(entry.uids.len(), 3);
        assert_eq!(entry.uidvalidity, 12345);
    }

    #[test]
    fn test_provider_capabilities() {
        let gmail_backend = get_search_backend(&MailProvider::Google);
        let cap = gmail_backend.supports_feature();
        assert!(cap.supports_gmail_raw);
        assert!(cap.supports_server_or);

        let outlook_backend = get_search_backend(&MailProvider::Outlook);
        let cap_out = outlook_backend.supports_feature();
        assert!(!cap_out.supports_gmail_raw);
        assert!(cap_out.supports_server_or);
    }

    #[test]
    fn test_search_metrics_default() {
        let metrics = SearchMetrics::default();
        assert_eq!(metrics.local_ms, 0);
        assert_eq!(metrics.remote_ms, 0);
        assert!(!metrics.cache_hit);
    }
}
