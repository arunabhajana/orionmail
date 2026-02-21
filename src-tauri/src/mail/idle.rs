use crate::auth::account::Account;
use crate::mail::sync::{is_sync_running, sync_inbox};
use crate::auth::bootstrap::bootstrap_accounts;
use tauri::AppHandle;

use std::sync::Mutex;
use std::time::Duration;
use once_cell::sync::Lazy;

use tokio::task::JoinHandle;
use tokio::sync::mpsc;

use native_tls::TlsConnector;

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

            if is_sync_running() {
                log::info!("IMAP IDLE: Sync already running. Skipping.");
                continue;
            }

            log::info!("IMAP IDLE: Triggering auto-sync...");

            if let Err(e) = sync_inbox(&app_clone, account_clone.clone()).await {
                log::error!("IMAP IDLE: Auto-sync failed: {}", e);
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
            match run_idle_loop(&app_idle, &account_idle, tx.clone(), last_exists).await {
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

                    tokio::time::sleep(Duration::from_secs(backoff)).await;
                    backoff = (backoff * 2).min(60);
                }
            }
        }
    });

    *idle_lock = Some(idle_handle);
}

async fn run_idle_loop(
    app_handle: &AppHandle,
    account: &Account,
    tx: mpsc::Sender<u32>,
    mut last_exists: u32,
) -> Result<u32, String> {

    // Refresh tokens if needed
    bootstrap_accounts(app_handle).await;

    let current_account = crate::auth::session::get_active_account(app_handle)
        .ok_or("No active account found")?;

    let email = current_account.email;
    let access_token = current_account.access_token;

    tokio::task::spawn_blocking(move || {

        // ===============================
        // Connect
        // ===============================
        let tls = TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS Error: {}", e))?;

        let client = imap::connect(("imap.gmail.com", 993), "imap.gmail.com", &tls)
            .map_err(|e| format!("Connect Error: {}", e))?;

        let auth_raw = format!("user={}\x01auth=Bearer {}\x01\x01", email, access_token);

        struct XoAuth2 {
            auth_string: String,
        }

        impl imap::Authenticator for XoAuth2 {
            type Response = String;

            fn process(&self, _: &[u8]) -> Self::Response {
                self.auth_string.clone()
            }
        }

        let auth = XoAuth2 { auth_string: auth_raw };

        let mut session = client
            .authenticate("XOAUTH2", &auth)
            .map_err(|(e, _)| format!("Auth Error: {}", e))?;

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
            log::info!("IMAP IDLE: Waiting for changes...");
            let outcome = session
                .idle()
                .map_err(|e| format!("IDLE Start Error: {}", e))?
                .wait_with_timeout(Duration::from_secs(15 * 60))
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
                    log::info!("IMAP IDLE: 15-minute refresh timeout reached. Renewing IDLE.");
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn stop_idle_listener() {
    if let Some(handle) = IDLE_TASK.lock().unwrap().take() {
        log::info!("IMAP IDLE: Stopping listener task.");
        handle.abort();
    }

    if let Some(handle) = COORDINATOR_TASK.lock().unwrap().take() {
        log::info!("IMAP IDLE: Stopping coordinator task.");
        handle.abort();
    }
}