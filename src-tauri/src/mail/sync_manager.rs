use crate::{auth::account::Account, mail::folder::MailFolder};
use futures::FutureExt;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use std::{sync::Arc, time::Duration};

#[derive(Default)]
struct Request {
    force: bool,
    dirty: bool,
    wake: Arc<tokio::sync::Notify>,
}
static SYNC_QUEUE: Lazy<Mutex<HashMap<(String, MailFolder), Request>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
pub static SYNC_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub async fn remove_account(account_id: &str) {
    SYNC_QUEUE.lock().await.retain(|(id, _), request| {
        if id == account_id { request.wake.notify_one(); false } else { true }
    });
}

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
    if !force && crate::mail_preferences::load_for(&app, &account.id).sync_paused { return; }
    let key = (account.id.clone(), folder.clone());
    let wake = Arc::new(tokio::sync::Notify::new());
    {
        let mut queue = SYNC_QUEUE.lock().await;
        if let Some(request) = queue.get_mut(&key) {
            request.dirty = true;
            request.force |= force;
            request.wake.notify_one();
            return;
        }
        queue.insert(
            key.clone(),
            Request {
                force,
                dirty: false,
                wake: wake.clone(),
            },
        );
    }
    tokio::spawn(async move {
        let mut follow_up = false;
        let mut pass_duration = Duration::ZERO;
        loop {
            // Backfill has no timer while hidden. New mail/manual requests can
            // wake one pass, and showing the window resumes ordinary catch-up.
            if follow_up {
                tokio::select! {
                    _ = wake.notified() => {},
                    _ = async {
                        crate::window_activity::wait_until_displayed().await;
                        tokio::time::sleep(history_delay(pass_duration)).await;
                    } => {},
                    _ = crate::mail::shutdown::APP_TOKEN.cancelled() => {
                        SYNC_QUEUE.lock().await.remove(&key);
                        return;
                    }
                }
            }
            let mut continue_history = false;
            let guard = SYNC_LOCK.lock().await;
            let (force, history_only) = {
                let mut queue = SYNC_QUEUE.lock().await;
                let Some(request) = queue.get_mut(&key) else {
                    return;
                };
                let force = std::mem::take(&mut request.force);
                let history_only = follow_up && !force && !request.dirty;
                request.dirty = false;
                (force, history_only)
            };
            if (!force && crate::mail_preferences::load_for(&app, &account.id).sync_paused) || crate::auth::app_lock::require_unlocked(&app).is_err() {
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
                MailFolder::Trash => 30,
                MailFolder::Tag(_) => 60,
            };
            let now = chrono::Utc::now().timestamp();
            // Coalescing must delay a change notification, not discard it.
            // Otherwise mail arriving just after a sync waits until polling.
            if should_skip_for_interval(now - state.last_synced_at, minimum, state.last_error.is_some(), force || follow_up) {
                let delay = Duration::from_secs((minimum - (now - state.last_synced_at)).clamp(1, minimum.max(1)) as u64);
                drop(guard);
                tokio::select! {
                    _ = wake.notified() => {},
                    _ = tokio::time::sleep(delay) => {},
                    _ = crate::mail::shutdown::APP_TOKEN.cancelled() => {
                        SYNC_QUEUE.lock().await.remove(&key);
                        return;
                    }
                }
                continue;
            }
            if !should_skip_for_interval(
                now - state.last_synced_at,
                minimum,
                state.last_error.is_some(),
                force || follow_up,
            ) {
                let _ = app.emit("mail:sync_started", serde_json::json!({"account_id":account.id,"folder":folder.to_string()}));
                let started = std::time::Instant::now();
                let result =
                    std::panic::AssertUnwindSafe(crate::mail::sync::sync_folder_with_options(
                        &app,
                        account.clone(),
                        folder.clone(),
                        force,
                        history_only,
                    ))
                    .catch_unwind()
                    .await
                    .unwrap_or_else(|_| Err("Unexpected sync failure; please retry".into()));
                pass_duration = started.elapsed();
                log::debug!("[sync] folder={} pass_ms={} success={}", folder, pass_duration.as_millis(), result.is_ok());
                if result.is_ok() {
                    continue_history = crate::mail::database::get_folder_sync_state(
                        &app, &account.id, &folder.to_string(),
                    ).ok().flatten().is_some_and(|state| state.history_before_uid.unwrap_or(0) > 0);
                }
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
                        serde_json::json!({"account_id":account.id,"folder":folder.to_string(),"error":error}),
                    );
                }
                let _ = app.emit("mail:sync_finished", serde_json::json!({"account_id":account.id,"folder":folder.to_string()}));
            }
            let rerun = {
                let mut queue = SYNC_QUEUE.lock().await;
                if continue_history || queue.get(&key).is_some_and(|request| request.dirty) {
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

fn history_delay(previous_pass: Duration) -> Duration {
    (previous_pass / 4).clamp(Duration::from_millis(250), Duration::from_secs(2))
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
    #[test]
    fn backfill_pacing_is_bounded_for_fast_and_slow_passes() {
        assert_eq!(history_delay(Duration::ZERO), Duration::from_millis(250));
        assert_eq!(history_delay(Duration::from_secs(4)), Duration::from_secs(1));
        assert_eq!(history_delay(Duration::from_secs(120)), Duration::from_secs(2));
    }
}
