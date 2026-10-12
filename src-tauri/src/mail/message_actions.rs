use crate::auth::account::{Account, MailProvider};
use crate::mail::{database, folder::MailFolder, imap_session::{execute_with_session, SessionKind}};
use std::str::FromStr;
use tauri::AppHandle;

fn resolve_mailbox(app: &AppHandle, account: &Account, folder: &str) -> Result<String, String> {
    match MailFolder::from_str(folder) {
        Ok(MailFolder::Inbox) => Ok("INBOX".to_string()),
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

async fn execute_remote_action(account: &Account, item: &database::PendingMessageAction) -> Result<(), String> {
    let uid = item.uid;
    let mailbox = item.mailbox.clone();
    let provider = account.provider.clone();
    let action = item.action.clone();
    let desired = item.desired;
    execute_with_session(account, SessionKind::Primary, move |session| {
        session.select(&mailbox).map_err(|e| format!("Could not select mailbox '{}': {}", mailbox, e))?;
        match action.as_str() {
            "seen" | "flagged" => {
                let command = flag_store_command(&action, desired)?;
                session.uid_store(uid.to_string(), command)
                    .map_err(|e| format!("IMAP rejected {} update for UID {} in '{}': {}", action, uid, mailbox, e))?;
                Ok(())
            }
            "delete" => {
                let trash = trash_mailbox(&provider);
                match session.uid_mv(uid.to_string(), trash) {
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

#[cfg(test)]
mod tests {
    use super::*;

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

fn apply_local_action(app: &AppHandle, item: &database::PendingMessageAction) -> Result<(), String> {
    match item.action.as_str() {
        "seen" => database::set_message_seen(app, &item.account_id, &item.folder, item.uid,
            item.desired.ok_or_else(|| "Missing read state".to_string())?),
        "flagged" => database::set_message_flagged(app, &item.account_id, &item.folder, item.uid,
            item.desired.ok_or_else(|| "Missing star state".to_string())?),
        "delete" => database::delete_message_local(app, &item.account_id, &item.folder, item.uid),
        other => Err(format!("Unsupported pending message action: {}", other)),
    }
}

pub async fn perform(app: &AppHandle, account: &Account, folder: &str, uid: u32, action: &str, desired: Option<bool>) -> Result<(), String> {
    let mailbox = resolve_mailbox(app, account, folder)?;
    let id = database::enqueue_message_action(app, &account.id, folder, &mailbox, uid, action, desired)?;
    let item = database::PendingMessageAction {
        id, account_id: account.id.clone(), folder: folder.to_string(), mailbox, uid,
        action: action.to_string(), desired,
    };

    if let Err(remote_error) = execute_remote_action(account, &item).await {
        let _ = database::record_message_action_error(app, id, &remote_error);
        log::warn!("Queued {} action {} for account {} (UID {}): {}", action, id, account.id, uid, remote_error);
        return Err(format!("Provider did not confirm the {} operation; it is queued for retry: {}", action, remote_error));
    }
    if let Err(local_error) = apply_local_action(app, &item) {
        let _ = database::record_message_action_error(app, id, &local_error);
        return Err(format!("Provider accepted the operation, but the local cache update failed; it is queued for repair: {}", local_error));
    }
    database::complete_message_action(app, id)?;
    Ok(())
}

/// Retry a bounded batch during normal folder synchronization. The operation is idempotent,
/// and each row is retained until both provider and local-cache updates have completed.
pub async fn retry_pending(app: &AppHandle, account: &Account) {
    let items = match database::list_pending_message_actions(app, &account.id, 50) {
        Ok(items) => items,
        Err(error) => {
            log::error!("Could not load pending message actions for account {}: {}", account.id, error);
            return;
        }
    };
    for item in items {
        let result = async {
            execute_remote_action(account, &item).await?;
            apply_local_action(app, &item)?;
            database::complete_message_action(app, item.id)
        }.await;
        if let Err(error) = result {
            let _ = database::record_message_action_error(app, item.id, &error);
            log::warn!("Pending message action {} for account {} remains queued: {}", item.id, account.id, error);
        } else {
            log::info!("Reconciled pending message action {} for account {}", item.id, account.id);
            use tauri::Emitter;
            let _ = app.emit("mail:updated", &item.folder);
            crate::tray_state::refresh_unread_count_from_db(app);
        }
    }
}
