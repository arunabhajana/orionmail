use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::folder::MailFolder;
use crate::mail::message_list::MessageHeader;
use crate::mail::notifications;
use mailparse::parse_mail;

use tauri::AppHandle;

pub async fn sync_folder_with_options(
    app_handle: &AppHandle,
    account: Account,
    folder: MailFolder,
    force_reconcile: bool,
    history_pass: bool,
) -> Result<u32, String> {
    crate::auth::app_lock::require_unlocked(app_handle)?;
    let account = crate::auth::bootstrap::ensure_account(app_handle, &account.id).await?;
    if !history_pass {
        crate::mail::drafts::kick(app_handle);
        crate::mail::trash::retry_pending(app_handle, &account).await;
        crate::mail::message_actions::retry_pending(app_handle, &account).await;
        crate::mail::tags::outbox::retry_pending(app_handle, &account).await;
    }
    // Check global state for tags sync
    let global_state = database::get_global_sync_state(app_handle, &account.id).unwrap_or_default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    if force_reconcile || global_state.last_tag_sync_at.unwrap_or(0) + 900 < now {
        log::info!("Refreshing provider tags.");
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
                    crate::mail::tags::assignment::encode_mailbox_name(&tag.name)?
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

    let new_messages_count_future = crate::mail::imap_session::execute_with_session(
        &account,
        crate::mail::imap_session::SessionKind::Sync,
        move |session| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            let imap_mailbox = if folder_clone==MailFolder::Trash {crate::mail::trash::discover(&app_handle_clone,&account_clone,session)?}else{imap_mailbox.clone()};
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
                history_before_uid: None,
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
                let _mutation=crate::mail::message_actions::MUTATION_LOCK.blocking_lock();
                // A confirmed move may have initialized this mailbox while
                // sync was waiting. Re-read before invalidating its new cache.
                let latest=database::get_folder_sync_state(&app_handle_clone,&account_id,&folder_name_clone)?;
                let latest_validity=database::get_mailbox_validity(&app_handle_clone,&account_id,&imap_mailbox)?;
                if let Some(latest) = latest.filter(|state| latest_validity==Some(server_validity) && state.uid_validity==Some(server_validity)) {
                    sync_state=latest;
                }else{
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
                sync_state.history_before_uid = None;
                sync_state.last_synced_at = 0;
                sync_state.last_full_sync_at = 0;
                sync_state.uid_validity = Some(server_validity);
                database::update_folder_sync_state(&app_handle_clone, &sync_state)?;
                }
            }

            // New-arrival delta and existing-message reconciliation are independent.
            let mut num_new = 0;
            let is_bootstrap = sync_state.last_uid == 0 || sync_state.last_synced_at == 0;
            let end_uid = uid_next.saturating_sub(1);
            let history = sync_state.history_before_uid.unwrap_or(end_uid).min(end_uid);
            let batch = history_batch(session, sync_state.last_uid, end_uid, history)?;
            let pending = batch.uids;
            let has_more = batch.next_history > 0;
            let next_history = batch.next_history;
            if !pending.is_empty() {
                let batch_range = pending.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
                // A FETCH taken before a move must not commit
                // after that action and resurrect the source row. Enqueue is
                // independent of this network lock, so clicks remain local.
                let header_mutation = crate::mail::message_actions::MUTATION_LOCK.blocking_lock();

                let fetch_results = session
                    .uid_fetch(
                        &batch_range,
                        "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO CC REPLY-TO MESSAGE-ID REFERENCES IN-REPLY-TO)])",
                    )
                    .map_err(|e| format!("IMAP Fetch Error: {}", e))?;

                let mut messages = Vec::new();
                let mut raw_headers = Vec::new();

                for msg in fetch_results.iter() {
                    if !msg.uid.is_some_and(|uid| pending.contains(&uid)) { continue; }
                    if let Some(header) =
                        parse_header_to_message(msg, server_validity, &folder_name_clone)
                    {
                        messages.push(header);
                    } else if msg.header().is_some() {
                        return Err("Could not parse a requested header; checkpoint preserved".into());
                    }
                    if let Some(body) = msg.header() {
                        if let Ok(s) = std::str::from_utf8(body) {
                            raw_headers.push(s.to_string());
                        }
                    }
                }

                let batch_count = messages.len() as u32;
                num_new += batch_count;

                log::info!(
                    "Grabbed {} new messages for {}!",
                    batch_count,
                    folder_name_clone
                );
                database::insert_or_update_messages(&app_handle_clone, &account_id, &messages)
                    .map_err(|e| e.to_string())?;
                if folder_clone==MailFolder::Inbox && matches!(account_clone.provider,crate::auth::account::MailProvider::Google) {
                    crate::mail::trash::inbox_headers(&app_handle_clone,&account_id,&messages)?;
                }
                // Protect FETCH + header commit only. Gmail's membership
                // helper acquires this lock itself when committing labels.
                // Holding it across that call deadlocks the sync worker.
                drop(header_mutation);

                // Cached headers are ready to browse before label/contact
                // enrichment finishes. Do not make the list wait on it.
                if batch_count > 0 {
                    use tauri::Emitter;
                    if let Err(e) = app_handle_clone.emit("mail:updated", serde_json::json!({"account_id":account_id,"folder":folder_name_clone})) {
                        log::error!("Failed to emit mail:updated event: {}", e);
                    }
                }

                if batch_count > 0 {
                    crate::mail::tags::sync_message_tags(
                        session,
                        &batch_range,
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

                if batch_count > 0 {
                    if !is_bootstrap && crate::mail_preferences::load(&app_handle_clone).folder_notifications_allowed(&folder_clone.to_string()) {
                        let mut notif_batch = Vec::new();
                        for msg in messages.iter().filter(|msg| msg.uid > sync_state.last_uid) {
                            notif_batch.push((msg.from.clone(), msg.subject.clone(), msg.uid));
                        }
                        if !notif_batch.is_empty() { notifications::show_new_emails(
                            &app_handle_clone,
                            &account_id,
                            &folder_clone.to_string(),
                            &notif_batch,
                        ); }
                    }
                }

            }
            // Keep an arrival watermark and a separate descending history cursor.
            // Both advance only after header and label commits succeed.
            sync_state.last_uid = end_uid;
            sync_state.history_before_uid = Some(next_history);
            sync_state.last_synced_at = chrono::Utc::now().timestamp();
            database::update_folder_sync_state(&app_handle_clone, &sync_state)?;

            let now = chrono::Utc::now().timestamp();
            let maintenance_due = crate::mail::reconciliation::is_due(sync_state.last_full_sync_at, now, force_reconcile);
            if !has_more && maintenance_due && matches!(account_clone.provider, crate::auth::account::MailProvider::Google) && num_new == 0 {
                crate::mail::tags::gmail::refresh_cached_memberships(session,&folder_name_clone,&account_id,&app_handle_clone)?;
            }
            let mut changed = num_new > 0;
            if !has_more && maintenance_due {
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
                    changed = true;
                    use tauri::Emitter;
                    let _ = app_handle_clone.emit("mail:updated", serde_json::json!({"account_id":account_id,"folder":folder_name_clone}));
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
            }

            sync_state.last_synced_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            sync_state.last_error = None;
            database::update_folder_sync_state(&app_handle_clone, &sync_state)?;

            if changed {
                crate::tray_state::refresh_unread_count_from_db(&app_handle_clone);
                notifications::schedule_refresh(&app_handle_clone,&account_id);
            }
            Ok(num_new)
        },
    );

    let new_messages_count = match new_messages_count_future.await {
        Ok(count) => count,
        Err(e) => {
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
    };

    // Quiet syncs must not keep crawling older uncached bodies while the user
    // is idle. The settled viewport already prefetches messages being browsed.
    let preferences = crate::mail_preferences::load(app_handle);
    if !history_pass && new_messages_count > 0 && crate::window_activity::is_displayed()
        && preferences.prefetch_bodies && !preferences.sync_paused
    {
        let cache_app = app_handle.clone();
        let cache_account = account.id.clone();
        let cache_folder = folder_name.clone();
        let uids = tokio::task::spawn_blocking(move || {
            database::get_unfetched_recent_uids(&cache_app, &cache_account, &cache_folder, 10)
                .unwrap_or_default()
        }).await.unwrap_or_default();
        for uid in uids {
            crate::mail::body_prefetch_manager::PREFETCH_MANAGER
                .enqueue(
                    app_handle.clone(),
                    account.clone(),
                    folder_name.clone(),
                    uid,
                    crate::mail::body_prefetch_manager::PrefetchPriority::Background,
                    None,
                )
                .await;
        }
    }

    if new_messages_count>0 && folder==MailFolder::Trash && matches!(account.provider,crate::auth::account::MailProvider::Google){
        let cleanup_app=app_handle.clone();let cleanup_account=account.id.clone();
        tokio::task::spawn_blocking(move||{
            let _mutation=crate::mail::message_actions::MUTATION_LOCK.blocking_lock();
            let conn=database::open_connection(&cleanup_app)?;
            conn.execute("DELETE FROM messages WHERE rowid IN (SELECT m.rowid FROM messages t JOIN messages m ON m.account_id=t.account_id AND m.message_id=t.message_id AND m.date=t.date AND m.sender=t.sender AND m.subject=t.subject WHERE t.account_id=?1 AND t.folder='trash' AND NULLIF(t.message_id,'') IS NOT NULL AND m.folder<>'trash')",[&cleanup_account]).map_err(|e|e.to_string())?;
            crate::mail::search::SEARCH_CACHE.retain(|_,entry|entry.account_id!=cleanup_account);Ok::<_,String>(())
        }).await.map_err(|e|e.to_string())??;
        use tauri::Emitter;let _=app_handle.emit("mail:labels_changed",&account.id);crate::tray_state::refresh_unread_count_from_db(app_handle);
    }
    crate::cache_preferences::kick(app_handle,false);
    Ok(new_messages_count)
}

pub(crate) fn parse_header_to_message(
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

    let timestamp = message_timestamp(&date, msg.internal_date().map(|date| date.timestamp()));

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
        thread_id: conversation_root(&parsed),
        snippet,
        to: to_opt,
        message_id,
        tags: Vec::new(),
    })
}

// Never turn old mail into new mail because its Date header is malformed.
pub(crate) fn message_timestamp(date: &str, internal_date: Option<i64>) -> i64 {
    chrono::DateTime::parse_from_rfc2822(date.trim()).ok().map(|date| date.timestamp())
        // mailparse returns Ok(0) for some incomplete/invalid inputs.
        .or_else(|| mailparse::dateparse(date).ok().filter(|date| *date > 0))
        .or(internal_date).unwrap_or(0)
}

const HEADER_BATCH_SIZE: usize = 200;

pub(crate) fn conversation_root(mail: &mailparse::ParsedMail<'_>) -> Option<String> {
    use mailparse::MailHeaderMap;
    for name in ["References", "In-Reply-To", "Message-ID"] {
        if let Some(value) = mail.headers.get_first_value(name) {
            if let Some(start) = value.find('<') {
                if let Some(end) = value[start..].find('>') {
                    let id = &value[start..=start+end];
                    if id.len() <= 998 && !id.chars().any(char::is_control) { return Some(id.to_string()); }
                }
            }
        }
    }
    None
}
const UID_SEARCH_WINDOW: u32 = 8192;

fn pending_uid_criteria(last_uid: u32, end: u32, history: u32) -> Option<String> {
    let arrival_start = last_uid.saturating_add(1).max(window_start(end));
    let history_start = window_start(history);
    match (last_uid < end, history > 0) {
        (true, true) => Some(format!("OR UID {arrival_start}:{end} UID {history_start}:{history}")),
        (true, false) => Some(format!("UID {arrival_start}:{end}")),
        (false, true) => Some(format!("UID {history_start}:{history}")),
        (false, false) => None,
    }
}

fn window_start(end: u32) -> u32 {
    end.saturating_sub(UID_SEARCH_WINDOW - 1).max(1)
}

struct HistoryBatch {
    uids: Vec<u32>,
    next_history: u32,
}

fn history_batch<T: std::io::Read + std::io::Write>(
    session: &mut imap::Session<T>, last_uid: u32, end: u32, history: u32,
) -> Result<HistoryBatch, String> {
    let mut pending: Vec<u32> = if let Some(criteria) = pending_uid_criteria(last_uid, end, history) {
        session.uid_search(criteria)
            .map_err(|e| format!("Mailbox UID search failed: {e}"))?
            .into_iter().filter(|uid| *uid > 0 && *uid <= end).collect()
    } else { Vec::new() };
    pending.sort_unstable_by(|a, b| b.cmp(a));
    let has_more = pending.len() > HEADER_BATCH_SIZE;
    pending.truncate(HEADER_BATCH_SIZE);
    let next_history = if has_more {
        pending.last().copied().unwrap_or(1).saturating_sub(1)
    } else {
        // Empty UID windows still advance. If arrivals exceeded the window,
        // their older portion becomes history rather than being skipped.
        let older_arrivals = if window_start(end) > last_uid.saturating_add(1) {
            window_start(end) - 1
        } else { 0 };
        window_start(history).saturating_sub(1).max(older_arrivals)
    };
    Ok(HistoryBatch { uids: pending, next_history })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};

    #[test]
    fn conversations_use_reply_headers_instead_of_subjects() {
        let root = |header: &str| conversation_root(&mailparse::parse_mail(header.as_bytes()).unwrap());
        assert_eq!(root("Message-ID: <child>\r\nReferences: <root> <parent>\r\nIn-Reply-To: <parent>\r\n\r\n"),Some("<root>".into()));
        assert_eq!(root("Message-ID: <child>\r\nIn-Reply-To: <parent>\r\n\r\n"),Some("<parent>".into()));
        assert_eq!(root("Subject: Monthly statement\r\n\r\n"),None);
    }

    struct Wire(Cursor<Vec<u8>>);
    impl Read for Wire {
        fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> { self.0.read(bytes) }
    }
    impl Write for Wire {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { Ok(bytes.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    fn session(replies: &str) -> imap::Session<Wire> {
        imap::Client::new(Wire(Cursor::new(replies.as_bytes().to_vec())))
            .login("test", "test").map_err(|(error, _)| error).unwrap()
    }

    #[test]
    fn sparse_history_resumes_newest_first_and_new_arrivals_take_priority() {
        // Sparse UIDs, as in a mailbox where old mail has been moved/deleted.
        let all: Vec<u32> = (1..=450).map(|uid| uid * 3).collect();
        let search = |uids: &[u32]| uids.iter().map(u32::to_string).collect::<Vec<_>>().join(" ");
        let mut wire = session(&format!(
            "a1 OK login\r\n* SEARCH {}\r\na2 OK search\r\n* SEARCH {} 2000\r\na3 OK search\r\n* SEARCH {}\r\na4 OK search\r\n",
            search(&all), search(&all[..250]), search(&all[..51]),
        ));
        let first = history_batch(&mut wire, 0, 1350, 1350).unwrap();
        assert_eq!(first.uids.len(), 200);
        assert_eq!(first.uids[0], 1350);
        let second = history_batch(&mut wire, 1350, 2000, first.next_history).unwrap();
        assert_eq!(second.uids[0], 2000);
        let third = history_batch(&mut wire, 2000, 2000, second.next_history).unwrap();
        assert_eq!(third.next_history, 0);
        let mut fetched = [first.uids, second.uids, third.uids].concat();
        fetched.sort_unstable();
        let mut expected = all;
        expected.push(2000);
        assert_eq!(fetched, expected); // No skipped or repeated history UIDs.
    }

    #[test]
    fn empty_completed_and_failed_searches_preserve_safe_boundaries() {
        let mut empty = session("a1 OK login\r\n* SEARCH\r\na2 OK search\r\n");
        assert_eq!(history_batch(&mut empty, 0, 500, 500).unwrap().next_history, 0);
        let mut completed = session("a1 OK login\r\n");
        assert!(history_batch(&mut completed, 500, 500, 0).unwrap().uids.is_empty());
        assert!(history_batch(&mut completed, 0, 0, 0).unwrap().uids.is_empty());
        let mut failed = session("a1 OK login\r\na2 NO disconnected\r\n");
        assert!(history_batch(&mut failed, 500, 700, 200).is_err());
        assert_eq!(pending_uid_criteria(500, 500, 200).as_deref(), Some("UID 1:200"));
    }

    #[test]
    fn bounded_search_preserves_unsearched_history_and_large_arrival_gaps() {
        assert_eq!(pending_uid_criteria(100_000, 100_000, 50_000).unwrap(), "UID 41809:50000");
        let mut empty_window = session("a1 OK login\r\n* SEARCH\r\na2 OK search\r\n");
        let batch = history_batch(&mut empty_window, 100_000, 100_000, 50_000).unwrap();
        assert!(batch.uids.is_empty());
        assert_eq!(batch.next_history, 41_808); // Empty window is not end-of-history.
        let mut arrivals = session("a1 OK login\r\n* SEARCH 99999 100000\r\na2 OK search\r\n");
        let batch = history_batch(&mut arrivals, 10, 100_000, 0).unwrap();
        assert_eq!(batch.uids, vec![100_000, 99_999]);
        assert_eq!(batch.next_history, 91_808); // Older arrivals remain discoverable.
    }

    #[test]
    fn malformed_dates_never_sort_old_mail_as_new() {
        let expected = chrono::DateTime::parse_from_rfc3339("2026-05-16T13:09:00Z").unwrap().timestamp();
        // The weekday is intentionally wrong, which strict RFC2822 rejects.
        assert_eq!(message_timestamp("Mon, 16 May 2026 18:39:00 +0530", Some(99)), expected);
        assert_eq!(message_timestamp("16 May 2026 18:39:00 +0530 (IST)", Some(99)), expected);
        assert_eq!(message_timestamp("not a date", Some(expected)), expected);
        assert_eq!(message_timestamp("", None), 0);
    }

    #[test]
    fn fetched_headers_use_server_date_when_sender_date_is_invalid() {
        let header = "Subject: Old statement\r\nFrom: bank@example.com\r\nDate: broken\r\n\r\n";
        let mut wire = session(&format!(
            "a1 OK login\r\n* 1 FETCH (UID 42 FLAGS () INTERNALDATE \"16-May-2026 18:39:00 +0530\" BODY[HEADER] {{{}}}\r\n{})\r\na2 OK fetch\r\n", header.len(), header,
        ));
        let rows = wire.uid_fetch("42", "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])").unwrap();
        let message = parse_header_to_message(&rows[0], 9, "tag:bank").unwrap();
        assert_eq!(message.date, chrono::DateTime::parse_from_rfc3339("2026-05-16T13:09:00Z").unwrap().timestamp());
        assert_eq!(message.folder, "tag:bank");
        assert_eq!(message.uid, 42);
    }
}
