use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::imap_session;
use tauri::AppHandle;
use mailparse::parse_mail;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static PREFETCH_RUNNING: AtomicBool = AtomicBool::new(false);

pub async fn get_message_body(app_handle: &AppHandle, account: Account, uid: u32) -> Result<String, String> {
    let app_handle_clone = app_handle.clone();
    let account_clone = account.clone();

    tokio::task::spawn_blocking(move || {
        // 1. Get the current mailbox validity to query cache properly
        let stored_validity = database::get_mailbox_validity(&app_handle_clone, "INBOX")
            .unwrap_or(None)
            .ok_or_else(|| "No stored mailbox validity. Resync required.".to_string())?;

        // 2. Check Cache
        if let Ok(Some(cached_body)) = database::get_message_body_cache(&app_handle_clone, uid, stored_validity) {
            return Ok(cached_body);
        }

        // 3. Connect to IMAP
        imap_session::execute_with_session(&account_clone, |session| {
            // 4. CRITICAL: Fetch ONLY the TEXT part
            let fetch_results = session.uid_fetch(
                uid.to_string(),
                "(BODY.PEEK[TEXT])"
            ).map_err(|e| format!("IMAP Body Fetch Error: {}", e))?;

            if let Some(msg) = fetch_results.iter().next() {
                if let Some(body_bytes) = msg.text() {
                    if let Ok(parsed) = parse_mail(body_bytes) {
                        let parsed_body = parsed.get_body().unwrap_or_else(|_| String::from_utf8_lossy(body_bytes).to_string());
                        
                        // 6. Cache the parsed text
                        database::update_message_body(&app_handle_clone, uid, stored_validity, &parsed_body)?;
                        return Ok(parsed_body);
                    } else {
                        let fallback_body = String::from_utf8_lossy(body_bytes).to_string();
                        database::update_message_body(&app_handle_clone, uid, stored_validity, &fallback_body)?;
                        return Ok(fallback_body);
                    }
                }
            }

            Err("Could not retrieve message body.".to_string())
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

pub async fn prefetch_recent_bodies(app_handle: AppHandle, account: Account) {
    if PREFETCH_RUNNING.swap(true, Ordering::SeqCst) {
        log::info!("Prefetch already running, skipping.");
        return;
    }

    struct PrefetchGuard;
    impl Drop for PrefetchGuard {
        fn drop(&mut self) {
            PREFETCH_RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _guard = PrefetchGuard;

    let uids = match database::get_unfetched_recent_uids(&app_handle, 10) {
        Ok(res) => res,
        Err(e) => {
            log::warn!("Prefetch query failed: {}", e);
            return;
        }
    };

    if uids.is_empty() {
        return;
    }

    log::info!("Starting background prefetch for {} emails.", uids.len());

    for (uid, uid_validity) in uids {
        // Double check cache in case user clicked it
        if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, uid, uid_validity) {
            continue;
        }

        log::info!("Prefetching body UID {}", uid);
        
        let _ = get_message_body(&app_handle, account.clone(), uid).await;
        
        // Let other tokio tasks run and avoid IMAP blasting throttle limits
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    log::info!("Finished background prefetch.");
}
