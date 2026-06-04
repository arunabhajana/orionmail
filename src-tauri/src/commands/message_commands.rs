use crate::auth::session::get_active_account;
use crate::mail::database;
use crate::mail::imap_session::{execute_with_session, SessionKind};
use tauri::AppHandle;

#[tauri::command]
pub async fn mark_as_read(app_handle: AppHandle, uid: u32, folder: Option<String>) -> Result<(), String> {
    log::info!("mark_as_read command invoked for UID {}", uid);
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    let folder_str = folder.map(|f| f.to_lowercase()).unwrap_or_else(|| "inbox".to_string());

    // Idempotency Check: Don't hit IMAP if already updated locally
    let is_already_seen = tokio::task::spawn_blocking({
        let app = app_handle.clone();
        let folder_str = folder_str.clone();
        move || {
            let seen = database::is_message_seen(&app, &folder_str, uid);
            log::info!("is_message_seen for UID {}: {:?}", uid, seen);
            seen
        }
    }).await.map_err(|e| e.to_string())??;

    if is_already_seen {
        log::info!("UID {} is already marked as read locally. Skipping IMAP update.", uid);
        return Ok(());
    }

    if folder_str != "inbox" {
        let app_handle_clone = app_handle.clone();
        let _ = tokio::task::spawn_blocking(move || {
            database::set_message_seen(&app_handle_clone, &folder_str, uid, true)
        }).await;
        crate::tray_state::refresh_unread_count_from_db(&app_handle);
        return Ok(());
    }

    log::info!("Updating IMAP seen flag for UID {}", uid);
    // Update IMAP (Silent Flag to avoid untagged responses)
    let imap_res = execute_with_session(&account, SessionKind::Primary, move |session| {
        log::info!("Executing uid_store +FLAGS.SILENT (\\Seen) for UID {} on IMAP", uid);
        session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Seen)")
            .map_err(|e| format!("IMAP Error marking read: {}", e))?;
        log::info!("IMAP uid_store success for UID {}", uid);
        Ok::<(), String>(())
    }).await;

    if let Err(e) = &imap_res {
        log::error!("IMAP uid_store failed for UID {}: {}", uid, e);
        return Err(e.clone());
    }

    log::info!("Updating SQLite seen flag to true for UID {}", uid);
    // Update SQLite
    let app_handle_clone = app_handle.clone();
    let _ = tokio::task::spawn_blocking(move || {
        database::set_message_seen(&app_handle_clone, "inbox", uid, true)
    }).await;
    
    crate::tray_state::refresh_unread_count_from_db(&app_handle);

    log::info!("mark_as_read completed successfully for UID {}", uid);
    Ok(())
}

#[tauri::command]
pub async fn toggle_read(app_handle: AppHandle, uid: u32, should_read: bool, folder: Option<String>) -> Result<(), String> {
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    let folder_str = folder.map(|f| f.to_lowercase()).unwrap_or_else(|| "inbox".to_string());

    let app_handle_clone = app_handle.clone();
    if folder_str != "inbox" {
        let _ = tokio::task::spawn_blocking(move || {
            database::set_message_seen(&app_handle_clone, &folder_str, uid, should_read)
        }).await;
        crate::tray_state::refresh_unread_count_from_db(&app_handle);
        return Ok(());
    }

    // Update IMAP
    let flag_cmd = if should_read {
        "+FLAGS.SILENT (\\Seen)"
    } else {
        "-FLAGS.SILENT (\\Seen)"
    };

    execute_with_session(&account, SessionKind::Primary, move |session| {
        session.uid_store(uid.to_string(), flag_cmd)
            .map_err(|e| format!("IMAP Error toggling read: {}", e))?;
        Ok::<(), String>(())
    }).await?;

    let app_handle_clone2 = app_handle.clone();
    // Update SQLite
    let _ = tokio::task::spawn_blocking(move || {
        database::set_message_seen(&app_handle_clone2, "inbox", uid, should_read)
    }).await;
    
    crate::tray_state::refresh_unread_count_from_db(&app_handle);

    Ok(())
}

#[tauri::command]
pub async fn toggle_star(app_handle: AppHandle, uid: u32, should_star: bool, folder: Option<String>) -> Result<(), String> {
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    let folder_str = folder.map(|f| f.to_lowercase()).unwrap_or_else(|| "inbox".to_string());

    if folder_str != "inbox" {
        let _ = tokio::task::spawn_blocking(move || {
            database::set_message_flagged(&app_handle, &folder_str, uid, should_star)
        }).await;
        return Ok(());
    }

    // Update IMAP
    let flag_cmd = if should_star {
        "+FLAGS.SILENT (\\Flagged)"
    } else {
        "-FLAGS.SILENT (\\Flagged)"
    };

    execute_with_session(&account, SessionKind::Primary, move |session| {
        session.uid_store(uid.to_string(), flag_cmd)
            .map_err(|e| format!("IMAP Error toggling star: {}", e))?;
        Ok::<(), String>(())
    }).await?;

    // Update SQLite
    let _ = tokio::task::spawn_blocking(move || {
        database::set_message_flagged(&app_handle, "inbox", uid, should_star)
    }).await;

    Ok(())
}

#[tauri::command]
pub async fn delete_message(app_handle: AppHandle, uid: u32, folder: Option<String>) -> Result<(), String> {
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    let folder_str = folder.map(|f| f.to_lowercase()).unwrap_or_else(|| "inbox".to_string());

    let app_handle_clone = app_handle.clone();
    if folder_str != "inbox" {
        let _ = tokio::task::spawn_blocking(move || {
            database::delete_message_local(&app_handle_clone, &folder_str, uid)
        }).await;
        crate::tray_state::refresh_unread_count_from_db(&app_handle);
        return Ok(());
    }

    // IMAP Action: Try MOVE, fallback to Label + Deleted Flag
    execute_with_session(&account, SessionKind::Primary, move |session| {
        // Attempt standard IMAP MOVE to Gmail trash
        let move_result = session.uid_mv(uid.to_string(), "[Gmail]/Trash");
        
        if let Err(e) = move_result {
            log::warn!("MOVE to Trash failed, attempting fallback: {}", e);
            // Fallback: Gmail Labels extension + \Deleted
            let _ = session.uid_store(uid.to_string(), "+X-GM-LABELS (\\Trash)");
            let _ = session.uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)");
        }
        
        Ok::<(), String>(())
    }).await?;

    let app_handle_clone2 = app_handle.clone();
    // Delete locally
    let _ = tokio::task::spawn_blocking(move || {
        database::delete_message_local(&app_handle_clone2, "inbox", uid)
    }).await;
    
    crate::tray_state::refresh_unread_count_from_db(&app_handle);

    Ok(())
}

#[tauri::command]
pub async fn get_messages_page(
    app_handle: AppHandle,
    folder: String,
    before_uid: Option<u32>,
    limit: u32,
) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let safe_limit = limit.min(100);
    let folder = folder.to_lowercase();
    
    let app_handle_clone = app_handle.clone();
    let folder_clone = folder.clone();
    let pages = tokio::task::spawn_blocking(move || {
        database::load_messages_page(&app_handle_clone, &folder_clone, before_uid, safe_limit)
    })
    .await
    .map_err(|e| e.to_string())??;

    if folder == "inbox" {
        if let Some(account) = get_active_account(&app_handle) {
            let uids_to_prefetch = pages.iter().take(8).map(|m| m.uid).collect::<Vec<_>>();
            let app_handle_pf = app_handle.clone();
            
            // Fire-and-forget background prefetch enqueue
            tokio::spawn(async move {
                for uid in uids_to_prefetch {
                    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
                        app_handle_pf.clone(),
                        account.clone(),
                        crate::mail::body_prefetch_manager::PrefetchRequest { folder: "inbox".to_string(), uid },
                        crate::mail::body_prefetch_manager::PrefetchPriority::Background,
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
    requests: Vec<crate::mail::body_prefetch_manager::PrefetchRequest>,
) -> Result<(), String> {
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    
    // Clear old background queue before queueing the new viewport items
    crate::mail::body_prefetch_manager::PREFETCH_MANAGER.clear_background_queue().await;

    for request in requests {
        crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
            app_handle.clone(),
            account.clone(),
            request,
            crate::mail::body_prefetch_manager::PrefetchPriority::Background,
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
    let account = get_active_account(&app_handle).ok_or("No active account")?;
    let folder = folder.to_lowercase();
    
    let bytes = crate::mail::message_body::fetch_attachment_part(&account, &folder, uid, &part_id).await?;
    
    std::fs::write(&save_path, bytes)
        .map_err(|e| format!("Failed to write file to {}: {}", save_path, e))?;
    
    Ok(save_path)
}

#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
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
pub fn show_main_window(app_handle: AppHandle) -> Result<(), String> {
    if let Some(window) = tauri::Manager::get_webview_window(&app_handle, "main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
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
) -> Result<(), String> {
    let mut account = get_active_account(&app_handle).ok_or("No active account")?;
    let account_email = account.email.clone();

    let res = crate::mail::smtp_client::send_email(
        &app_handle,
        &mut account,
        to.clone(),
        cc,
        bcc,
        reply_to,
        &subject,
        &plain_body,
        &html_body,
    )
    .await
    .map_err(|e| e.to_string());

    // We do not manually insert the sent message into the local DB.
    // Gmail's SMTP automatically appends sent emails to the "[Gmail]/Sent Mail" folder,
    // and our IMAP IDLE connection will immediately detect and sync the real message
    // with the correct IMAP UID and metadata.

    res
}

#[tauri::command]
pub async fn get_unread_counts(app_handle: AppHandle) -> Result<std::collections::HashMap<String, u32>, String> {
    tokio::task::spawn_blocking(move || {
        let db_path = crate::mail::database::get_db_path(&app_handle)?;
        let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

        let mut counts = std::collections::HashMap::new();

        // 1. Unread counts for all folders
        let mut stmt = conn.prepare("SELECT folder, COUNT(*) FROM messages WHERE seen = 0 GROUP BY folder").unwrap();
        let rows = stmt.query_map([], |row| {
            let folder: String = row.get(0)?;
            let count: u32 = row.get(1)?;
            Ok((folder, count))
        }).unwrap();

        for row in rows {
            if let Ok((folder, count)) = row {
                counts.insert(folder.to_lowercase(), count);
            }
        }

        // 2. Unread count specifically for Starred
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM messages WHERE seen = 0 AND flagged = 1").unwrap();
        if let Ok(count) = stmt.query_row([], |row| row.get(0)) {
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
pub async fn get_sync_diagnostics(app_handle: AppHandle) -> Result<DiagnosticsSyncStatus, String> {
    tokio::task::spawn_blocking(move || {
        let global_state = crate::mail::database::get_global_sync_state(&app_handle).unwrap_or_default();
        let unread = crate::mail::database::get_global_unread_count(&app_handle).unwrap_or(0);
        
        let mut in_progress = false;
        if let Ok(Some(inbox_state)) = crate::mail::database::get_folder_sync_state(&app_handle, "inbox") {
            in_progress = inbox_state.sync_in_progress;
        }

        Ok(DiagnosticsSyncStatus {
            unread_count: unread,
            sync_in_progress: in_progress,
            last_sync_at: global_state.last_sync_at,
            last_successful_idle_at: global_state.last_successful_idle_at,
            last_notification_at: global_state.last_notification_at,
            last_sync_error: global_state.last_sync_error,
        })
    }).await.map_err(|e| e.to_string())?
}
