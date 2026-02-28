use crate::auth::account::Account;
use crate::mail::message_list::MessageHeader;
use crate::mail::database;
use crate::mail::prefetch;
use mailparse::parse_mail;
use native_tls::TlsConnector;
use tauri::AppHandle;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex as AsyncMutex;
use once_cell::sync::Lazy;

pub static SYNC_LOCK: Lazy<AsyncMutex<()>> = Lazy::new(|| AsyncMutex::new(()));

pub async fn sync_inbox(app_handle: &AppHandle, account: Account) -> Result<u32, String> {

    let email = account.email.clone();
    let access_token = account.access_token.clone();
    let app_handle_clone = app_handle.clone();

    let new_messages_count = tokio::task::spawn_blocking(move || {
        let mut last_uid = database::get_highest_uid(&app_handle_clone, "INBOX").unwrap_or(0);
        let stored_validity = database::get_mailbox_validity(&app_handle_clone, "INBOX").unwrap_or(None);

        let domain = "imap.gmail.com";
        let port = 993;

        let tls = TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("TLS Builder Error: {}", e))?;

        let client = imap::connect((domain, port), domain, &tls)
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
            let mailbox = session.select("INBOX").map_err(|e| format!("IMAP Select Error: {}", e))?;
            let server_validity = mailbox.uid_validity.unwrap_or(0);
            let uid_next = mailbox.uid_next.unwrap_or(0);

            // 1. UIDVALIDITY Check
            if stored_validity != Some(server_validity) {
                log::info!("UIDVALIDITY changed ({} -> {}). Clearing cache.", stored_validity.unwrap_or(0), server_validity);
                database::clear_messages(&app_handle_clone, "INBOX")?;
                database::update_mailbox_validity(&app_handle_clone, "INBOX", server_validity)?;
                last_uid = 0;
            }

            // 2. Fast Exit Check
            if uid_next <= last_uid + 1 {
                log::info!("Inbox already up to date.");
                return Ok(0);
            }

            // 3. Exact Sequence Range Fetch
            let (start_uid, end_uid, is_bootstrap) = if last_uid == 0 {
                // To support true infinite scrolling across the entire mailbox,
                // we must fetch all message headers locally instead of just 200.
                let end = uid_next.saturating_sub(1);
                (1, end, true)
            } else {
                let end = uid_next.saturating_sub(1);
                (last_uid + 1, end, false)
            };

            if start_uid > end_uid {
                log::info!("No new messages (start_uid > end_uid).");
                return Ok(0);
            }

            let range = format!("{}:{}", start_uid, end_uid);
            
            if is_bootstrap {
                log::info!("Bootstrap sync interval: {}", range);
            } else {
                log::info!("Fetching interval: {}", range);
            }

            // --- DEFENSIVE RE-SELECT ---
            // Explicitly re-selecting INBOX immediately prior to fetch.
            // Even if the session was recently selected, forcing a re-select right before fetching
            // refreshes mailbox state and clears any potential IMAP protocol staleness or zombie caching.
            let _ = session.select("INBOX").map_err(|e| format!("IMAP Re-Select Error: {}", e))?;

            let fetch_results = session.uid_fetch(
                &range,
                "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])"
            ).map_err(|e| format!("IMAP Fetch Error: {}", e))?;

            let mut messages = Vec::new();
            for msg in fetch_results.iter() {
                if let Some(header) = parse_header_to_message(msg, server_validity) {
                    messages.push(header);
                }
            }

            let num_new = messages.len() as u32;

            // --- SUSPICIOUS ZERO-SYNC DETECTION ---
            // If the server reported a higher UIDNEXT but our exact sequence range fetch returned 0 messages,
            // we treat this as a stale state indicator. Returning an error forces system recovery/reconnect.
            if num_new == 0 && (last_uid + 1) < uid_next {
                log::warn!(
                    "Suspicious zero-sync detected! Expected messages in range {}, but got 0. Forcing session discard.",
                    range
                );
                return Err("Suspicious zero-sync detected".to_string());
            }

            log::info!("Grabbed {} new messages!", num_new);
            database::insert_or_update_messages(&app_handle_clone, &messages)?;

            if num_new > 0 {
                use tauri::Emitter;
                if let Err(e) = app_handle_clone.emit("mail:updated", ()) {
                    log::error!("Failed to emit mail:updated event: {}", e);
                }
            }


            Ok(num_new)
        })();

        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    // Enqueue top 10 most recent UIDs for prefetching immediately after sync
    let uids = database::get_unfetched_recent_uids(app_handle, "INBOX", 10).unwrap_or_default();
    
    for uid in uids {
        let pf_app = app_handle.clone();
        let pf_acc = account.clone();
        tokio::spawn(async move {
            prefetch::enqueue_prefetch(pf_app, pf_acc, uid).await;
        });
    }

    new_messages_count
}

fn parse_header_to_message(msg: &imap::types::Fetch, server_validity: u32) -> Option<MessageHeader> {
    let actual_uid = msg.uid?;
    let body = msg.header()?;

    let seen = msg.flags().iter().any(|f| matches!(f, imap::types::Flag::Seen));
    let flagged = msg.flags().iter().any(|f| matches!(f, imap::types::Flag::Flagged));

    let parsed = parse_mail(body).ok()?;
    
    let mut subject = String::new();
    let mut from = String::new();
    let mut date = String::new();

    for header in parsed.get_headers() {
        let key = header.get_key().to_lowercase();
        let val = header.get_value();

        match key.as_str() {
            "subject" => subject = val,
            "from" => from = val,
            "date" => date = val,
            _ => {}
        }
    }

    let timestamp = chrono::DateTime::parse_from_rfc2822(&date)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);

    // Minimal text parsing overhead on sync fetch
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

    Some(MessageHeader {
        folder: "INBOX".to_string(),
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
    })
}
