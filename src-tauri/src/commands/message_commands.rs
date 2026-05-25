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
        // Only update local SQLite for non-INBOX folders
        let _ = tokio::task::spawn_blocking(move || {
            database::set_message_seen(&app_handle, &folder_str, uid, true)
        }).await;
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
    let _ = tokio::task::spawn_blocking(move || {
        database::set_message_seen(&app_handle, "inbox", uid, true)
    }).await;

    log::info!("mark_as_read completed successfully for UID {}", uid);
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

    if folder_str != "inbox" {
        let _ = tokio::task::spawn_blocking(move || {
            database::delete_message_local(&app_handle, &folder_str, uid)
        }).await;
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

    // Delete locally
    let _ = tokio::task::spawn_blocking(move || {
        database::delete_message_local(&app_handle, "inbox", uid)
    }).await;

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
                // Cancel stale prefetch requests before enqueuing new ones
                crate::mail::prefetch::clear_prefetch_queue().await;
                
                for uid in uids_to_prefetch {
                    crate::mail::prefetch::enqueue_prefetch(app_handle_pf.clone(), account.clone(), uid).await;
                }
            });
        }
    }

    Ok(pages)
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

    if res.is_ok() {
        let _ = crate::mail::database::insert_sent_message(
            &app_handle,
            &account_email,
            &to,
            &subject,
            &plain_body,
            &html_body,
        );
    }

    res
}
