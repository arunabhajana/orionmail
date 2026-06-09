use crate::auth::account::Account;
use crate::mail::sync::sync_inbox;
use tauri::AppHandle;

use std::sync::Mutex;
use std::time::Duration;
use once_cell::sync::Lazy;

use tokio::task::JoinHandle;
use tokio::sync::mpsc;



static IDLE_TASK: Lazy<Mutex<Option<JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(None));

static COORDINATOR_TASK: Lazy<Mutex<Option<JoinHandle<()>>>> =
    Lazy::new(|| Mutex::new(None));

pub fn start_idle_listener(app_handle: AppHandle, account: Account) {
    let mut idle_lock = IDLE_TASK.lock().unwrap();

    if idle_lock.is_some() {
        log::info!("IMAP IDLE: Listener already running.");
        return;
    }

    let (tx, mut rx) = mpsc::channel::<u32>(32);

    let app_clone = app_handle.clone();
    let account_clone = account.clone();

    // ==========================================
    // COORDINATOR TASK
    // ==========================================
    let coordinator = tokio::spawn(async move {
        log::info!("IMAP IDLE: Coordinator started.");

        while let Some(_) = rx.recv().await {
            // Collapse rapid-fire EXISTS signals
            while rx.try_recv().is_ok() {}

            let guard = crate::mail::sync::SYNC_LOCK.try_lock();
            if guard.is_err() {
                log::info!("IMAP IDLE: Sync already running. Skipping auto-sync.");
                continue;
            }
            
            if crate::mail::shutdown::IDLE_TOKEN.is_cancelled() {
                break;
            }
            let _sync_guard = guard.unwrap();

            log::info!("IMAP IDLE: Triggering auto-sync...");

            match sync_inbox(&app_clone, account_clone.clone()).await {
                Ok(_) => {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
                    let _ = crate::mail::database::update_global_idle_time(&app_clone, now);
                }
                Err(e) => {
                    log::error!("IMAP IDLE: Auto-sync failed: {}", e);
                }
            }
        }

        log::info!("IMAP IDLE: Coordinator exiting.");
    });

    *COORDINATOR_TASK.lock().unwrap() = Some(coordinator);

    // ==========================================
    // IDLE LISTENER TASK
    // ==========================================
    let app_idle = app_handle.clone();
    let account_idle = account.clone();

    let idle_handle = tokio::spawn(async move {
        log::info!("IMAP IDLE: Listener spawned.");

        let mut last_exists: u32 = 0;
        let mut backoff: u64 = 2;

        loop {
            tokio::select! {
                res = run_idle_loop(&app_idle, &account_idle, tx.clone(), last_exists) => {
                    match res {
                        Ok(updated_count) => {
                            last_exists = updated_count;
                            backoff = 2;
                        }
                        Err(e) => {
                            log::error!(
                                "IMAP IDLE error: {}. Reconnecting in {} seconds...",
                                e,
                                backoff
                            );

                            tokio::select! {
                                _ = tokio::time::sleep(Duration::from_secs(backoff)) => {
                                    backoff = (backoff * 2).min(60);
                                }
                                _ = crate::mail::shutdown::IDLE_TOKEN.cancelled() => {
                                    log::info!("IMAP IDLE: Shutdown received during backoff.");
                                    break;
                                }
                            }
                        }
                    }
                }
                _ = crate::mail::shutdown::IDLE_TOKEN.cancelled() => {
                    log::info!("IMAP IDLE: Shutdown received, aborting idle connection.");
                    break;
                }
            }
        }
    });

    *idle_lock = Some(idle_handle);
}

async fn run_idle_loop(
    app_handle: &AppHandle,
    _account: &Account,
    tx: mpsc::Sender<u32>,
    mut last_exists: u32,
) -> Result<u32, String> {

    let current_account = crate::auth::bootstrap::ensure_active_account(app_handle).await
        .map_err(|_| "No active account found or token refresh failed")?;

    let current_account_clone = current_account.clone();

    tokio::task::spawn_blocking(move || {

        // ===============================
        // Connect
        // ===============================
        let session_wrapper = match crate::mail::imap_session::create_session(&current_account_clone, crate::mail::imap_session::SessionKind::Idle) {
            Ok(s) => s,
            Err(e) => return Err(format!("IMAP Connection Error: {}", e)),
        };
        let mut session = session_wrapper.session;

        let mailbox = session
            .select("INBOX")
            .map_err(|e| format!("Select Error: {}", e))?;

        // Only initialize once
        if last_exists == 0 {
            last_exists = mailbox.exists;
        }

        log::info!(
            "IMAP IDLE: Initialized. Current EXISTS count: {}",
            last_exists
        );

        // ===============================
        // IDLE Loop
        // ===============================
        loop {
            if crate::mail::shutdown::IDLE_TOKEN.is_cancelled() {
                log::info!("IMAP IDLE: Shutdown requested, exiting idle loop.");
                let _ = session.logout();
                return Ok(last_exists);
            }

            // Explicitly test connection health before blocking
            if let Err(e) = session.noop() {
                log::warn!("IMAP IDLE pre-check failed. Connection likely dead: {}", e);
                return Err("IDLE Pre-check NOOP failed".to_string());
            }

            log::info!("IMAP IDLE: Waiting for changes...");
            // Reduced timeout from 15 mins to 5 mins to quickly detect silent network drops
            let outcome = session
                .idle()
                .map_err(|e| format!("IDLE Start Error: {}", e))?
                .wait_with_timeout(Duration::from_secs(5 * 60))
                .map_err(|e| format!("IDLE Wait Error: {}", e))?;

            match outcome {
                imap::extensions::idle::WaitOutcome::MailboxChanged => {
                    log::info!("IMAP IDLE: MailboxChanged event received.");
                    
                    loop {
                        match session.unsolicited_responses.try_recv() {
                            Ok(response) => {
                                log::debug!("IMAP IDLE: Unsolicited response: {:?}", response);
                                match response {
                                    imap::types::UnsolicitedResponse::Exists(count) => {
                                        if count > last_exists {
                                            log::info!("IMAP IDLE: New mail detected (EXISTS {} > {}).", count, last_exists);
                                        } else if count < last_exists {
                                            log::info!("IMAP IDLE: Mail removed (EXISTS {} < {}).", count, last_exists);
                                        }
                                        last_exists = count;
                                    }
                                    imap::types::UnsolicitedResponse::Recent(count) => {
                                        log::info!("IMAP IDLE: RECENT count is now {}.", count);
                                    }
                                    imap::types::UnsolicitedResponse::Expunge(id) => {
                                        log::info!("IMAP IDLE: EXPUNGE received for ID {}.", id);
                                        last_exists = last_exists.saturating_sub(1);
                                    }
                                    _ => {}
                                }
                            }
                            Err(_) => break, // No more responses queued
                        }
                    }

                    // Always notify coordinator of a change just to be safe.
                    // The coordinator limits rapid-fire syncs and delegates to `sync_inbox`.
                    log::info!("IMAP IDLE: Signalling UI/Backend sync.");
                    let _ = tx.blocking_send(last_exists);
                }

                imap::extensions::idle::WaitOutcome::TimedOut => {
                    log::info!("IMAP IDLE: 5-minute refresh timeout reached. Renewing IDLE state.");
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn stop_idle_listener() {
    // Actually we don't strictly need to abort manually anymore because 
    // SHUTDOWN_TOKEN handles it gracefully, but we can keep it as a fallback.
    // However, the caller now calls trigger_shutdown() instead of this.
}