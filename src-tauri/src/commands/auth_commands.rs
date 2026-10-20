use crate::auth::account::UserProfile;
use crate::auth::oauth;
use crate::auth::session;
use tauri::{AppHandle, command};

#[command]
pub async fn login_google(app_handle: AppHandle) -> Result<UserProfile, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account = oauth::start_google_login().await?;
    session::save_account(&app_handle, account.clone(), true)?;
    
    // Initial sync
    if let Ok(_guard) = crate::mail::sync::SYNC_LOCK.try_lock() {
        let _ = crate::mail::sync::sync_inbox(&app_handle, account.clone()).await;
    }
    
    // Start IDLE
    crate::mail::idle::start_idle_listener(app_handle.clone(), account.clone());
    
    // Start Polling
    crate::mail::poll::start_polling(app_handle.clone(), account.clone());
    
    Ok(UserProfile::from(account))
}

#[command]
pub fn get_current_user(app_handle: AppHandle) -> Result<Option<UserProfile>, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    Ok(session::get_active_account(&app_handle).map(UserProfile::from))
}

#[command]
pub fn update_display_name(app_handle: AppHandle, display_name: String) -> Result<UserProfile, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let display_name = display_name.trim();
    if display_name.is_empty() {
        return Err("Display name cannot be empty".to_string());
    }
    if display_name.chars().count() > 50 {
        return Err("Display name must be 50 characters or fewer".to_string());
    }

    let mut account = session::get_active_account(&app_handle)
        .ok_or_else(|| "No active account found".to_string())?;
    account.profile_name = display_name.to_string();
    session::save_account(&app_handle, account.clone(), true)?;
    Ok(UserProfile::from(account))
}

#[command]
pub fn list_accounts(app_handle: AppHandle) -> Result<Vec<UserProfile>, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    Ok(session::load_accounts(&app_handle)
        .into_iter()
        .map(UserProfile::from)
        .collect())
}

#[command]
pub async fn logout_user(app_handle: AppHandle, account_id: String) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    tauri::async_runtime::spawn_blocking(move||{
    session::remove_account(&app_handle, account_id.clone())?;
    if let Err(e)=crate::mail::notifications::forget_account(&app_handle,&account_id){log::warn!("Could not remove signed-out account's notifications: {}",e);}
    Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[command]
pub async fn bootstrap_accounts(app_handle: AppHandle) -> Result<crate::auth::bootstrap::BootstrapResult, String> {
    crate::wait_for_boot(&app_handle).await?;
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let res = crate::auth::bootstrap::bootstrap_accounts(&app_handle).await;
    if res.user.is_some() {
        if let Some(account) = session::get_active_account(&app_handle) {
            crate::mail::idle::start_idle_listener(app_handle.clone(), account.clone());
            crate::mail::poll::start_polling(app_handle.clone(), account);
        }
    }
    Ok(res)
}

#[command]
pub async fn get_mailboxes(app_handle: AppHandle) -> Result<Vec<crate::mail::imap_client::Mailbox>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    
    crate::mail::imap_client::get_mailboxes(account).await
}

#[command]
pub async fn get_inbox_messages(app_handle: AppHandle) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    
    crate::mail::message_list::get_inbox_messages(&app_handle, account).await
}

#[command]
pub async fn sync_inbox(app_handle: AppHandle) -> Result<u32, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;

    let app_clone = app_handle.clone();
    let account_clone = account.clone();
    tokio::spawn(async move {
        let _ = crate::mail::tags::sync_tags(&app_clone, &account_clone).await;
    });

    crate::mail::sync_manager::enqueue_sync_with_force(app_handle, account, crate::mail::folder::MailFolder::Inbox, true).await;
    Ok(0)
}

#[command]
pub async fn sync_mail_folder(app_handle: AppHandle, folder: String, automatic: Option<bool>) -> Result<u32, String> {
    let automatic = automatic.unwrap_or(false);
    if automatic && crate::mail_preferences::load(&app_handle).sync_paused { return Ok(0); }
    // Drafts has its own durable Gmail/local store, rather than an IMAP
    // MailFolder. Keep legacy callers on that same authenticated sync path.
    if folder.eq_ignore_ascii_case("drafts") {
        let account_id = crate::auth::session::get_active_profile(&app_handle)
            .ok_or_else(|| "No active account".to_string())?.id;
        return crate::mail::drafts::commands::sync_drafts(app_handle, account_id).await.map(|()| 0);
    }
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;

    let app_clone = app_handle.clone();
    let account_clone = account.clone();
    tokio::spawn(async move {
        let _ = crate::mail::tags::sync_tags(&app_clone, &account_clone).await;
    });

    let mail_folder = folder.parse::<crate::mail::folder::MailFolder>().map_err(|e| e.to_string())?;

    let force_reconcile=!automatic||mail_folder==crate::mail::folder::MailFolder::Trash;
    crate::mail::sync_manager::enqueue_sync_with_force(app_handle, account, mail_folder, force_reconcile).await;
    Ok(0)
}

#[command]
pub async fn get_folder_messages(app_handle: AppHandle, folder: String, before_uid: Option<u32>, before_folder: Option<String>, limit: u32) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
    // A local cache read must not wait for OAuth refresh or connectivity.
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account = crate::auth::session::get_active_profile(&app_handle).ok_or("No active account")?;
    tokio::task::spawn_blocking(move || crate::mail::database::load_messages_page_with_cursor(&app_handle, &account.id, &folder, before_uid, before_folder.as_deref(), limit.min(100)))
        .await.map_err(|e| e.to_string())?
}

#[command]
pub async fn get_message_body(app_handle: AppHandle, folder: String, uid: u32, local_id: Option<String>) -> Result<crate::mail::message_body::MessageDetail, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account=crate::auth::session::get_active_profile(&app_handle).ok_or("No active account")?;
    
    let folder = if folder.to_lowercase().starts_with("tag:") { folder } else { folder.to_lowercase() };
    let (folder,uid,_)=crate::mail::trash::source(&app_handle,&account.id,local_id.as_deref(),&folder,uid)?;
    log::info!("Frontend requested get_message_body for folder='{}', uid={}", folder, uid);
    
    // Keep the cached-open fast path independent of a network job, while
    // moving SQLite I/O and attachment/extraction JSON parsing off Tokio.
    let cache_app = app_handle.clone();
    let cache_account = account.id.clone();
    let cache_folder = folder.clone();
    let cached = tokio::task::spawn_blocking(move || {
        if let Ok(Some((cached_body, attachments_json, extracted_data_json))) = crate::mail::database::get_message_body_cache(&cache_app, &cache_account, &cache_folder, uid) {
            let needs_reextraction = match &extracted_data_json {
                Some(json) => match serde_json::from_str::<crate::mail::extraction::ExtractedData>(json) {
                    Ok(data) => data.version < crate::mail::extraction::CURRENT_EXTRACTOR_VERSION,
                    Err(_) => true,
                },
                None => true, // If we don't have extracted data, we need it!
            };

            if !needs_reextraction {
                let attachments = if let Some(json) = attachments_json {
                    serde_json::from_str(&json).unwrap_or_default()
                } else {
                    Vec::new()
                };
                let extracted_data = extracted_data_json.and_then(|json| serde_json::from_str(&json).ok());
                return Some(crate::mail::message_body::MessageDetail { body: cached_body, attachments, extracted_data });
            }
        }
        None
    }).await.map_err(|error| format!("Message cache task failed: {error}"))?;
    if let Some(detail) = cached { return Ok(detail); }

    let profile_id=account.id;
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=profile_id{return Err("Account changed. Reopen the message.".into());}

    let (tx, rx) = tokio::sync::oneshot::channel();

    // Delegate to Manager
    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
        app_handle.clone(),
        account.clone(),
        folder.clone(),
        uid,
        crate::mail::body_prefetch_manager::PrefetchPriority::Immediate,
        Some(tx)
    ).await;

    // Wait for the oneshot reply
    let result=match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Channel closed unexpectedly".to_string()),
        Err(_) => Err("Timeout waiting for message body to fetch".to_string()),
    };
    if result.is_err() && local_id.is_some() {
        if crate::auth::session::get_active_profile(&app_handle).is_none_or(|active|active.id!=account.id){return Err("Account changed".into());}
        let (current_folder,current_uid,_)=crate::mail::trash::source(&app_handle,&account.id,local_id.as_deref(),&folder,uid)?;
        if current_folder!=folder || current_uid!=uid {
            // The first read may have queued behind a MOVE on the native
            // session. Retry once using its now-confirmed destination.
            return Box::pin(get_message_body(app_handle,current_folder,current_uid,None)).await;
        }
    }
    result
}

#[command]
pub async fn get_cached_messages(app_handle: AppHandle) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    crate::mail::database::load_cached_messages(&app_handle, &account.id, 25)
}

#[tauri::command]
pub async fn clear_local_cache(app_handle: AppHandle) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    // Serialize cache clearing with sync and actions, and keep queued intent intact.
    let _sync = crate::mail::sync_manager::SYNC_LOCK.lock().await;
    let _mutation = crate::mail::message_actions::MUTATION_LOCK.lock().await;
    let conn = crate::mail::database::open_connection(&app_handle)?;
    let pending: i64 = conn.query_row("SELECT (SELECT COUNT(*) FROM pending_message_actions WHERE account_id = ?1) + (SELECT COUNT(*) FROM pending_tag_edits WHERE account_id = ?1) + (SELECT COUNT(*) FROM mail_location_intents WHERE account_id=?1 AND phase<>'settled')", [&account.id], |row| row.get(0)).map_err(|e| e.to_string())?;
    if pending > 0 { return Err("Sync or resolve pending message actions before clearing cached mail.".into()); }
    crate::mail::database::clear_account_cache(&app_handle, &account.id)?;
    crate::mail::trash::changed(&app_handle,&account.id);
    crate::mail::notifications::forget_account(&app_handle,&account.id)
}

#[tauri::command]
pub async fn update_tag(
    app_handle: AppHandle, 
    tag_id: String, 
    name: String, 
    bg_color: Option<String>, 
    text_color: Option<String>
) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    crate::mail::tags::update_tag(&app_handle, &account, &tag_id, &name, bg_color.as_deref(), text_color.as_deref()).await
}

#[tauri::command]
pub async fn create_tag(
    app_handle: AppHandle, 
    name: String, 
    bg_color: Option<String>, 
    text_color: Option<String>
) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    crate::mail::tags::create_tag(&app_handle, &account, &name, bg_color.as_deref(), text_color.as_deref()).await
}

#[tauri::command]
pub async fn delete_tag(
    app_handle: AppHandle,
    tag_id: String,
) -> Result<(), String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    crate::mail::tags::delete_tag(&app_handle, &account, &tag_id).await
}
