use crate::mail::database;
use tauri::AppHandle;
use crate::BootError;

#[tauri::command]
pub async fn mark_as_read(app_handle: AppHandle, account_id:String,expected_uid_validity:u32,uid: u32, folder: Option<String>) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let folder_str = folder.map(|f| if f.to_lowercase().starts_with("tag:") { f } else { f.to_lowercase() }).unwrap_or_else(|| "inbox".to_string());
    crate::mail::message_actions::perform(&app_handle, &account, &folder_str, uid, "seen", Some(true),expected_uid_validity).await?;
    crate::tray_state::refresh_unread_count_from_db(&app_handle);
    Ok(())
}

#[tauri::command]
pub async fn toggle_read(app_handle: AppHandle,account_id:String,expected_uid_validity:u32, uid: u32, should_read: bool, folder: Option<String>) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let folder_str = folder.map(|f| if f.to_lowercase().starts_with("tag:") { f } else { f.to_lowercase() }).unwrap_or_else(|| "inbox".to_string());
    crate::mail::message_actions::perform(&app_handle, &account, &folder_str, uid, "seen", Some(should_read),expected_uid_validity).await?;
    crate::tray_state::refresh_unread_count_from_db(&app_handle);
    Ok(())
}

#[tauri::command]
pub async fn toggle_star(app_handle: AppHandle,account_id:String,expected_uid_validity:u32, uid: u32, should_star: bool, folder: Option<String>) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let folder_str = folder.map(|f| if f.to_lowercase().starts_with("tag:") { f } else { f.to_lowercase() }).unwrap_or_else(|| "inbox".to_string());
    crate::mail::message_actions::perform(&app_handle, &account, &folder_str, uid, "flagged", Some(should_star),expected_uid_validity).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_message(app_handle: AppHandle,account_id:String,expected_uid_validity:u32, uid: u32, folder: Option<String>) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let folder_str = folder.map(|f| if f.to_lowercase().starts_with("tag:") { f } else { f.to_lowercase() }).unwrap_or_else(|| "inbox".to_string());
    crate::mail::message_actions::perform(&app_handle, &account, &folder_str, uid, "delete", None,expected_uid_validity).await?;
    crate::tray_state::refresh_unread_count_from_db(&app_handle);
    Ok(())
}

#[tauri::command]
pub async fn get_messages_page(
    app_handle: AppHandle,
    folder: String,
    before_uid: Option<u32>,
    before_folder: Option<String>,
    limit: u32,
) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let safe_limit = limit.min(100);
    let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
    
    let app_handle_clone = app_handle.clone();
    let folder_clone = folder.clone();
    let account_id = account.id;
    let pages = tokio::task::spawn_blocking(move || {
        database::load_messages_page_with_cursor(&app_handle_clone, &account_id, &folder_clone, before_uid, before_folder.as_deref(), safe_limit)
    })
    .await
    .map_err(|e| e.to_string())??;

    if folder == "inbox" {
        if let Ok(account) = crate::auth::bootstrap::ensure_active_account(&app_handle).await {
            let uids_to_prefetch = pages.iter().take(8).map(|m| m.uid).collect::<Vec<_>>();
            let app_handle_pf = app_handle.clone();
            
            // Fire-and-forget background prefetch enqueue
            tokio::spawn(async move {
                for uid in uids_to_prefetch {
                    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
                        app_handle_pf.clone(),
                        account.clone(),
                        "inbox".to_string(),
                        uid,
                        crate::mail::body_prefetch_manager::PrefetchPriority::Background,
                        None,
                    ).await;
                }
            });
        }
    }

    Ok(pages)
}

#[tauri::command]
pub async fn prefetch_messages(
    app_handle: tauri::AppHandle,
    requests: Vec<crate::mail::body_prefetch_manager::BodyKey>,
) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    
    // Clear old background queue before queueing the new viewport items
    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.clear_background_queue().await;

    for request in requests {
        crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
            app_handle.clone(),
            account.clone(),
            request.folder,
            request.uid,
            crate::mail::body_prefetch_manager::PrefetchPriority::Background,
            None,
        ).await;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn download_attachment(
    app_handle: tauri::AppHandle,
    folder: String,
    uid: u32,
    part_id: String,
    save_path: String,
) -> Result<String, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
    
    let bytes = crate::mail::message_body::fetch_attachment_part(&account, &folder, uid, &part_id).await?;
    
    std::fs::write(&save_path, bytes).map_err(|e| e.to_string())?;
    Ok(save_path)
}

#[tauri::command]
pub async fn pick_attachments(app_handle: AppHandle) -> Result<Vec<crate::mail::attachments::AttachmentMetadata>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    tokio::task::spawn_blocking(move || crate::mail::attachments::pick_for_account(&app_handle, &account.id))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn release_attachment_handles(app_handle: AppHandle, handles: Vec<String>) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    crate::mail::attachments::release_handles(&account.id, &handles);
    Ok(())
}

#[tauri::command]
pub async fn send_message(
    app_handle: AppHandle,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    reply_to: Option<String>,
    subject: String,
    plain_body: String,
    html_body: String,
    attachments: Vec<String>,
) -> Result<String, String> {
    let mut account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let attachment_data = crate::mail::attachments::load_for_send(&account.id, &attachments)?;
    
    let res = crate::mail::smtp_client::send_email(
        &app_handle,
        &mut account,
        to,
        cc,
        bcc,
        reply_to,
        &subject,
        &plain_body,
        &html_body,
        attachment_data,
    )
    .await
    .map_err(|e| e.to_string());
    
    if res.is_ok() {
        crate::mail::attachments::release_handles(&account.id, &attachments);
    }
    res
}

#[tauri::command]
pub async fn show_in_folder(app_handle: AppHandle, path: String) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            open::that(parent).map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = tauri::Manager::get_webview_window(&app_handle, "main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_unread_counts(app_handle: tauri::AppHandle) -> Result<std::collections::HashMap<String, u32>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    tokio::task::spawn_blocking(move || {
        let db_path = crate::mail::database::get_db_path(&app_handle)?;
        let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

        let mut counts = std::collections::HashMap::new();

        let sql=format!("SELECT folder, COUNT(DISTINCT {}) FROM messages WHERE account_id=?1 AND seen=0 GROUP BY folder",database::CACHED_MESSAGE_IDENTITY_SQL);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([account.id.as_str()], |row| {
            let folder: String = row.get(0)?;
            let count: u32 = row.get(1)?;
            Ok((folder, count))
        }).unwrap();

        for row in rows {
            if let Ok((folder, count)) = row {
                counts.insert(folder.to_lowercase(), count);
            }
        }

        let sql=format!("SELECT COUNT(DISTINCT {}) FROM messages WHERE account_id=?1 AND seen=0 AND flagged=1",database::CACHED_MESSAGE_IDENTITY_SQL);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Ok(count) = stmt.query_row([account.id.as_str()], |row| row.get(0)) {
            counts.insert("starred".to_string(), count);
        }

        Ok(counts)
    }).await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct DiagnosticsSyncStatus {
    pub unread_count: u32,
    pub sync_in_progress: bool,
    pub last_sync_at: Option<i64>,
    pub last_successful_idle_at: Option<i64>,
    pub last_notification_at: Option<i64>,
    pub last_sync_error: Option<String>,
}

#[tauri::command]
pub async fn get_sync_diagnostics(app_handle: tauri::AppHandle) -> Result<DiagnosticsSyncStatus, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    tokio::task::spawn_blocking(move || {
        let global_state = crate::mail::database::get_global_sync_state(&app_handle, &account.id).unwrap_or_default();
        let unread = crate::mail::database::get_global_unread_count(&app_handle, &account.id).unwrap_or(0);
        let sync_in_progress = crate::mail::database::open_connection(&app_handle)?.query_row(
            "SELECT EXISTS(SELECT 1 FROM folder_sync_state WHERE account_id = ?1 AND sync_in_progress = 1)",
            [&account.id], |row| row.get(0)).map_err(|e| e.to_string())?;

        Ok(DiagnosticsSyncStatus {
            unread_count: unread,
            sync_in_progress,
            last_sync_at: global_state.last_sync_at,
            last_successful_idle_at: global_state.last_successful_idle_at,
            last_notification_at: global_state.last_notification_at,
            last_sync_error: global_state.last_sync_error,
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let validated_url = validate_external_url(&url)?;
    open::that(validated_url.as_str()).map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

fn validate_external_url(raw: &str) -> Result<url::Url, String> {
    const MAX_URL_LENGTH: usize = 8192;

    if raw.is_empty()
        || raw.len() > MAX_URL_LENGTH
        || raw.trim() != raw
        || raw.chars().any(char::is_control)
    {
        return Err("URL is empty, too long, or contains invalid whitespace".to_string());
    }

    let parsed = url::Url::parse(raw).map_err(|_| "URL must be absolute and valid".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {
            if parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
                return Err("HTTP links must have a host and cannot contain credentials".to_string());
            }
        }
        "mailto" => {
            if parsed.path().is_empty() || parsed.host_str().is_some() || parsed.fragment().is_some() {
                return Err("Mail links must contain a recipient and cannot contain a fragment".to_string());
            }

            // Prevent encoded control characters from being reinterpreted by an OS mail handler.
            let mut encoded = raw.to_ascii_lowercase();
            for _ in 0..4 {
                if encoded.as_bytes().windows(3).any(|triplet| {
                    triplet[0] == b'%'
                        && u8::from_str_radix(std::str::from_utf8(&triplet[1..]).unwrap_or(""), 16)
                            .map(|value| value < 0x20 || value == 0x7f)
                            .unwrap_or(false)
                }) {
                    return Err("Mail links cannot contain encoded control characters".to_string());
                }
                let decoded_percent = encoded.replace("%25", "%");
                if decoded_percent == encoded {
                    break;
                }
                encoded = decoded_percent;
            }

            for (name, value) in parsed.query_pairs() {
                if !matches!(name.to_ascii_lowercase().as_str(), "subject" | "body" | "cc" | "bcc")
                    || name.chars().any(char::is_control)
                    || value.chars().any(char::is_control)
                {
                    return Err("Mail link contains an unsupported or invalid header".to_string());
                }
            }
        }
        _ => return Err("Only HTTP, HTTPS, and mail links can be opened".to_string()),
    }

    Ok(parsed)
}

#[tauri::command]
pub fn get_boot_error(state: tauri::State<'_, BootError>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[derive(serde::Serialize)]
pub struct SearchResponse {
    pub search_id: String,
    pub local_results: Vec<crate::mail::message_list::MessageHeader>,
    pub remote_search_state: crate::mail::search::RemoteSearchState,
}

#[tauri::command]
pub async fn search_messages(app_handle: tauri::AppHandle, folder: String, query: String, search_id: Option<String>) -> Result<SearchResponse, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let (search_id, local_results, remote_search_state) = crate::mail::search::start_search(app_handle, account, folder, query, search_id).await?;
    Ok(SearchResponse {
        search_id,
        local_results,
        remote_search_state,
    })
}

#[tauri::command]
pub async fn load_more_results(app_handle: tauri::AppHandle, search_id: String) -> Result<crate::mail::search::RemoteSearchState, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    crate::mail::search::load_more_results(app_handle, search_id).await
}

#[tauri::command]
pub async fn clear_search(app_handle: tauri::AppHandle, search_id: String) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    crate::mail::search::clear_search(app_handle, search_id).await
}

#[tauri::command]
pub async fn get_all_tags(app_handle: tauri::AppHandle) -> Result<Vec<crate::mail::database::Tag>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let app_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        crate::mail::database::get_all_tags(&app_clone, &account.id)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_message_tags(app_handle: tauri::AppHandle, folder: String, message_uid: u32) -> Result<Vec<String>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    let app_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        crate::mail::database::get_message_tags(&app_clone, &account.id, &folder, message_uid)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_message_tags(app_handle:tauri::AppHandle,account_id:String,expected_uid_validity:u32,folder:String,uid:u32,add_ids:Vec<String>,remove_ids:Vec<String>)->Result<Vec<String>,String>{
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message and retry.".into());}
    crate::mail::tags::assignment::update(&app_handle,&account,folder,uid,add_ids,remove_ids,expected_uid_validity).await
}

#[tauri::command]
pub async fn refresh_message_labels(app_handle:tauri::AppHandle,account_id:String,requests:Vec<crate::mail::tags::refresh::LabelTarget>)->Result<(),String>{
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed".into());}
    crate::mail::tags::refresh::visible(&app_handle,&account,requests).await
}

#[tauri::command]
pub async fn get_cached_message_headers(app_handle:tauri::AppHandle,requests:Vec<crate::mail::tags::refresh::LabelTarget>)->Result<Vec<crate::mail::message_list::MessageHeader>,String>{
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if requests.len()>1000{return Err("Too many cached messages".into());}
    tokio::task::spawn_blocking(move||{
        let mut groups:std::collections::BTreeMap<String,Vec<u32>>=std::collections::BTreeMap::new();
        for request in requests{groups.entry(request.folder).or_default().push(request.uid);}
        let mut messages=Vec::new();
        for(folder,uids)in groups{for batch in uids.chunks(200){messages.extend(database::get_messages_by_uids(&app_handle,&account.id,&folder,batch)?);}}
        Ok(messages)
    }).await.map_err(|e|e.to_string())?
}

/// Logical cached content sizes for the active account; excludes database indexes and free pages.
#[tauri::command]
pub async fn get_cache_summary(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    tokio::task::spawn_blocking(move || {
        let conn = crate::mail::database::open_connection(&app_handle)?;
        let (messages, bodies, headers): (i64, i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(CAST(COALESCE(body, '') AS BLOB)) + length(CAST(COALESCE(processed_html, '') AS BLOB))), 0), COALESCE(SUM(length(CAST(COALESCE(subject, '') || COALESCE(sender, '') || COALESCE(recipient, '') || COALESCE(snippet, '') AS BLOB))), 0) FROM messages WHERE account_id = ?1",
            [&account.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        ).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "messages": messages, "bodyBytes": bodies, "headerBytes": headers }))
    }).await.map_err(|e| e.to_string())?
}
