use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::folder::MailFolder;
use crate::mail::message_list::MessageHeader;
use crate::mail::notifications;
use mailparse::parse_mail;

use tauri::AppHandle;

// Re-export the SYNC_LOCK from sync_manager for backwards compatibility with poll/idle
pub use crate::mail::sync_manager::SYNC_LOCK;

pub async fn sync_inbox(app_handle: &AppHandle, account: Account) -> Result<u32, String> {
    sync_folder(app_handle, account, MailFolder::Inbox).await
}

pub async fn sync_folder(
    app_handle: &AppHandle,
    account: Account,
    folder: MailFolder,
) -> Result<u32, String> {
    sync_folder_with_options(app_handle, account, folder, false).await
}

pub async fn sync_folder_with_options(
    app_handle: &AppHandle,
    account: Account,
    folder: MailFolder,
    force_reconcile: bool,
) -> Result<u32, String> {
    crate::auth::app_lock::require_unlocked(app_handle)?;
    crate::mail::message_actions::retry_pending(app_handle, &account).await;
    // Check global state for tags sync
    let global_state = database::get_global_sync_state(app_handle, &account.id).unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    if global_state.last_tag_sync_at.unwrap_or(0) + 900 < now {
        log::info!("Tags are older than 15 mins, syncing tags via provider.");
        if let Err(e) = crate::mail::tags::sync_tags(app_handle, &account).await {
            log::error!("Failed to sync tags: {}", e);
        }
    }

    let imap_mailbox = match folder.to_imap_mailbox(&account.provider) {
        Some(mb) => mb.to_string(),
        None => {
            if let crate::mail::folder::MailFolder::Tag(ref tag_id) = folder {
                let tags = crate::mail::database::get_all_tags(app_handle, &account.id)
                    .unwrap_or_default();
                if let Some(tag) = tags.iter().find(|t| &t.id == tag_id) {
                    tag.name.clone()
                } else {
                    log::warn!(
                        "Tag ID {} not found in database. Skipping IMAP sync.",
                        tag_id
                    );
                    return Ok(0);
                }
            } else {
                log::info!("Folder {} is virtual. Skipping IMAP sync.", folder);
                return Ok(0);
            }
        }
    };

    let folder_name = folder.to_string();
    let app_handle_clone = app_handle.clone();
    let folder_name_clone = folder_name.clone();
    let folder_clone = folder.clone();
    let account_clone = account.clone();
    let account_id = account.id.clone();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);

    let new_messages_count_future = crate::mail::imap_session::execute_with_session(
        &account,
        crate::mail::imap_session::SessionKind::Sync,
        move |session| {
            // Use the drop guard to automatically clear sync_in_progress if we panic
            let _progress_guard = database::SyncProgressGuard::new(
                app_handle_clone.clone(),
                account_id.clone(),
                folder_name_clone.clone(),
            )?;

            let mut sync_state = database::get_folder_sync_state(
                &app_handle_clone,
                &account_id,
                &folder_name_clone,
            )?
            .unwrap_or_else(|| database::FolderSyncState {
                account_id: account_id.clone(),
                folder: folder_name_clone.clone(),
                last_uid: 0,
                last_synced_at: 0,
                sync_in_progress: true,
                last_full_sync_at: 0,
                last_error: None,
                uid_validity: None,
            });

            let stored_validity =
                database::get_mailbox_validity(&app_handle_clone, &account_id, &imap_mailbox)?;

            let mailbox = if folder_clone == MailFolder::Inbox {
                session
                    .select(&imap_mailbox)
                    .map_err(|e| format!("IMAP Select Error: {}", e))?
            } else {
                session
                    .examine(&imap_mailbox)
                    .map_err(|e| format!("IMAP Examine Error: {}", e))?
            };

            if let crate::mail::folder::MailFolder::Tag(ref _t) = folder_clone {
                log::info!("IMAP Examine details for tag '{}': exists={}, uid_next={:?}, uid_validity={:?}", imap_mailbox, mailbox.exists, mailbox.uid_next, mailbox.uid_validity);
            }

            let server_validity = mailbox
                .uid_validity
                .filter(|v| *v != 0)
                .ok_or("Mailbox did not provide a valid UIDVALIDITY")?;
            let uid_next = mailbox.uid_next.ok_or("Mailbox did not provide UIDNEXT")?;

            // 1. UIDVALIDITY Check
            if stored_validity != Some(server_validity)
                || sync_state.uid_validity != Some(server_validity)
            {
                log::info!(
                    "UIDVALIDITY changed ({} -> {}). Clearing cache.",
                    stored_validity.unwrap_or(0),
                    server_validity
                );
                let conflicts = database::reset_mailbox_epoch(
                    &app_handle_clone,
                    &account_id,
                    &folder_name_clone,
                    &imap_mailbox,
                    server_validity,
                )?;
                if conflicts > 0 {
                    use tauri::Emitter;
                    let _ = app_handle_clone.emit("mail:action_conflict", serde_json::json!({"account_id":account_id,"folder":folder_name_clone,"error":"Mailbox identity changed. Old queued actions were stopped to protect your mail."}));
                }
                sync_state.last_uid = 0;
                sync_state.last_full_sync_at = 0;
                sync_state.uid_validity = Some(server_validity);
                database::update_folder_sync_state(&app_handle_clone, &sync_state)?;
            }

            // New-arrival delta and existing-message reconciliation are independent.
            let mut num_new = 0;
            let is_bootstrap = sync_state.last_uid == 0;
            if uid_next > sync_state.last_uid.saturating_add(1) {
                let range = if is_bootstrap {
                    let end = uid_next.saturating_sub(1);
                    format!("{}:{}", 1, end)
                } else {
                    let end = uid_next.saturating_sub(1);
                    let start_uid = sync_state.last_uid + 1;
                    if start_uid > end {
                        return Ok(0);
                    }
                    format!("{}:{}", start_uid, end)
                };

                log::info!("Fetching interval for {}: {}", folder_name_clone, range);

                let fetch_results = session
                    .uid_fetch(
                        &range,
                        "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO CC REPLY-TO)])",
                    )
                    .map_err(|e| format!("IMAP Fetch Error: {}", e))?;

                let mut messages = Vec::new();
                let mut raw_headers = Vec::new();
                let mut max_fetched_uid = sync_state.last_uid;

                for msg in fetch_results.iter() {
                    if let Some(header) =
                        parse_header_to_message(msg, server_validity, &folder_name_clone)
                    {
                        if header.uid > max_fetched_uid {
                            max_fetched_uid = header.uid;
                        }
                        messages.push(header);
                    }
                    if let Some(body) = msg.header() {
                        if let Ok(s) = std::str::from_utf8(body) {
                            raw_headers.push(s.to_string());
                        }
                    }
                }

                num_new = messages.len() as u32;

                log::info!(
                    "Grabbed {} new messages for {}!",
                    num_new,
                    folder_name_clone
                );
                database::insert_or_update_messages(&app_handle_clone, &account_id, &messages)
                    .map_err(|e| e.to_string())?;

                if num_new > 0 {
                    crate::mail::tags::sync_message_tags(
                        session,
                        &range,
                        &folder_name_clone,
                        &account_clone.id,
                        &account_clone.provider,
                        &app_handle_clone,
                    )
                    .map_err(|e| format!("Failed to sync message tags: {e}"))?;
                }

                if !raw_headers.is_empty() {
                    if let Err(e) = crate::contacts::contact_indexer::extract_and_store_contacts(
                        &app_handle_clone,
                        &raw_headers,
                    ) {
                        log::error!("Failed to index contacts: {}", e);
                    }
                }

                if num_new > 0 {
                    use tauri::Emitter;
                    if let Err(e) = app_handle_clone.emit("mail:updated", &folder_name_clone) {
                        log::error!("Failed to emit mail:updated event: {}", e);
                    }

                    if !is_bootstrap && folder_clone == MailFolder::Inbox {
                        let mut notif_batch = Vec::new();
                        for msg in &messages {
                            notif_batch.push((msg.from.clone(), msg.subject.clone(), msg.uid));
                        }
                        notifications::show_new_emails(
                            &app_handle_clone,
                            &account_id,
                            &notif_batch,
                        );
                    }
                }

                // Empty successful ranges are valid when UIDs have been expunged.
                sync_state.last_uid = std::cmp::max(max_fetched_uid, uid_next.saturating_sub(1));
                database::update_folder_sync_state(&app_handle_clone, &sync_state)?;
            }

            let now = chrono::Utc::now().timestamp();
            if crate::mail::reconciliation::is_due(
                sync_state.last_full_sync_at,
                now,
                force_reconcile,
            ) {
                let changes = crate::mail::reconciliation::reconcile(
                    &app_handle_clone,
                    &account_id,
                    &folder_name_clone,
                    &imap_mailbox,
                    server_validity,
                    session,
                    deadline,
                )?;
                sync_state.last_full_sync_at = now;
                if changes.updated > 0 || changes.removed > 0 {
                    use tauri::Emitter;
                    let _ = app_handle_clone.emit("mail:updated", &folder_name_clone);
                    crate::tray_state::refresh_unread_count_from_db(&app_handle_clone);
                }
            }

            if folder_clone == MailFolder::Inbox {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64;
                let _ = crate::mail::database::update_global_sync_time(
                    &app_handle_clone,
                    &account_id,
                    Some(now),
                    None,
                );
                crate::tray_state::set_last_sync_time(&app_handle_clone, &account_id);
                crate::tray_state::refresh_unread_count_from_db(&app_handle_clone);
            }

            sync_state.last_synced_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            sync_state.last_error = None;
            database::update_folder_sync_state(&app_handle_clone, &sync_state)?;

            Ok(num_new)
        },
    );

    let new_messages_count = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        new_messages_count_future,
    )
    .await
    {
        Ok(Ok(count)) => count,
        Ok(Err(e)) => {
            // Error handling
            let mut sync_state =
                database::get_folder_sync_state(&app_handle, &account.id, &folder_name)
                    .unwrap_or(None)
                    .unwrap_or_default();
            sync_state.account_id = account.id.clone();
            sync_state.folder = folder_name.clone();
            sync_state.last_error = Some(e.clone());
            let _ = database::update_folder_sync_state(&app_handle, &sync_state);
            if folder == MailFolder::Inbox {
                let _ = crate::mail::database::update_global_sync_time(
                    &app_handle,
                    &account.id,
                    None,
                    Some(e.clone()),
                );
            }
            return Err(e);
        }
        Err(_) => return Err("Sync Connection Timeout".to_string()),
    };

    // Enqueue top 10 most recent UIDs for prefetching immediately after sync
    let uids = database::get_unfetched_recent_uids(app_handle, &account.id, &folder_name, 10)
        .unwrap_or_default();

    for uid in uids {
        let pf_app = app_handle.clone();
        let pf_acc = account.clone();
        let pf_folder = folder_name.clone();
        tokio::spawn(async move {
            crate::mail::body_prefetch_manager::PREFETCH_MANAGER
                .enqueue(
                    pf_app,
                    pf_acc,
                    pf_folder,
                    uid,
                    crate::mail::body_prefetch_manager::PrefetchPriority::Background,
                    None,
                )
                .await;
        });
    }

    Ok(new_messages_count)
}

fn parse_header_to_message(
    msg: &imap::types::Fetch,
    server_validity: u32,
    folder_name: &str,
) -> Option<MessageHeader> {
    let actual_uid = msg.uid?;
    let body = msg.header()?;

    let seen = msg
        .flags()
        .iter()
        .any(|f| matches!(f, imap::types::Flag::Seen));
    let flagged = msg
        .flags()
        .iter()
        .any(|f| matches!(f, imap::types::Flag::Flagged));

    let parsed = parse_mail(body).ok()?;

    let mut subject = String::new();
    let mut from = String::new();
    let mut to_recipient = String::new();
    let mut date = String::new();
    let mut message_id = None;

    for header in parsed.get_headers() {
        let key = header.get_key().to_lowercase();
        let val = header.get_value();

        match key.as_str() {
            "subject" => subject = val,
            "from" => from = val,
            "to" => to_recipient = val,
            "date" => date = val,
            "message-id" => message_id = Some(val),
            _ => {}
        }
    }

    let clean_date = date.trim().replace('\r', "").replace('\n', "");
    let timestamp = chrono::DateTime::parse_from_rfc2822(&clean_date)
        .map(|dt| dt.timestamp())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp());

    let plain_body = parsed.get_body().unwrap_or_default();

    let snippet = if !plain_body.is_empty() {
        let clean: String = plain_body
            .replace('\n', " ")
            .replace('\r', "")
            .chars()
            .take(180)
            .collect();
        Some(clean)
    } else {
        None
    };

    let to_opt = if to_recipient.is_empty() {
        None
    } else {
        Some(to_recipient.trim().to_string())
    };

    Some(MessageHeader {
        folder: folder_name.to_string(),
        uid: actual_uid,
        uid_validity: server_validity,
        subject,
        from,
        date: timestamp,
        seen,
        flagged,
        has_attachments: false,
        thread_id: None,
        snippet,
        to: to_opt,
        message_id,
        tags: Vec::new(),
    })
}
