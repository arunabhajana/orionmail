use crate::auth::account::Account;
use tauri::AppHandle;
use std::{sync::Mutex, time::Duration, collections::HashMap};
use once_cell::sync::Lazy;
use tokio::{task::JoinHandle, sync::mpsc};
use tokio_util::sync::CancellationToken;

struct IdleTasks {
    listener: JoinHandle<()>,
    coordinator: JoinHandle<()>,
    cancel: CancellationToken,
}
static TASKS: Lazy<Mutex<HashMap<String, IdleTasks>>> = Lazy::new(Default::default);

pub fn start_idle_listener(app: AppHandle, account: Account) {
    let mut tasks = TASKS.lock().unwrap();
    if tasks.get(&account.id).is_some_and(|tasks| !tasks.listener.is_finished()) { return; }
    if let Some(old) = tasks.remove(&account.id) { old.cancel.cancel(); old.coordinator.abort(); }
    let cancel = crate::mail::shutdown::IDLE_TOKEN.child_token();
    let (tx, mut rx) = mpsc::channel::<u32>(1);
    let coordinator_app = app.clone();
    let coordinator_account = account.clone();
    let coordinator_cancel = cancel.clone();
    let coordinator = tokio::spawn(async move {
        loop {
            tokio::select! {
                value = rx.recv() => {
                    if value.is_none() { break; }
                    while rx.try_recv().is_ok() {}
                    crate::mail::sync_manager::enqueue_sync(coordinator_app.clone(), coordinator_account.clone(), crate::mail::folder::MailFolder::Inbox).await;
                    let _ = crate::mail::database::update_global_idle_time(&coordinator_app, &coordinator_account.id, chrono::Utc::now().timestamp());
                }
                _ = coordinator_cancel.cancelled() => break,
            }
        }
    });
    let id = account.id.clone();
    let listener_cancel = cancel.clone();
    let listener = tokio::spawn(async move {
        let mut last_exists = 0;
        let mut backoff = 2;
        while !listener_cancel.is_cancelled() {
            match run_idle_loop(&app, &account, tx.clone(), last_exists, listener_cancel.clone()).await {
                Ok(count) => { last_exists = count; backoff = 2; }
                Err(error) => {
                    if listener_cancel.is_cancelled() { break; }
                    log::warn!("IMAP IDLE failed; reconnecting in {}s: {}", backoff, error);
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(backoff)) => { backoff = (backoff * 2).min(60); }
                        _ = listener_cancel.cancelled() => break,
                    }
                }
            }
        }
    });
    tasks.insert(id, IdleTasks { listener, coordinator, cancel });
}

pub fn stop_account(account_id: &str) {
    if let Some(tasks) = TASKS.lock().unwrap().remove(account_id) {
        tasks.cancel.cancel();
        tasks.coordinator.abort();
        // Listener owns and joins its blocking network worker after closing TCP.
    }
}

async fn run_idle_loop(
    app_handle: &AppHandle,
    account: &Account,
    tx: mpsc::Sender<u32>,
    mut last_exists: u32,
    cancel: CancellationToken,
) -> Result<u32, String> {

    let current_account = crate::auth::bootstrap::ensure_account(app_handle, &account.id).await
        .map_err(|_| "No active account found or token refresh failed")?;

    let current_account_clone = current_account.clone();

    let worker_cancel = cancel.clone();
    let (socket_tx, socket_rx) = tokio::sync::oneshot::channel();
    let worker = tokio::task::spawn_blocking(move || {

        // ===============================
        // Connect
        // ===============================
        let (mut session, transport) = crate::mail::imap_session::connect_with_transport(&current_account_clone, crate::mail::imap_session::SessionKind::Idle)?;
        let _ = socket_tx.send(transport);
        if worker_cancel.is_cancelled() { return Ok(last_exists); }

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
            if worker_cancel.is_cancelled() {
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
                    
                    while let Ok(response) = session.unsolicited_responses.try_recv() {
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

                    // Always notify coordinator of a change just to be safe.
                    // The coordinator limits rapid-fire syncs and delegates to `sync_inbox`.
                    log::info!("IMAP IDLE: Signalling UI/Backend sync.");
                    let _ = tx.try_send(last_exists);
                }

                imap::extensions::idle::WaitOutcome::TimedOut => {
                    log::info!("IMAP IDLE: 5-minute refresh timeout reached. Renewing IDLE state.");
                }
            }
        }
    });
    match socket_rx.await {
        Ok(socket) => finish_idle_worker(worker, socket, cancel).await,
        Err(_) => worker.await.map_err(|e|e.to_string())?,
    }
}

async fn finish_idle_worker(mut worker: JoinHandle<Result<u32,String>>, socket: std::net::TcpStream, cancel: CancellationToken) -> Result<u32,String> {
    tokio::select! {
            result = &mut worker => result.map_err(|e| e.to_string())?,
            _ = cancel.cancelled() => {
                let _ = socket.shutdown(std::net::Shutdown::Both);
                worker.await.map_err(|e| e.to_string())?
            }
    }
}





#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancel_interrupts_blocking_idle_and_joins_worker() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut socket = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_peer,_) = listener.accept().unwrap();
        let transport = socket.try_clone().unwrap();
        let worker = tokio::task::spawn_blocking(move || {
            let _ = socket.read(&mut [0]);
            Ok(42)
        });
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = tokio::time::timeout(Duration::from_secs(3),finish_idle_worker(worker,transport,cancel)).await.unwrap();
        assert_eq!(result.unwrap(),42);
    }
}
