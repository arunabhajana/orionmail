use crate::{auth::account::Account, mail::folder::MailFolder};
use futures::FutureExt;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

#[derive(Default)]
struct Request {
    force: bool,
    dirty: bool,
}
static SYNC_QUEUE: Lazy<Mutex<HashMap<(String, MailFolder), Request>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
pub static SYNC_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn should_skip_for_interval(elapsed: i64, minimum: i64, previous_error: bool, force: bool) -> bool {
    !force && !previous_error && elapsed < minimum
}

pub async fn enqueue_sync(app: AppHandle, account: Account, folder: MailFolder) {
    enqueue_sync_with_force(app, account, folder, false).await;
}

pub async fn enqueue_sync_with_force(
    app: AppHandle,
    account: Account,
    folder: MailFolder,
    force: bool,
) {
    if !force && crate::mail_preferences::load(&app).sync_paused { return; }
    let key = (account.id.clone(), folder.clone());
    {
        let mut queue = SYNC_QUEUE.lock().await;
        if let Some(request) = queue.get_mut(&key) {
            request.dirty = true;
            request.force |= force;
            return;
        }
        queue.insert(
            key.clone(),
            Request {
                force,
                dirty: false,
            },
        );
    }
    tokio::spawn(async move {
        let mut follow_up = false;
        loop {
            let guard = SYNC_LOCK.lock().await;
            let force = {
                let mut queue = SYNC_QUEUE.lock().await;
                let Some(request) = queue.get_mut(&key) else {
                    return;
                };
                request.dirty = false;
                std::mem::take(&mut request.force)
            };
            if (!force && crate::mail_preferences::load(&app).sync_paused) || crate::auth::app_lock::require_unlocked(&app).is_err() {
                SYNC_QUEUE.lock().await.remove(&key);
                return;
            }
            let state = crate::mail::database::get_folder_sync_state(
                &app,
                &account.id,
                &folder.to_string(),
            )
            .unwrap_or(None)
            .unwrap_or_default();
            let minimum = match folder {
                MailFolder::Inbox => 30,
                MailFolder::Sent => 300,
                MailFolder::Starred => 0,
                MailFolder::Tag(_) => 60,
            };
            let now = chrono::Utc::now().timestamp();
            if !should_skip_for_interval(
                now - state.last_synced_at,
                minimum,
                state.last_error.is_some(),
                force || follow_up,
            ) {
                let _ = app.emit("mail:sync_started", folder.to_string());
                let result =
                    std::panic::AssertUnwindSafe(crate::mail::sync::sync_folder_with_options(
                        &app,
                        account.clone(),
                        folder.clone(),
                        force,
                    ))
                    .catch_unwind()
                    .await
                    .unwrap_or_else(|_| Err("Unexpected sync failure; please retry".into()));
                if let Err(error) = result {
                    log::error!("Sync failed for folder {}: {}", folder, error);
                    let _ = crate::mail::database::set_folder_sync_error(
                        &app,
                        &account.id,
                        &folder.to_string(),
                        &error,
                    );
                    let _ = app.emit(
                        "mail:sync_error",
                        serde_json::json!({"folder":folder.to_string(),"error":error}),
                    );
                }
                let _ = app.emit("mail:sync_finished", folder.to_string());
            }
            let rerun = {
                let mut queue = SYNC_QUEUE.lock().await;
                if queue.get(&key).is_some_and(|request| request.dirty) {
                    true
                } else {
                    queue.remove(&key);
                    false
                }
            };
            drop(guard);
            follow_up = rerun;
            if !rerun {
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_sync_and_manual_refresh_bypass_throttle() {
        assert!(!should_skip_for_interval(5, 30, true, false));
        assert!(!should_skip_for_interval(5, 30, false, true));
        assert!(should_skip_for_interval(5, 30, false, false));
        assert!(!should_skip_for_interval(30, 30, false, false));
    }
}
