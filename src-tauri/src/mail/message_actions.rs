use crate::auth::account::{Account, MailProvider};
// Serializes reconciliation snapshots with provider/local message mutations.
pub static MUTATION_LOCK: once_cell::sync::Lazy<tokio::sync::Mutex<()>> = once_cell::sync::Lazy::new(|| tokio::sync::Mutex::new(()));
use crate::mail::{database, folder::MailFolder, imap_session::{execute_with_session, SessionKind}};
use std::str::FromStr;
use tauri::AppHandle;

pub(crate) fn resolve_mailbox(app: &AppHandle, account: &Account, folder: &str) -> Result<String, String> {
    match MailFolder::from_str(folder) {
        Ok(MailFolder::Inbox) => Ok("INBOX".to_string()),
        Ok(MailFolder::Trash) => Ok(crate::mail::trash::mailbox(app, account)),
        Ok(MailFolder::Sent) => MailFolder::Sent.to_imap_mailbox(&account.provider)
            .map(str::to_string).ok_or_else(|| "Sent mailbox is not configured".to_string()),
        Ok(MailFolder::Tag(tag_id)) => {
            let tags = database::get_all_tags(app, &account.id)?;
            let tag = tags.iter().find(|tag| tag.id == tag_id)
                .ok_or_else(|| format!("Tag {} is unavailable; refresh labels and retry", tag_id))?;
            if !tag.provider.eq_ignore_ascii_case(match &account.provider {
                MailProvider::Google => "google",
                MailProvider::Outlook => "outlook",
                MailProvider::Custom { .. } => "custom",
            }) {
                return Err("Tag belongs to a different provider".to_string());
            }
            Ok(tag.name.clone())
        }
        Ok(MailFolder::Starred) => Err("Starred is a virtual folder; use the message's source folder".to_string()),
        Err(_) => {
            // Real provider mailboxes are represented by their normalized mailbox name in cache.
            // Reject controls and unreasonable names before passing them to the IMAP client.
            if folder.is_empty() || folder.len() > 255 || folder.chars().any(char::is_control) {
                return Err("Invalid mailbox name".to_string());
            }
            Ok(folder.to_string())
        }
    }
}

#[cfg(test)]
fn trash_mailbox(provider: &MailProvider) -> &'static str {
    match provider {
        MailProvider::Google => "[Gmail]/Trash",
        MailProvider::Outlook => "Deleted Items",
        MailProvider::Custom { .. } => "Trash",
    }
}

fn flag_store_command(action: &str, desired: Option<bool>) -> Result<String, String> {
    let enabled = desired.ok_or_else(|| format!("Missing value for pending {} action", action))?;
    let flag = match action {
        "seen" => "Seen",
        "flagged" => "Flagged",
        _ => return Err(format!("Unsupported flag action: {}", action)),
    };
    let sign = if enabled { "+" } else { "-" };
    Ok(format!("{}FLAGS.SILENT (\\{})", sign, flag))
}

async fn execute_remote_action(app: &AppHandle, account: &Account, item: &database::PendingMessageAction) -> Result<(), String> {
    let uid = item.uid;
    let mailbox = item.mailbox.clone();
    let provider = account.provider.clone();
    let action = item.action.clone();
    let desired = item.desired;
    let uid_validity = item.uid_validity;
    let app = app.clone();
    let account_copy = account.clone();
    execute_with_session(account, SessionKind::Primary, move |session| {
        let selected = session.select(&mailbox).map_err(|e| format!("Could not select mailbox '{}': {}", mailbox, e))?;
        validate_uid_validity(uid_validity, selected.uid_validity)?;
        if !session.uid_search(format!("UID {uid}")).map_err(|e| e.to_string())?.contains(&uid) {
            return if action == "delete" { Ok(()) } else { Err("CONFLICT: Message was removed at the provider".into()) };
        }
        match action.as_str() {
            "seen" | "flagged" => {
                let command = flag_store_command(&action, desired)?;
                session.uid_store(uid.to_string(), command)
                    .map_err(|e| format!("IMAP rejected {} update for UID {} in '{}': {}", action, uid, mailbox, e))?;
                Ok(())
            }
            "delete" => {
                let trash = crate::mail::trash::discover(&app, &account_copy, session)?;
                match session.uid_mv(uid.to_string(), &trash) {
                    Ok(_) => Ok(()),
                    Err(move_error) if matches!(provider, MailProvider::Google) => {
                        // Gmail's label operation is an idempotent MOVE-to-Trash fallback.
                        // Do not report success unless the provider accepts it.
                        session.uid_store(uid.to_string(), "+X-GM-LABELS (\\Trash)")
                            .map_err(|fallback| format!(
                                "IMAP MOVE to Trash failed ({}); Gmail Trash-label fallback failed: {}",
                                move_error, fallback
                            ))?;
                        Ok(())
                    }
                    Err(e) => Err(format!("IMAP MOVE to '{}' failed for UID {} in '{}': {}", trash, uid, mailbox, e)),
                }
            }
            other => Err(format!("Unsupported pending message action: {}", other)),
        }
    }).await
}

fn validate_uid_validity(expected: Option<u32>, actual: Option<u32>) -> Result<(), String> {
    if expected.is_none() || expected == Some(0) || expected != actual {
        Err("CONFLICT: Mailbox UIDVALIDITY changed; this action cannot safely be retried".into())
    } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_action_cannot_target_a_reused_uid_after_epoch_change() {
        assert!(validate_uid_validity(Some(9), Some(9)).is_ok());
        assert!(validate_uid_validity(Some(9), Some(10)).is_err());
        assert!(validate_uid_validity(None, Some(9)).is_err());
        assert!(validate_uid_validity(Some(0), Some(0)).is_err());
    }

    #[test]
    fn read_and_star_actions_set_or_clear_the_provider_flag_idempotently() {
        assert_eq!(flag_store_command("seen", Some(true)).unwrap(), "+FLAGS.SILENT (\\Seen)");
        assert_eq!(flag_store_command("seen", Some(false)).unwrap(), "-FLAGS.SILENT (\\Seen)");
        assert_eq!(flag_store_command("flagged", Some(true)).unwrap(), "+FLAGS.SILENT (\\Flagged)");
        assert_eq!(flag_store_command("flagged", Some(false)).unwrap(), "-FLAGS.SILENT (\\Flagged)");
        assert!(flag_store_command("seen", None).is_err());
    }

    #[test]
    fn trash_destination_is_provider_specific() {
        assert_eq!(trash_mailbox(&MailProvider::Google), "[Gmail]/Trash");
        assert_eq!(trash_mailbox(&MailProvider::Outlook), "Deleted Items");
        let custom = MailProvider::Custom {
            imap: crate::auth::account::ImapConfig { host: "imap.example.test".into(), port: 993, tls: true },
            smtp: crate::auth::account::SmtpConfig { host: "smtp.example.test".into(), port: 587, starttls: true },
        };
        assert_eq!(trash_mailbox(&custom), "Trash");
    }
}

fn apply_local_action(app: &AppHandle, item: &database::PendingMessageAction, provider: &MailProvider) -> Result<(), String> {
    if matches!(provider,MailProvider::Google){
        return crate::mail::tags::cache::apply_message_action(app,&item.account_id,&item.folder,item.uid,item.uid_validity.ok_or("Missing mailbox identity")?,&item.action,item.desired);
    }
    match item.action.as_str() {
        "seen" => database::set_message_seen(app, &item.account_id, &item.folder, item.uid,
            item.desired.ok_or_else(|| "Missing read state".to_string())?),
        "flagged" => database::set_message_flagged(app, &item.account_id, &item.folder, item.uid,
            item.desired.ok_or_else(|| "Missing star state".to_string())?),
        "delete" => database::delete_message_local(app, &item.account_id, &item.folder, item.uid),
        other => Err(format!("Unsupported pending message action: {}", other)),
    }
}

fn notify_action_applied(app: &AppHandle, item: &database::PendingMessageAction) {
    if matches!(item.action.as_str(),"seen"|"delete"){
        crate::mail::notifications::schedule_refresh(app, &item.account_id);
    }
    crate::mail::tags::assignment::LABEL_GENERATION.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
    use tauri::Emitter;
    let (flags, removed) = if item.action == "delete" {
        (Vec::<crate::mail::reconciliation::Flags>::new(), vec![item.uid])
    } else {
        let messages = database::get_messages_by_uids(app, &item.account_id, &item.folder, &[item.uid]).unwrap_or_default();
        (messages.into_iter().map(|message| crate::mail::reconciliation::Flags {
            uid: message.uid, seen: message.seen, flagged: message.flagged,
        }).collect(), Vec::<u32>::new())
    };
    // Also notify for queued replays: a merge-only list refresh cannot remove a
    // previously rolled-back delete or update an older loaded search result.
    let _ = app.emit("mail:reconciled", serde_json::json!({"account_id":item.account_id,"folder":item.folder,"updated_flags":flags,"removed_uids":removed}));
    let _ = app.emit("mail:updated", &item.folder);
    let _ = app.emit("mail:labels_changed", &item.account_id);
    crate::tray_state::refresh_unread_count_from_db(app);
}

pub async fn perform_for_location(app:&AppHandle,account:&Account,folder:&str,uid:u32,action:&str,desired:Option<bool>,expected:u32,local_id:Option<&str>)->Result<Option<crate::mail::trash::Pending>,String>{
    let _mutation=MUTATION_LOCK.lock().await;
    let (folder,uid,epoch)=crate::mail::trash::source(app,&account.id,local_id,folder,uid)?;
    perform_locked(app,account,&folder,uid,action,desired,epoch.unwrap_or(expected)).await?;
    crate::mail::trash::refresh_metadata(app,&account.id,&folder,uid,local_id)
}

async fn perform_locked(app:&AppHandle,account:&Account,folder:&str,uid:u32,action:&str,desired:Option<bool>,expected_uid_validity:u32)->Result<(),String>{
    let uid_validity = database::message_uid_validity(app, &account.id, folder, uid)?;
    validate_uid_validity(Some(expected_uid_validity),Some(uid_validity))?;
    let mailbox = resolve_mailbox(app, account, folder)?;
    let id = database::enqueue_message_action(app, &account.id, folder, &mailbox, uid, action, desired,matches!(account.provider,MailProvider::Google))?;
    let item = database::PendingMessageAction {
        id, account_id: account.id.clone(), folder: folder.to_string(), mailbox, uid,
        action: action.to_string(), desired, uid_validity: Some(uid_validity),
    };

    if let Err(remote_error) = execute_remote_action(app, account, &item).await {
        let _ = database::record_message_action_error(app, id, &remote_error);
        if remote_error.starts_with("CONFLICT:") { return Err(remote_error); }
        log::warn!("Queued {} action {} for account {} (UID {}): {}", action, id, account.id, uid, remote_error);
        return Err(format!("Provider did not confirm the {} operation; it is queued for retry: {}", action, remote_error));
    }
    if let Err(local_error) = apply_local_action(app, &item, &account.provider) {
        let _ = database::record_message_action_error(app, id, &local_error);
        return Err(format!("Provider accepted the operation, but the local cache update failed; it is queued for repair: {}", local_error));
    }
    database::complete_message_action(app, id)?;
    notify_action_applied(app, &item);
    Ok(())
}

/// Retry a bounded batch during normal folder synchronization. The operation is idempotent,
/// and each row is retained until both provider and local-cache updates have completed.
pub async fn retry_pending(app: &AppHandle, account: &Account) {
    let _mutation = MUTATION_LOCK.lock().await;
    let items = match database::list_pending_message_actions(app, &account.id, 50) {
        Ok(items) => items,
        Err(error) => {
            log::error!("Could not load pending message actions for account {}: {}", account.id, error);
            return;
        }
    };
    for item in items {
        let result = async {
            execute_remote_action(app, account, &item).await?;
            apply_local_action(app, &item, &account.provider)?;
            database::complete_message_action(app, item.id)
        }.await;
        if let Err(error) = result {
            let _ = database::record_message_action_error(app, item.id, &error);
            log::warn!("Pending message action {} for account {} remains queued: {}", item.id, account.id, error);
            if error.starts_with("CONFLICT:") {
                use tauri::Emitter;
                let _ = app.emit("mail:action_conflict", serde_json::json!({"account_id":account.id,"folder":item.folder,"uid":item.uid,"error":error}));
            } else {
                // A bulk notification action is persisted before delivery.
                // Avoid one network timeout per queued message while offline.
                break;
            }
        } else {
            log::info!("Reconciled pending message action {} for account {}", item.id, account.id);
            notify_action_applied(app, &item);
        }
    }
}
