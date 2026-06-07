use crate::auth::account::UserProfile;
use crate::auth::oauth;
use crate::auth::session;
use tauri::{AppHandle, command};

#[command]
pub async fn login_google(app_handle: AppHandle) -> Result<UserProfile, String> {
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
pub fn get_current_user(app_handle: AppHandle) -> Option<UserProfile> {
    session::get_active_account(&app_handle).map(UserProfile::from)
}

#[command]
pub fn list_accounts(app_handle: AppHandle) -> Vec<UserProfile> {
    session::load_accounts(&app_handle)
        .into_iter()
        .map(UserProfile::from)
        .collect()
}

#[command]
pub fn logout_user(app_handle: AppHandle, account_id: String) -> Result<(), String> {
    session::remove_account(&app_handle, account_id)
}

#[command]
pub async fn bootstrap_accounts(app_handle: AppHandle) -> Result<crate::auth::bootstrap::BootstrapResult, String> {
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

    crate::mail::sync_manager::enqueue_sync(app_handle, account, crate::mail::folder::MailFolder::Inbox).await;
    Ok(0) // enqueue is async, returning 0 immediately
}

#[command]
pub async fn sync_mail_folder(app_handle: AppHandle, folder: String) -> Result<u32, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;

    let mail_folder = folder.parse::<crate::mail::folder::MailFolder>().map_err(|e| e.to_string())?;

    crate::mail::sync_manager::enqueue_sync(app_handle, account, mail_folder).await;
    Ok(0)
}

#[command]
pub fn get_folder_messages(app_handle: AppHandle, folder: String, before_uid: Option<u32>, limit: u32) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let folder = folder.to_lowercase();
    crate::mail::database::load_messages_page(&app_handle, &folder, before_uid, limit)
}

#[command]
pub async fn get_message_body(app_handle: AppHandle, folder: String, uid: u32) -> Result<crate::mail::message_body::MessageDetail, String> {
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    
    let folder = folder.to_lowercase();
    
    // Check cache first before enqueueing
    if let Ok(Some((cached_body, attachments_json, extracted_data_json))) = crate::mail::database::get_message_body_cache(&app_handle, &folder, uid) {
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
            return Ok(crate::mail::message_body::MessageDetail { body: cached_body, attachments, extracted_data });
        }
    }

    // Delegate to Manager
    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
        app_handle.clone(),
        account.clone(),
        crate::mail::body_prefetch_manager::PrefetchRequest { folder: folder.clone(), uid },
        crate::mail::body_prefetch_manager::PrefetchPriority::Immediate,
    ).await;

    // Poll cache
    for _ in 0..600 { // 30 second timeout (600 * 50ms)
        if let Ok(Some((cached_body, attachments_json, extracted_data_json))) = crate::mail::database::get_message_body_cache(&app_handle, &folder, uid) {
            let attachments = if let Some(json) = attachments_json {
                serde_json::from_str(&json).unwrap_or_default()
            } else {
                Vec::new()
            };
            let extracted_data = extracted_data_json.and_then(|json| serde_json::from_str(&json).ok());
            return Ok(crate::mail::message_body::MessageDetail { body: cached_body, attachments, extracted_data });
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    Err("Timeout waiting for message body to fetch".to_string())
}

#[command]
pub fn get_cached_messages(app_handle: AppHandle) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    crate::mail::database::load_cached_messages(&app_handle, 25)
}

#[tauri::command]
pub async fn clear_local_cache(app_handle: AppHandle) -> Result<(), String> {
    let db_path = crate::mail::database::get_db_path(&app_handle)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    
    // Wipe all tracked messages and sync states to force a clean bootstrap
    conn.execute("DELETE FROM messages", ()).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folder_sync_state", ()).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM global_sync_state", ()).map_err(|e| e.to_string())?;
    
    Ok(())
}


