use crate::auth::account::Account;
use crate::mail::message_list::MessageHeader;
use crate::mail::database;
use crate::mail::notifications;
use crate::mail::folder::MailFolder;
use mailparse::parse_mail;
use native_tls::TlsConnector;
use tauri::AppHandle;

// Re-export the SYNC_LOCK from sync_manager for backwards compatibility with poll/idle
pub use crate::mail::sync_manager::SYNC_LOCK;

pub async fn sync_inbox(app_handle: &AppHandle, account: Account) -> Result<u32, String> {
    sync_folder(app_handle, account, MailFolder::Inbox).await
}

pub async fn sync_folder(app_handle: &AppHandle, account: Account, folder: MailFolder) -> Result<u32, String> {
    let imap_mailbox = match folder.to_imap_mailbox(&account.provider) {
        Some(mb) => mb.to_string(),
        None => {
            log::info!("Folder {} is virtual. Skipping IMAP sync.", folder);
            return Ok(0);
        }
    };

    let folder_name = folder.to_string();
    let email = account.email.clone();
    let access_token = account.access_token.clone();
    let app_handle_clone = app_handle.clone();
    let folder_name_clone = folder_name.clone();
    let imap_config = account.provider.imap_config();
    let domain = imap_config.host;
    let port = imap_config.port;

    let new_messages_count = tokio::task::spawn_blocking(move || {
        // Use the drop guard to automatically clear sync_in_progress if we panic
        let _progress_guard = database::SyncProgressGuard::new(app_handle_clone.clone(), folder_name_clone.clone())?;

        let mut sync_state = database::get_folder_sync_state(&app_handle_clone, &folder_name_clone)
            .unwrap_or(None)
            .unwrap_or_else(|| database::FolderSyncState {
                folder: folder_name_clone.clone(),
                last_uid: 0,
                last_synced_at: 0,
                sync_in_progress: true, // Already set by guard
                last_full_sync_at: 0,
                last_error: None,
            });

        // We also need uid_validity which is still stored in mailbox_state (per plan)
        let stored_validity = database::get_mailbox_validity(&app_handle_clone, &imap_mailbox).unwrap_or(None);

        let tls = TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS Builder Error: {}", e))?;

        let client = imap::connect((domain.as_str(), port), domain.as_str(), &tls)
            .map_err(|e| format!("IMAP Connection Error: {}", e))?;

        let auth_raw = format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            email, access_token
        );

        struct XoAuth2 { auth_string: String }
        impl imap::Authenticator for XoAuth2 {
            type Response = String;
            fn process(&self, _: &[u8]) -> Self::Response { self.auth_string.clone() }
        }

        let auth = XoAuth2 { auth_string: auth_raw };

        let mut session = client
            .authenticate("XOAUTH2", &auth)
            .map_err(|(e, _)| format!("IMAP Authentication Failed: {}", e))?;

        let result = (|| -> Result<u32, String> {
            let mailbox = if folder == MailFolder::Inbox {
                session.select(&imap_mailbox).map_err(|e| format!("IMAP Select Error: {}", e))?
            } else {
                session.examine(&imap_mailbox).map_err(|e| format!("IMAP Examine Error: {}", e))?
            };

            let server_validity = mailbox.uid_validity.unwrap_or(0);
            let uid_next = mailbox.uid_next.unwrap_or(0);

            // 1. UIDVALIDITY Check
            if stored_validity != Some(server_validity) {
                log::info!("UIDVALIDITY changed ({} -> {}). Clearing cache.", stored_validity.unwrap_or(0), server_validity);
                database::clear_messages(&app_handle_clone, &folder_name_clone)?;
                database::update_mailbox_validity(&app_handle_clone, &imap_mailbox, server_validity)?;
                sync_state.last_uid = 0;
            }

            // 2. Fast Exit Check
            if uid_next <= sync_state.last_uid + 1 {
                log::info!("{} already up to date.", folder_name_clone);
                return Ok(0);
            }

            // 3. Strategy based on is_bootstrap
            let is_bootstrap = sync_state.last_uid == 0;
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

            // --- DEFENSIVE RE-SELECT ---
            if folder == MailFolder::Inbox {
                let _ = session.select(&imap_mailbox).map_err(|e| format!("IMAP Re-Select Error: {}", e))?;
            } else {
                let _ = session.examine(&imap_mailbox).map_err(|e| format!("IMAP Re-Examine Error: {}", e))?;
            }

            let fetch_results = session.uid_fetch(
                &range,
                "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO CC REPLY-TO)])"
            ).map_err(|e| format!("IMAP Fetch Error: {}", e))?;

            let mut messages = Vec::new();
            let mut raw_headers = Vec::new();
            let mut max_fetched_uid = sync_state.last_uid;
            
            for msg in fetch_results.iter() {
                if let Some(header) = parse_header_to_message(msg, server_validity, &folder_name_clone) {
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

            let num_new = messages.len() as u32;

            if num_new == 0 && (sync_state.last_uid + 1) < uid_next {
                log::warn!(
                    "Suspicious zero-sync detected for {}! Expected messages in range {}, but got 0. Forcing session discard.",
                    folder_name_clone, range
                );
                return Err("Suspicious zero-sync detected".to_string());
            }

            log::info!("Grabbed {} new messages for {}!", num_new, folder_name_clone);
            database::insert_or_update_messages(&app_handle_clone, &messages)?;
            
            if !raw_headers.is_empty() {
                if let Err(e) = crate::contacts::contact_indexer::extract_and_store_contacts(&app_handle_clone, &raw_headers) {
                    log::error!("Failed to index contacts: {}", e);
                }
            }

            if num_new > 0 {
                use tauri::Emitter;
                // Include the folder name so the frontend can selectively refresh
                if let Err(e) = app_handle_clone.emit("mail:updated", &folder_name_clone) {
                    log::error!("Failed to emit mail:updated event: {}", e);
                }

                if !is_bootstrap && folder == MailFolder::Inbox {
                    let mut notif_batch = Vec::new();
                    for msg in &messages {
                        notif_batch.push((msg.from.clone(), msg.subject.clone(), msg.uid));
                    }
                    notifications::show_new_emails(&app_handle_clone, &notif_batch);
                }
            }

            if folder == MailFolder::Inbox {
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
                let _ = crate::mail::database::update_global_sync_time(&app_handle_clone, Some(now), None);
                crate::tray_state::set_last_sync_time(&app_handle_clone);
                crate::tray_state::refresh_unread_count_from_db(&app_handle_clone);
            }

            // Update sync state
            sync_state.last_uid = std::cmp::max(sync_state.last_uid, max_fetched_uid);
            sync_state.last_synced_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
            sync_state.last_error = None;
            let _ = database::update_folder_sync_state(&app_handle_clone, &sync_state);

            Ok(num_new)
        })();

        let _ = session.logout();
        
        if let Err(ref e) = result {
            sync_state.last_error = Some(e.clone());
            let _ = database::update_folder_sync_state(&app_handle_clone, &sync_state);
            if folder == MailFolder::Inbox {
                let _ = crate::mail::database::update_global_sync_time(&app_handle_clone, None, Some(e.clone()));
            }
        }

        result
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    // Enqueue top 10 most recent UIDs for prefetching immediately after sync
    let uids = database::get_unfetched_recent_uids(app_handle, &folder_name, 10).unwrap_or_default();
    
    for uid in uids {
        let pf_app = app_handle.clone();
        let pf_acc = account.clone();
        let pf_folder = folder_name.clone();
        tokio::spawn(async move {
            crate::mail::body_prefetch_manager::PREFETCH_MANAGER.enqueue(
                pf_app,
                pf_acc,
                crate::mail::body_prefetch_manager::PrefetchRequest { folder: pf_folder, uid },
                crate::mail::body_prefetch_manager::PrefetchPriority::Background,
            ).await;
        });
    }

    new_messages_count
}

fn parse_header_to_message(msg: &imap::types::Fetch, server_validity: u32, folder_name: &str) -> Option<MessageHeader> {
    let actual_uid = msg.uid?;
    let body = msg.header()?;

    let seen = msg.flags().iter().any(|f| matches!(f, imap::types::Flag::Seen));
    let flagged = msg.flags().iter().any(|f| matches!(f, imap::types::Flag::Flagged));

    let parsed = parse_mail(body).ok()?;
    
    let mut subject = String::new();
    let mut from = String::new();
    let mut to_recipient = String::new();
    let mut date = String::new();

    for header in parsed.get_headers() {
        let key = header.get_key().to_lowercase();
        let val = header.get_value();

        match key.as_str() {
            "subject" => subject = val,
            "from" => from = val,
            "to" => to_recipient = val,
            "date" => date = val,
            _ => {}
        }
    }

    let clean_date = date.trim().replace('\r', "").replace('\n', "");
    let timestamp = chrono::DateTime::parse_from_rfc2822(&clean_date)
        .map(|dt| dt.timestamp())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp());

    let mut plain_body = String::new();
    if let Ok(parsed_full) = parse_mail(body) {
        plain_body = parsed_full.get_body().unwrap_or_default();
    }

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

    let to_opt = if to_recipient.is_empty() { None } else { Some(to_recipient.trim().to_string()) };

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
    })
}
