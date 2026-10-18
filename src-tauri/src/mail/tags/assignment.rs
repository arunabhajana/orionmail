use crate::auth::account::{Account, MailProvider};
use crate::mail::{
    database,
    imap_session::{execute_with_session, SessionKind},
    message_actions,
};
use base64::Engine;
use std::io::{Read, Write};
use std::sync::atomic::AtomicU64;
use tauri::AppHandle;

pub(crate) static LABEL_GENERATION: AtomicU64 = AtomicU64::new(0);

// Gmail IMAP labels use modified UTF-7. Only database-resolved names reach here.
pub(super) fn quote_label(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control) {
        return Err("Invalid label name".into());
    }
    let mut output = String::new();
    let mut bytes = Vec::new();
    let flush = |bytes: &mut Vec<u8>, output: &mut String| {
        if !bytes.is_empty() {
            output.push('&');
            output.push_str(
                &base64::engine::general_purpose::STANDARD_NO_PAD
                    .encode(&*bytes)
                    .replace('/', ","),
            );
            output.push('-');
            bytes.clear();
        }
    };
    for ch in name.chars() {
        if ch.is_ascii() {
            flush(&mut bytes, &mut output);
            if ch == '&' {
                output.push_str("&-");
            } else {
                output.push(ch);
            }
        } else {
            let mut units = [0; 2];
            for unit in ch.encode_utf16(&mut units) {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
        }
    }
    flush(&mut bytes, &mut output);
    Ok(format!(
        "\"{}\"",
        output.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

pub(super) fn fetch_memberships<T: Read + Write>(
    session: &mut imap::Session<T>,
    range: &str,
    labels: &[(String, String)],
) -> Result<Vec<(u32, Vec<String>)>, String> {
    if range.is_empty()
        || !range
            .chars()
            .all(|ch| ch.is_ascii_digit() || matches!(ch, ':' | ',' | '*'))
    {
        return Err("Invalid label sync UID range".into());
    }
    let uids = session
        .uid_search(format!("UID {range}"))
        .map_err(|e| format!("Could not scan label memberships: {e}"))?;
    let mut by_uid: std::collections::BTreeMap<u32, Vec<String>> =
        uids.into_iter().map(|uid| (uid, Vec::new())).collect();
    if by_uid.is_empty() {
        return Ok(Vec::new());
    }
    for (id, label) in labels {
        let found = session
            .uid_search(format!("UID {range} X-GM-LABELS {label}"))
            .map_err(|e| format!("Could not sync label memberships: {e}"))?;
        for uid in found {
            if let Some(tags) = by_uid.get_mut(&uid) {
                tags.push(id.clone());
            }
        }
    }
    Ok(by_uid.into_iter().collect())
}

fn store_labels<T: Read + Write>(
    session: &mut imap::Session<T>,
    uid: u32,
    labels: &[String],
) -> Result<(), String> {
    // SILENT avoids Gmail's extension FETCH response, which imap 2.4 cannot parse.
    session
        .run_command_and_check_ok(format!(
            "UID STORE {uid} +X-GM-LABELS.SILENT ({})",
            labels.join(" ")
        ))
        .map_err(|e| format!("Gmail could not add tags: {e}"))?;
    // A successful STORE can also target a UID which disappeared. Confirm that
    // this exact UID now has every requested label before committing locally.
    let criteria = labels
        .iter()
        .map(|label| format!("X-GM-LABELS {label}"))
        .collect::<Vec<_>>()
        .join(" ");
    let found = session
        .uid_search(format!("UID {uid} {criteria}"))
        .map_err(|e| format!("Could not verify Gmail tags: {e}"))?;
    if !found.contains(&uid) {
        return Err("Gmail did not confirm the tags. Sync the mailbox and try again.".into());
    }
    Ok(())
}

fn remove_labels<T: Read + Write>(
    session: &mut imap::Session<T>,
    uid: u32,
    labels: &[String],
) -> Result<(), String> {
    if !session
        .uid_search(format!("UID {uid}"))
        .map_err(|e| e.to_string())?
        .contains(&uid)
    {
        return Err("Message is no longer available. Refresh and retry.".into());
    }
    session
        .run_command_and_check_ok(format!(
            "UID STORE {uid} -X-GM-LABELS.SILENT ({})",
            labels.join(" ")
        ))
        .map_err(|e| format!("Gmail could not remove tags: {e}"))?;
    let any = labels
        .iter()
        .rev()
        .fold(None, |rest: Option<String>, label| {
            Some(match rest {
                Some(rest) => format!("OR X-GM-LABELS {label} {rest}"),
                None => format!("X-GM-LABELS {label}"),
            })
        })
        .unwrap_or_default();
    if session
        .uid_search(format!("UID {uid} {any}"))
        .map_err(|e| format!("Could not verify removed tags: {e}"))?
        .contains(&uid)
    {
        return Err("Gmail did not confirm the tag removal. Retry.".into());
    }
    Ok(())
}

pub async fn update(
    app: &AppHandle,
    account: &Account,
    folder: String,
    uid: u32,
    mut add_ids: Vec<String>,
    mut remove_ids: Vec<String>,
    expected_uid_validity: u32,
) -> Result<Vec<String>, String> {
    if !matches!(account.provider, MailProvider::Google) {
        return Err("Adding tags currently requires a Google account".into());
    }
    if uid == 0
        || (add_ids.is_empty() && remove_ids.is_empty())
        || add_ids.len() > 100
        || remove_ids.len() > 100
    {
        return Err("Choose up to 100 tags to add and remove".into());
    }
    add_ids.sort();
    add_ids.dedup();
    remove_ids.sort();
    remove_ids.dedup();
    if add_ids.iter().any(|id| remove_ids.contains(id)) {
        return Err("A tag cannot be added and removed together".into());
    }
    // Validate before recording renderer input. Delivery resolves names again,
    // so queued edits follow label renames without recreating deleted labels.
    let available = database::get_all_tags(app, &account.id)?;
    for id in add_ids.iter().chain(&remove_ids) {
        let tag = available
            .iter()
            .find(|t| &t.id == id && t.tag_type == "user" && t.provider == "google")
            .ok_or("A selected tag is no longer available. Refresh tags and retry.")?;
        quote_label(&tag.name)?;
    }
    let mailbox = message_actions::resolve_mailbox(app, account, &folder)?;
    let validity = database::message_uid_validity(app, &account.id, &folder, uid)?;
    if expected_uid_validity == 0 || expected_uid_validity != validity {
        return Err("Mailbox changed. Reopen the message before changing tags.".into());
    }
    let message = database::get_messages_by_uids(app, &account.id, &folder, &[uid])?
        .into_iter()
        .next()
        .ok_or("Message is no longer cached. Refresh and retry.")?;
    let mut edit = super::outbox::Edit {
        folder,
        mailbox,
        uid,
        validity,
        message_id: message.message_id,
        date: message.date,
        sender: message.from,
        subject: message.subject,
        added: add_ids,
        removed: remove_ids,
    };
    // Prefer a cached Inbox/Sent copy over the label being removed. Those
    // copies retain a usable UID after this edit removes its source label.
    if let Some(message_id) = edit.message_id.as_deref().filter(|id| !id.is_empty()) {
        let conn = database::open_connection(app)?;
        let mut stmt = conn.prepare("SELECT folder,uid,uid_validity FROM messages WHERE account_id=?1 AND message_id=?2 AND date=?3 AND sender=?4 AND subject=?5 AND uid_validity>0 ORDER BY CASE folder WHEN 'inbox' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END").map_err(|e|e.to_string())?;
        let candidates = stmt
            .query_map(
                rusqlite::params![account.id, message_id, edit.date, edit.sender, edit.subject],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, u32>(1)?,
                        r.get::<_, u32>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        for candidate in candidates {
            let (folder, uid, validity) = candidate.map_err(|e| e.to_string())?;
            if folder
                .strip_prefix("tag:")
                .is_some_and(|tag| edit.removed.iter().any(|id| id == tag))
            {
                continue;
            }
            if let Ok(mailbox) = message_actions::resolve_mailbox(app, account, &folder) {
                edit.folder = folder;
                edit.mailbox = mailbox;
                edit.uid = uid;
                edit.validity = validity;
                break;
            }
        }
    }
    let id = super::outbox::enqueue(app, &account.id, edit)?;
    super::outbox::deliver(app,account,id).await.map_err(|error| {
        if error.starts_with("CONFLICT:") { error }
        else { format!("Tags could not be confirmed. Saved on this device for automatic retry during sync: {error}") }
    })
}

pub(super) async fn execute_edit(
    app: &AppHandle,
    account: &Account,
    edit: &super::outbox::Edit,
) -> Result<Option<String>, String> {
    if !matches!(account.provider, MailProvider::Google) {
        return Err("CONFLICT: Queued tags require the original Google account".into());
    }
    let available = database::get_all_tags(app, &account.id)?;
    let resolve = |ids: &[String]| {
        ids.iter()
            .map(|id| {
                let tag = available
                    .iter()
                    .find(|t| &t.id == id && t.tag_type == "user" && t.provider == "google")
                    .ok_or_else(|| {
                        "CONFLICT: A queued label is no longer available. Refresh tags and review the message.".to_string()
                    })?;
                quote_label(&tag.name)
            })
            .collect::<Result<Vec<_>, String>>()
    };
    let labels = resolve(&edit.added)?;
    // Removing a label that was deleted at Gmail is already satisfied.
    let existing_removals = edit
        .removed
        .iter()
        .filter(|id| available.iter().any(|t| &t.id == *id))
        .cloned()
        .collect::<Vec<_>>();
    let removed_labels = resolve(&existing_removals)?;
    if labels.is_empty() && removed_labels.is_empty() {
        return Ok(edit.message_id.clone());
    }
    // Labels may have been renamed while the app was closed.
    let mailbox = if edit.folder.starts_with("tag:") {
        message_actions::resolve_mailbox(app, account, &edit.folder).map_err(|_| {
            "CONFLICT: The source label no longer exists. Refresh and review its tags.".to_string()
        })?
    } else {
        edit.mailbox.clone()
    };
    let validity = edit.validity;
    let uid = edit.uid;
    let cached_id = edit.message_id.clone().filter(|id| !id.is_empty());
    execute_with_session(account, SessionKind::Primary, move |session| {
        let selected = session
            .select(&mailbox)
            .map_err(|e| format!("Could not open source mailbox: {e}"))?;
        if validity == 0 || selected.uid_validity != Some(validity) {
            return Err(
                "CONFLICT: Mailbox identity changed. Queued tags cannot safely target this UID."
                    .into(),
            );
        }
        if !session
            .uid_search(format!("UID {uid}"))
            .map_err(|e| e.to_string())?
            .contains(&uid)
        {
            return Err(
                "CONFLICT: Message left its source mailbox. Refresh and review its tags.".into(),
            );
        }
        let message_id = if let Some(id) = &cached_id {
            Some(id.clone())
        } else {
            let headers = session
                .uid_fetch(
                    uid.to_string(),
                    "(UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])",
                )
                .map_err(|e| e.to_string())?;
            let header = headers
                .iter()
                .find(|h| h.uid == Some(uid))
                .ok_or("Message no longer exists in this mailbox")?;
            header
                .header()
                .and_then(|bytes| mailparse::parse_mail(bytes).ok())
                .and_then(|mail| {
                    use mailparse::MailHeaderMap;
                    mail.headers.get_first_value("Message-ID")
                })
        };
        if !labels.is_empty() {
            store_labels(session, uid, &labels)?;
        }
        if !removed_labels.is_empty() {
            remove_labels(session, uid, &removed_labels)?;
        }
        Ok(message_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{Arc, Mutex};
    struct Wire {
        input: Cursor<Vec<u8>>,
        output: Arc<Mutex<Vec<u8>>>,
    }
    impl Read for Wire {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            self.input.read(b)
        }
    }
    impl Write for Wire {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.output.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    fn session(replies: &str) -> (imap::Session<Wire>, Arc<Mutex<Vec<u8>>>) {
        let output = Arc::new(Mutex::new(Vec::new()));
        let wire = Wire {
            input: Cursor::new(replies.as_bytes().to_vec()),
            output: output.clone(),
        };
        (
            imap::Client::new(wire)
                .login("test", "test")
                .map_err(|(e, _)| e)
                .unwrap(),
            output,
        )
    }
    #[test]
    fn silent_store_accepts_tagged_ok_and_checks_exact_uid() {
        let (mut s, wire) =
            session("a1 OK login\r\na2 OK store\r\n* SEARCH 42\r\na3 OK search\r\n");
        assert!(store_labels(&mut s, 42, &[quote_label("My Label").unwrap()]).is_ok());
        let sent = String::from_utf8(wire.lock().unwrap().clone()).unwrap();
        assert!(sent.contains("a2 UID STORE 42 +X-GM-LABELS.SILENT (\"My Label\")\r\n"));
        assert!(sent.contains("a3 UID SEARCH UID 42 X-GM-LABELS \"My Label\"\r\n"));
    }
    #[test]
    fn rejected_or_missing_message_is_not_success() {
        let (mut rejected, _) = session("a1 OK login\r\na2 NO rejected\r\n");
        assert!(store_labels(&mut rejected, 42, &[quote_label("Paper").unwrap()]).is_err());
        let (mut missing, _) =
            session("a1 OK login\r\na2 OK store\r\n* SEARCH\r\na3 OK search\r\n");
        assert!(store_labels(&mut missing, 42, &[quote_label("Paper").unwrap()]).is_err());
    }
    #[test]
    fn label_names_are_encoded_and_cannot_inject_commands() {
        assert_eq!(quote_label("A&B").unwrap(), "\"A&-B\"");
        assert_eq!(quote_label("台北").unwrap(), "\"&U,BTFw-\"");
        assert_eq!(quote_label("a\"b\\c").unwrap(), "\"a\\\"b\\\\c\"");
        assert!(quote_label("Paper\r\nLOGOUT").is_err());
    }

    #[test]
    fn label_snapshot_uses_search_lists_and_preserves_source_uids() {
        let (mut s, wire) = session(
            "a1 OK login\r\n* SEARCH 42 43\r\na2 OK scan\r\n* SEARCH 43\r\na3 OK labels\r\n",
        );
        let labels = vec![("paper".into(), quote_label("My Label").unwrap())];
        assert_eq!(
            fetch_memberships(&mut s, "42:43", &labels).unwrap(),
            vec![(42, vec![]), (43, vec!["paper".into()])]
        );
        let sent = String::from_utf8(wire.lock().unwrap().clone()).unwrap();
        assert!(sent.contains("UID SEARCH UID 42:43 X-GM-LABELS \"My Label\""));
        assert!(!sent.contains("FETCH"));
    }

    #[test]
    fn incomplete_label_snapshot_is_an_error_not_an_empty_replacement() {
        let (mut s, _) = session("a1 OK login\r\n* SEARCH 42\r\na2 OK scan\r\na3 NO failed\r\n");
        assert!(fetch_memberships(
            &mut s,
            "42",
            &[("paper".into(), quote_label("Paper").unwrap())]
        )
        .is_err());
    }

    #[test]
    fn removing_source_label_accepts_disappearing_uid_after_confirmed_store() {
        let(mut s,wire)=session("a1 OK login\r\n* SEARCH 42\r\na2 OK exists\r\na3 OK removed\r\n* SEARCH\r\na4 OK checked\r\n");
        assert!(remove_labels(&mut s, 42, &[quote_label("Paper").unwrap()]).is_ok());
        assert!(String::from_utf8(wire.lock().unwrap().clone())
            .unwrap()
            .contains("UID STORE 42 -X-GM-LABELS.SILENT (\"Paper\")"));
    }
    #[test]
    fn removal_not_confirmed_is_an_error() {
        let(mut s,_)=session("a1 OK login\r\n* SEARCH 42\r\na2 OK exists\r\na3 OK removed\r\n* SEARCH 42\r\na4 OK checked\r\n");
        assert!(remove_labels(&mut s, 42, &[quote_label("Paper").unwrap()]).is_err());
    }
}
