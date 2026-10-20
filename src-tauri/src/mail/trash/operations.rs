//! Durable desired location per logical message. Provider UIDs stay in `source`;
//! optimistic views never become provider identities.
use super::{discover, Session};
use crate::{
    auth::account::Account,
    mail::{
        database,
        imap_session::{execute_with_session, SessionKind},
        message_list::MessageHeader,
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, Serialize)]
pub struct Pending {
    pub id: String,
    pub source: MessageHeader,
    pub desired: String,
    pub revision: i64,
    pub version: i64,
    pub optimistic: bool,
    pub phase: String,
    pub last_error: Option<String>,
    pub deleted: bool,
    pub cached: bool,
}
#[derive(Clone)]
struct Operation {
    row: Pending,
    attempt: Option<String>,
    confirmed: Option<Confirmed>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Confirmed {
    header: Option<MessageHeader>,
    purged: bool,
}

pub fn identity(header: &MessageHeader) -> String {
    if let Some(id) = header.message_id.as_deref().filter(|id| !id.is_empty()) {
        serde_json::json!(["id", id, header.date, header.from, header.subject]).to_string()
    } else {
        serde_json::json!(["row", header.folder, header.uid, header.uid_validity]).to_string()
    }
}
/// Called under the header-ingestion lock. A verified Inbox header supersedes
/// its stale Trash alias, including after moves made in Gmail.
pub fn inbox_headers(
    app: &AppHandle,
    account: &str,
    headers: &[MessageHeader],
) -> Result<(), String> {
    if headers.is_empty() {
        return Ok(());
    }
    let range = headers
        .iter()
        .map(|header| header.uid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut conn = database::open_connection(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let same="s.account_id=d.account_id AND s.folder='trash' AND NULLIF(s.message_id,'')=d.message_id AND s.date=d.date AND s.sender=d.sender AND s.subject=d.subject";
    tx.execute(&format!("UPDATE messages AS d SET (body,processed_html,body_fetched,attachments_json,extracted_data,has_attachments,snippet)=(SELECT s.body,s.processed_html,s.body_fetched,s.attachments_json,s.extracted_data,s.has_attachments,s.snippet FROM messages s WHERE {same} AND s.body_fetched=1 LIMIT 1) WHERE d.account_id=?1 AND d.folder='inbox' AND d.uid IN ({range}) AND d.body_fetched=0 AND EXISTS(SELECT 1 FROM messages s WHERE {same} AND s.body_fetched=1)"),[account]).map_err(|e|e.to_string())?;
    tx.execute(&format!("INSERT OR IGNORE INTO message_tags(account_id,folder,message_uid,tag_id) SELECT d.account_id,'inbox',d.uid,mt.tag_id FROM messages d JOIN messages s ON {same} JOIN message_tags mt ON mt.account_id=s.account_id AND mt.folder=s.folder AND mt.message_uid=s.uid WHERE d.account_id=?1 AND d.folder='inbox' AND d.uid IN ({range})"),[account]).map_err(|e|e.to_string())?;
    tx.execute(&format!("DELETE FROM messages AS s WHERE s.account_id=?1 AND s.folder='trash' AND EXISTS(SELECT 1 FROM messages d WHERE {same} AND d.folder='inbox' AND d.uid IN ({range}))"),[account]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn init(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS mail_location_intents(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL,identity TEXT NOT NULL,source TEXT NOT NULL,
      desired TEXT NOT NULL CHECK(desired IN ('inbox','trash','deleted')),revision INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,optimistic INTEGER NOT NULL DEFAULT 1,phase TEXT NOT NULL DEFAULT 'pending',
      attempt TEXT,confirmed TEXT,last_error TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,
      UNIQUE(account_id,identity));
      CREATE INDEX IF NOT EXISTS idx_location_account_state ON mail_location_intents(account_id,phase,updated_at);").map_err(|e|e.to_string())?;
    // Preserve earlier Trash requests, including provider-confirmed cache repairs.
    let legacy: Vec<(String, String, String, Option<String>, Option<String>, bool)> = {
        let mut stmt=tx.prepare("SELECT account_id,snapshot,action,remote_done,last_error,optimistic FROM pending_trash_actions ORDER BY id").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for (account, snapshot, action, done, error, optimistic) in legacy {
        let source: MessageHeader = serde_json::from_str(&snapshot).map_err(|e| e.to_string())?;
        let desired = if action == "restore" {
            "inbox"
        } else {
            "deleted"
        };
        let confirmed=done.map(|value|->Result<String,String>{let value:serde_json::Value=serde_json::from_str(&value).map_err(|e|e.to_string())?;Ok(serde_json::json!({"header":value.get("restored"),"purged":value.get("purged").and_then(|v|v.as_bool()).unwrap_or(false)}).to_string())}).transpose()?;
        tx.execute("INSERT OR IGNORE INTO mail_location_intents(id,account_id,identity,source,desired,optimistic,confirmed,last_error,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![uuid::Uuid::new_v4().to_string(),account,identity(&source),snapshot,desired,optimistic,confirmed,error,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
    }
    // The previous Inbox delete path used the generic action queue. Transfer
    // its verifiable requests so that an older delete cannot replay after a
    // newer restore from the unified location queue.
    let has_generic:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_message_actions')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if has_generic {
        let moves: Vec<(i64, String, MessageHeader, Option<String>)> = {
            let mut stmt=tx.prepare("SELECT p.id,p.account_id,m.folder,m.uid,m.uid_validity,m.subject,m.sender,m.date,m.seen,m.flagged,m.has_attachments,m.thread_id,m.snippet,m.recipient,m.message_id,p.last_error FROM pending_message_actions p JOIN messages m ON m.account_id=p.account_id AND m.folder=p.folder AND m.uid=p.uid AND m.uid_validity=p.uid_validity WHERE p.action='delete' AND m.uid_validity>0").map_err(|e|e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        MessageHeader {
                            folder: r.get(2)?,
                            uid: r.get(3)?,
                            uid_validity: r.get(4)?,
                            subject: r.get(5)?,
                            from: r.get(6)?,
                            date: r.get(7)?,
                            seen: r.get(8)?,
                            flagged: r.get(9)?,
                            has_attachments: r.get(10)?,
                            thread_id: r.get(11)?,
                            snippet: r.get(12)?,
                            to: r.get(13)?,
                            message_id: r.get(14)?,
                            tags: Vec::new(),
                        },
                        r.get(15)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        for (id, account, source, error) in moves {
            if safe_id(&source).is_err() {
                continue;
            }
            tx.execute("INSERT OR IGNORE INTO mail_location_intents(id,account_id,identity,source,desired,optimistic,last_error,updated_at) VALUES(?1,?2,?3,?4,'trash',?5,?6,?7)",params![uuid::Uuid::new_v4().to_string(),account,identity(&source),serde_json::to_string(&source).map_err(|e|e.to_string())?,error.is_none(),error,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
            tx.execute(
                "DELETE FROM pending_message_actions WHERE account_id=?1 AND id=?2",
                params![account, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute("DELETE FROM pending_trash_actions", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM mail_location_intents WHERE phase='settled' AND updated_at<?1",
        [chrono::Utc::now().timestamp() - 30 * 24 * 60 * 60],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
fn authorize(app: &AppHandle, account: &str) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(app)?;
    let active = crate::auth::session::get_active_profile(app).ok_or("No active account")?;
    if active.id != account {
        return Err("Account changed. Reopen the message.".into());
    }
    Ok(())
}
fn read(row: &rusqlite::Row) -> rusqlite::Result<Operation> {
    fn json<T: serde::de::DeserializeOwned>(value: String, index: usize) -> rusqlite::Result<T> {
        serde_json::from_str(&value).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
    }
    Ok(Operation {
        row: Pending {
            id: row.get(0)?,
            source: json(row.get(1)?, 1)?,
            desired: row.get(2)?,
            revision: row.get(3)?,
            version: row.get(4)?,
            optimistic: row.get(5)?,
            phase: row.get(6)?,
            last_error: row.get(7)?,
            deleted: row.get(8)?,
            cached: row.get(11)?,
        },
        attempt: row.get(9)?,
        confirmed: row
            .get::<_, Option<String>>(10)?
            .map(|value| json(value, 10))
            .transpose()?,
    })
}
const COLUMNS: &str =
    "id,source,desired,revision,version,optimistic,phase,last_error,deleted,attempt,confirmed,EXISTS(SELECT 1 FROM messages m WHERE m.account_id=mail_location_intents.account_id AND m.folder=json_extract(source,'$.folder') AND m.uid=json_extract(source,'$.uid') AND m.uid_validity=json_extract(source,'$.uid_validity'))";
fn get(conn: &Connection, account: &str, id: &str) -> Result<Option<Operation>, String> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM mail_location_intents WHERE account_id=?1 AND id=?2"),
        params![account, id],
        read,
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn source(
    app: &AppHandle,
    account: &str,
    local_id: Option<&str>,
    folder: &str,
    uid: u32,
) -> Result<(String, u32, Option<u32>), String> {
    if let Some(id) = local_id {
        if let Some(op) = get(&database::open_connection(app)?, account, id)? {
            if op.row.deleted {
                return Err("This message was permanently removed.".into());
            }
            if !op.row.cached && matches!(op.row.phase.as_str(), "settled" | "failed") {
                if let Some(header) = database::get_messages_by_uids(app, account, folder, &[uid])?
                    .into_iter()
                    .find(|header| same(header, &op.row.source))
                {
                    return Ok((header.folder, header.uid, Some(header.uid_validity)));
                }
                return Err(
                    "Mailbox identity changed. Refresh before opening this message.".into(),
                );
            }
            return Ok((
                op.row.source.folder,
                op.row.source.uid,
                Some(op.row.source.uid_validity),
            ));
        }
    }
    Ok((folder.into(), uid, None))
}
pub fn changed(app: &AppHandle, account: &str) {
    super::super::search::SEARCH_CACHE.retain(|_, entry| entry.account_id != account);
    static SCHEDULED: once_cell::sync::Lazy<std::sync::Mutex<std::collections::HashSet<String>>> =
        once_cell::sync::Lazy::new(|| std::sync::Mutex::new(std::collections::HashSet::new()));
    let Ok(mut guard) = SCHEDULED.lock() else {
        return;
    };
    if !guard.insert(account.into()) {
        return;
    }
    drop(guard);
    let app = app.clone();
    let account = account.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(35)).await;
        if let Ok(mut guard) = SCHEDULED.lock() {
            guard.remove(&account);
        }
        let _ = app.emit("trash:pending_changed", &account);
        let _ = app.emit("mail:labels_changed", &account);
        crate::tray_state::refresh_unread_count_from_db(&app);
    });
}
pub fn refresh_metadata(
    app: &AppHandle,
    account: &str,
    folder: &str,
    uid: u32,
    local_id: Option<&str>,
) -> Result<Option<Pending>, String> {
    let Some(header) = database::get_messages_by_uids(app, account, folder, &[uid])?
        .into_iter()
        .next()
    else {
        return Ok(None);
    };
    let conn = database::open_connection(app)?;
    conn.execute("UPDATE mail_location_intents SET source=?3,version=version+1 WHERE account_id=?1 AND identity=?2 AND json_extract(source,'$.folder')=?4 AND json_extract(source,'$.uid')=?5 AND json_extract(source,'$.uid_validity')=?6",params![account,identity(&header),serde_json::to_string(&header).map_err(|e|e.to_string())?,folder,uid,header.uid_validity]).map_err(|e|e.to_string())?;
    let row = local_id
        .map(|id| get(&conn, account, id))
        .transpose()?
        .flatten()
        .map(|op| op.row);
    changed(app, account);
    Ok(row)
}
fn safe_id(header: &MessageHeader) -> Result<&str, String> {
    header
        .message_id
        .as_deref()
        .filter(|id| !id.is_empty() && id.len() <= 998 && !id.chars().any(char::is_control))
        .ok_or("This message has no safe Message-ID. Move it using the provider website.".into())
}
fn same(a: &MessageHeader, b: &MessageHeader) -> bool {
    a.message_id == b.message_id && a.date == b.date && a.from == b.from && a.subject == b.subject
}
fn find(
    session: &mut Session,
    source: &MessageHeader,
    folder: &str,
    mailbox: &str,
) -> Result<MessageHeader, String> {
    let selected = session.select(mailbox).map_err(|e| e.to_string())?;
    let validity = selected
        .uid_validity
        .filter(|v| *v != 0)
        .ok_or("Provider did not provide UIDVALIDITY")?;
    let id = safe_id(source)?;
    let found = session
        .uid_search(format!(
            "HEADER Message-ID \"{}\"",
            id.replace('\\', "\\\\").replace('"', "\\\"")
        ))
        .map_err(|e| e.to_string())?;
    if found.is_empty() || found.len() > 20 {
        return Err("CONFLICT: The moved message could not be confirmed. Refresh the mailbox before trying again.".into());
    }
    let fetched = session
        .uid_fetch(
            found
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(","),
            "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO MESSAGE-ID)])",
        )
        .map_err(|e| e.to_string())?;
    let headers: Vec<_> = fetched
        .iter()
        .filter_map(|fetch| super::super::sync::parse_header_to_message(fetch, validity, folder))
        .filter(|header| same(header, source))
        .collect();
    if headers.len() != 1 {
        return Err("CONFLICT: Message identity is ambiguous. Nothing else was moved.".into());
    }
    Ok(headers[0].clone())
}
async fn remote(
    app: &AppHandle,
    account: &Account,
    source: MessageHeader,
    target: String,
    probe_only: bool,
) -> Result<Confirmed, String> {
    let app = app.clone();
    let active = account.clone();
    execute_with_session(account, SessionKind::Primary, move |session| {
        let trash = discover(&app, &active, session)?;
        let mailbox = if source.folder == "trash" {
            trash.clone()
        } else {
            super::super::message_actions::resolve_mailbox(&app, &active, &source.folder)?
        };
        let selected = session.select(&mailbox).map_err(|e| e.to_string())?;
        if selected.uid_validity != Some(source.uid_validity) || source.uid_validity == 0 {
            return Err("CONFLICT: Mailbox identity changed; the action was stopped.".into());
        }
        let fetched = session
            .uid_fetch(
                source.uid.to_string(),
                "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE TO MESSAGE-ID)])",
            )
            .map_err(|e| e.to_string())?;
        let current = fetched
            .iter()
            .filter(|fetch| fetch.uid == Some(source.uid))
            .find_map(|fetch| {
                super::super::sync::parse_header_to_message(
                    fetch,
                    source.uid_validity,
                    &source.folder,
                )
            });
        let destination = if target == "trash" {
            trash.clone()
        } else {
            "INBOX".into()
        };
        let Some(current) = current else {
            return if target == "deleted" {
                Ok(Confirmed {
                    header: None,
                    purged: false,
                })
            } else {
                Ok(Confirmed {
                    header: Some(find(session, &source, &target, &destination)?),
                    purged: false,
                })
            };
        };
        if !same(&source, &current) {
            return Err("CONFLICT: The provider message identity changed.".into());
        }
        // Resolve an uncertain superseded move without replaying it when the
        // user has already chosen a different destination.
        if probe_only {
            return Ok(Confirmed {
                header: Some(current),
                purged: false,
            });
        }
        let caps = session.capabilities().map_err(|e| e.to_string())?;
        if target == "deleted" {
            if source.folder != "trash" || !caps.has_str("UIDPLUS") {
                return Err(
                    "CONFLICT: Safe targeted deletion is unavailable for this message.".into(),
                );
            }
            session
                .uid_store(source.uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
                .map_err(|e| e.to_string())?;
            session
                .uid_expunge(source.uid.to_string())
                .map_err(|e| format!("Permanent deletion was not confirmed: {e}"))?;
            if session
                .uid_search(format!("UID {}", source.uid))
                .map_err(|e| e.to_string())?
                .contains(&source.uid)
            {
                return Err("Provider did not confirm permanent deletion".into());
            }
            return Ok(Confirmed {
                header: None,
                purged: true,
            });
        }
        safe_id(&source)?;
        if !caps.has_str("MOVE") {
            return Err(
                "CONFLICT: Provider does not support safe IMAP MOVE. Use its website.".into(),
            );
        }
        session
            .uid_mv(source.uid.to_string(), &destination)
            .map_err(|e| format!("Message move was not confirmed: {e}"))?;
        let header = find(session, &source, &target, &destination)?;
        let final_source = session.select(&mailbox).map_err(|e| e.to_string())?;
        if final_source.uid_validity != Some(source.uid_validity) {
            return Err("CONFLICT: Source mailbox identity changed during the move".into());
        }
        if session
            .uid_search(format!("UID {}", source.uid))
            .map_err(|e| e.to_string())?
            .contains(&source.uid)
        {
            return Err("Provider did not remove the source after moving it".into());
        }
        Ok(Confirmed {
            header: Some(header),
            purged: false,
        })
    })
    .await
}
fn apply_confirmed(
    app: &AppHandle,
    account: &str,
    op: &Operation,
    done: &Confirmed,
) -> Result<(), String> {
    let old = &op.row.source;
    if let Some(header) = &done.header {
        let body = if database::message_uid_validity(app, account, &old.folder, old.uid).ok()
            == Some(old.uid_validity)
        {
            database::get_message_body_cache(app, account, &old.folder, old.uid)?
        } else {
            None
        };
        let mailbox = if header.folder != "inbox" {
            let active = crate::auth::session::get_active_account(app)
                .filter(|active| active.id == account)
                .ok_or("Account changed")?;
            super::super::message_actions::resolve_mailbox(app, &active, &header.folder)?
        } else {
            "INBOX".into()
        };
        let epoch = database::get_mailbox_validity(app, account, &mailbox)?;
        let cached_epoch =
            database::message_uid_validity(app, account, &header.folder, header.uid).ok();
        if epoch != Some(header.uid_validity)
            || cached_epoch.is_some_and(|epoch| epoch != header.uid_validity)
        {
            database::reset_mailbox_epoch(
                app,
                account,
                &header.folder,
                &mailbox,
                header.uid_validity,
            )?;
        }
        let mut state = database::get_folder_sync_state(app, account, &header.folder)?
            .unwrap_or_else(|| database::FolderSyncState {
                account_id: account.into(),
                folder: header.folder.clone(),
                ..Default::default()
            });
        if state.uid_validity != Some(header.uid_validity) {
            state.uid_validity = Some(header.uid_validity);
            state.last_uid = 0;
            state.last_synced_at = 0;
            state.last_full_sync_at = 0;
            database::update_folder_sync_state(app, &state)?;
        }
        database::insert_or_update_messages(app, account, &[header.clone()])?;
        if let Some((body, attachments, extracted)) = body {
            database::update_message_body(
                app,
                account,
                &header.folder,
                header.uid,
                &body,
                old.snippet.as_deref().unwrap_or(""),
                attachments,
                extracted,
            )?;
        }
    }
    let mut conn = database::open_connection(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Gmail moves affect all cached label aliases. Remove old copies while
    // retaining the verified destination. No invented destination UID is stored.
    if let Some(header) = &done.header {
        tx.execute("INSERT OR IGNORE INTO message_tags(account_id,folder,message_uid,tag_id) SELECT account_id,?5,?6,tag_id FROM message_tags WHERE account_id=?1 AND folder=?2 AND message_uid=?3 AND EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3 AND uid_validity=?4)",params![account,old.folder,old.uid,old.uid_validity,header.folder,header.uid]).map_err(|e|e.to_string())?;
        for tag in &old.tags {
            tx.execute("INSERT OR IGNORE INTO message_tags(account_id,folder,message_uid,tag_id) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tags WHERE account_id=?1 AND id=?4)",params![account,header.folder,header.uid,tag]).map_err(|e|e.to_string())?;
        }
    }
    tx.execute("DELETE FROM messages WHERE account_id=?1 AND ((folder=?2 AND uid=?3 AND uid_validity=?4) OR (NULLIF(?5,'') IS NOT NULL AND message_id=?5 AND date=?6 AND sender=?7 AND subject=?8 AND (?9 OR ?10='trash' OR folder='trash'))) AND NOT (?11 AND folder=?12 AND uid=?13 AND uid_validity=?14)",params![account,old.folder,old.uid,old.uid_validity,old.message_id,old.date,old.from,old.subject,done.purged,done.header.as_ref().map(|h|h.folder.as_str()).unwrap_or(""),done.header.is_some(),done.header.as_ref().map(|h|h.folder.as_str()).unwrap_or(""),done.header.as_ref().map(|h|h.uid).unwrap_or(0),done.header.as_ref().map(|h|h.uid_validity).unwrap_or(0)]).map_err(|e|e.to_string())?;
    let mut updated = done.header.as_ref().unwrap_or(old).clone();
    updated.tags = old.tags.clone();
    tx.execute("UPDATE mail_location_intents SET source=?3,deleted=?4,confirmed=NULL,attempt=NULL,phase='pending',version=version+1,updated_at=?5 WHERE account_id=?1 AND id=?2",params![account,op.row.id,serde_json::to_string(&updated).map_err(|e|e.to_string())?,done.header.is_none(),chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    super::super::tags::assignment::LABEL_GENERATION
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    changed(app, account);
    Ok(())
}
fn fail(app: &AppHandle, account: &str, op: &Operation, error: &str) -> Result<(), String> {
    let conn = database::open_connection(app)?;
    let confirmed: bool = conn
        .query_row(
            "SELECT confirmed IS NOT NULL FROM mail_location_intents WHERE account_id=?1 AND id=?2",
            params![account, op.row.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let count=conn.execute("UPDATE mail_location_intents SET optimistic=CASE WHEN confirmed IS NULL THEN 0 ELSE optimistic END,last_error=?4,phase=CASE WHEN confirmed IS NOT NULL THEN 'repair' ELSE 'failed' END,attempt=CASE WHEN ?6 AND attempt='deleted' AND confirmed IS NULL THEN NULL ELSE attempt END,version=version+1,updated_at=?5 WHERE account_id=?1 AND id=?2 AND revision=?3",params![account,op.row.id,op.row.revision,error,chrono::Utc::now().timestamp(),error.starts_with("CONFLICT:")]).map_err(|e|e.to_string())?;
    if count > 0 && op.row.optimistic {
        let _=app.emit("trash:failed",serde_json::json!({"account_id":account,"id":op.row.id,"revision":op.row.revision,"error":error,"reverted":!confirmed}));
    }
    changed(app, account);
    Ok(())
}
async fn deliver(app: &AppHandle, account: &Account, id: &str) -> Result<(), String> {
    // Bounded rounds prevent one rapidly edited message starving other mail.
    for _ in 0..12 {
        let _lock = super::super::message_actions::MUTATION_LOCK.lock().await;
        authorize(app, &account.id)?;
        let conn = database::open_connection(app)?;
        let Some(op) = get(&conn, &account.id, id)? else {
            return Ok(());
        };
        if op.row.phase == "settled" {
            return Ok(());
        }
        if op
            .row
            .last_error
            .as_deref()
            .is_some_and(|error| error.starts_with("CONFLICT:"))
            && op.confirmed.is_none()
        {
            return Ok(());
        }
        if let Some(done) = &op.confirmed {
            if let Err(error) = apply_confirmed(app, &account.id, &op, done) {
                let _ = fail(app, &account.id, &op, &error);
                return Err(error);
            }
            continue;
        }
        if op.attempt.is_none() && (op.row.deleted || op.row.source.folder == op.row.desired) {
            conn.execute("UPDATE mail_location_intents SET optimistic=0,phase='settled',last_error=NULL,version=version+1,updated_at=?4 WHERE account_id=?1 AND id=?2 AND revision=?3",params![account.id,id,op.row.revision,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
            changed(app, &account.id);
            continue;
        }
        let wanted = if op.row.desired == "deleted" && op.row.source.folder != "trash" {
            "trash"
        } else {
            op.row.desired.as_str()
        };
        let probe_only = op
            .attempt
            .as_deref()
            .is_some_and(|attempt| attempt != wanted);
        let target = op.attempt.clone().unwrap_or_else(|| {
            if op.row.desired == "deleted" && op.row.source.folder != "trash" {
                "trash".into()
            } else {
                op.row.desired.clone()
            }
        });
        conn.execute("UPDATE mail_location_intents SET attempt=?3,phase=?4,version=version+1 WHERE account_id=?1 AND id=?2",params![account.id,id,target,if target=="deleted"{"purging"}else{"running"}]).map_err(|e|e.to_string())?;
        drop(conn);
        match remote(app, account, op.row.source.clone(), target, probe_only).await {
            Ok(done) => {
                database::open_connection(app)?.execute("UPDATE mail_location_intents SET confirmed=?3,version=version+1 WHERE account_id=?1 AND id=?2",params![account.id,id,serde_json::to_string(&done).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
                if let Err(error) = apply_confirmed(app, &account.id, &op, &done) {
                    let _ = fail(app, &account.id, &op, &error);
                    return Err(error);
                }
            }
            Err(error) => {
                if get(&database::open_connection(app)?, &account.id, id)?
                    .is_some_and(|latest| latest.row.revision != op.row.revision)
                {
                    continue;
                }
                let _ = fail(app, &account.id, &op, &error);
                return Err(error);
            }
        }
    }
    kick(app);
    Ok(())
}
pub async fn retry_pending(app: &AppHandle, account: &Account) {
    let ids=database::open_connection(app).and_then(|conn|{
        let mut stmt=conn.prepare("SELECT id,revision FROM mail_location_intents WHERE account_id=?1 AND phase<>'settled' ORDER BY (last_error IS NOT NULL),updated_at,id LIMIT 50").map_err(|e|e.to_string())?;
        let ids=stmt.query_map([&account.id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;Ok(ids)
    });
    if let Ok(ids) = ids {
        for (id, _) in &ids {
            if let Err(error) = deliver(app, account, &id).await {
                if !error.starts_with("CONFLICT:") {
                    // A failed connection affects queued requests too. Revert
                    // their local projections in one pass rather than leaving
                    // untouched requests hidden until the next sync cycle.
                    let _lock = super::super::message_actions::MUTATION_LOCK.lock().await;
                    if let Ok(conn) = database::open_connection(app) {
                        if let Ok(mut stmt)=conn.prepare(&format!("SELECT {COLUMNS} FROM mail_location_intents WHERE account_id=?1 AND optimistic=1 AND phase<>'settled'")) {
                            if let Ok(rows)=stmt.query_map([&account.id],read) {
                                let pending=rows.collect::<rusqlite::Result<Vec<_>>>().unwrap_or_default();
                                for op in pending {if op.row.id!=*id&&ids.iter().any(|(queued,revision)|queued==&op.row.id&&revision==&op.row.revision){let _=fail(app,&account.id,&op,&error);}}
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
}
pub fn kick(app: &AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();
    if !STARTED.swap(true, std::sync::atomic::Ordering::AcqRel) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                WAKE.notified().await;
                if crate::auth::app_lock::require_unlocked(&app).is_err() {
                    continue;
                }
                let active = crate::auth::session::get_active_profile(&app);
                match crate::auth::bootstrap::ensure_active_account(&app).await {
                    Ok(account) => retry_pending(&app, &account).await,
                    Err(error) => {
                        if let Some(active) = active {
                            let _lock = super::super::message_actions::MUTATION_LOCK.lock().await;
                            if let Ok(conn) = database::open_connection(&app) {
                                if let Ok(mut stmt)=conn.prepare(&format!("SELECT {COLUMNS} FROM mail_location_intents WHERE account_id=?1 AND optimistic=1 AND phase<>'settled'")){
                                if let Ok(rows)=stmt.query_map([&active.id],read){
                                    for op in rows.collect::<rusqlite::Result<Vec<_>>>().unwrap_or_default(){let _=fail(&app,&active.id,&op,&error);}
                                }
                            }
                            }
                        }
                    }
                }
            }
        });
    }
    WAKE.notify_one();
}
#[tauri::command]
pub async fn trash_action(
    app_handle: AppHandle,
    account_id: String,
    uid: u32,
    expected_uid_validity: u32,
    action: String,
    folder: Option<String>,
    local_id: Option<String>,
    request_id: Option<String>,
) -> Result<Pending, String> {
    authorize(&app_handle, &account_id)?;
    let desired = match action.as_str() {
        "move" => "trash",
        "restore" => "inbox",
        "purge" => "deleted",
        _ => return Err("Invalid mail location action".into()),
    }
    .to_string();
    let app = app_handle.clone();
    let pending=tokio::task::spawn_blocking(move||{
        authorize(&app,&account_id)?;let mut conn=database::open_connection(&app)?;let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let explicit=local_id.as_deref().map(|id|get(&tx,&account_id,id)).transpose()?.flatten();
        let source=if let Some(op)=&explicit{
            if op.row.phase=="settled" || (op.row.phase=="failed" && op.row.last_error.as_deref().is_some_and(|error|error.starts_with("CONFLICT:"))) {
                let folder=folder.as_deref().unwrap_or(&op.row.source.folder);
                database::get_messages_by_uids(&app,&account_id,folder,&[uid])?.into_iter().find(|header|header.uid_validity==expected_uid_validity&&same(header,&op.row.source)).unwrap_or_else(||op.row.source.clone())
            }else{op.row.source.clone()}
        }else{
            let folder=folder.as_deref().unwrap_or("trash");
            let header=database::get_messages_by_uids(&app,&account_id,folder,&[uid])?.into_iter().next().ok_or("Message is not cached. Refresh and try again.")?;
            if expected_uid_validity==0||header.uid_validity!=expected_uid_validity{return Err("Mailbox identity changed. Refresh before trying again.".into())}header
        };
        if desired!="deleted"{safe_id(&source)?;}
        let key=identity(&source);
        let existing=if explicit.is_some(){explicit}else{tx.query_row(&format!("SELECT {COLUMNS} FROM mail_location_intents WHERE account_id=?1 AND identity=?2"),params![account_id,key],read).optional().map_err(|e|e.to_string())?};
        if let Some(old)=&existing{
            if old.row.phase=="purging"||old.attempt.as_deref()==Some("deleted"){return Err("Permanent deletion is already being confirmed. It cannot be reversed.".into())}
            if old.row.deleted&&local_id.is_some(){return Err("This message was permanently removed.".into())}
        }
        let logical=existing.as_ref().filter(|op|op.row.optimistic).map(|op|op.row.desired.as_str()).unwrap_or(source.folder.as_str());
        let reversing_failed_trash=existing.as_ref().is_some_and(|op|op.row.phase!="settled"&&op.row.desired=="trash");
        if matches!(action.as_str(),"restore"|"purge")&&logical!="trash"&&!reversing_failed_trash{return Err("The message is no longer in Trash.".into())}
        let active:i64=tx.query_row("SELECT COUNT(*) FROM mail_location_intents WHERE account_id=?1 AND phase<>'settled'",[&account_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if active>=50&&existing.as_ref().is_none_or(|op|op.row.phase=="settled"){return Err("Too many unsynced changes. Reconnect and sync before moving more messages.".into())}
        let id=existing.as_ref().map(|op|op.row.id.clone()).unwrap_or_else(||request_id.as_deref().and_then(|id|uuid::Uuid::parse_str(id).ok()).unwrap_or_else(uuid::Uuid::new_v4).to_string());
        if existing.is_some(){
            if existing.as_ref().is_some_and(|op|op.row.phase=="settled"||(op.row.phase=="failed"&&op.row.last_error.as_deref().is_some_and(|error|error.starts_with("CONFLICT:")))) {
                tx.execute("UPDATE mail_location_intents SET source=?3,deleted=0,attempt=NULL,confirmed=NULL WHERE account_id=?1 AND id=?2",params![account_id,id,serde_json::to_string(&source).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
            }
            tx.execute("UPDATE mail_location_intents SET desired=?3,revision=revision+1,version=version+1,optimistic=1,last_error=NULL,phase=CASE WHEN confirmed IS NOT NULL THEN 'repair' WHEN attempt IS NOT NULL THEN phase ELSE 'pending' END,updated_at=?4 WHERE account_id=?1 AND id=?2",params![account_id,id,desired,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
        }else{tx.execute("INSERT INTO mail_location_intents(id,account_id,identity,source,desired,updated_at) VALUES(?1,?2,?3,?4,?5,?6)",params![id,account_id,key,serde_json::to_string(&source).map_err(|e|e.to_string())?,desired,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;}
        let row=get(&tx,&account_id,&id)?.ok_or("Could not save mail action")?.row;tx.commit().map_err(|e|e.to_string())?;changed(&app,&account_id);Ok::<_,String>(row)
    }).await.map_err(|e|e.to_string())??;
    kick(&app_handle);
    Ok(pending)
}
#[tauri::command]
pub async fn list_trash_actions(
    app_handle: AppHandle,
    account_id: String,
    local_id: Option<String>,
) -> Result<Vec<Pending>, String> {
    authorize(&app_handle, &account_id)?;
    tokio::task::spawn_blocking(move||{let conn=database::open_connection(&app_handle)?;
        let mut stmt=conn.prepare(&format!("SELECT {COLUMNS} FROM mail_location_intents WHERE account_id=?1 ORDER BY (id=COALESCE(?2,'')) DESC,(phase='settled'),updated_at DESC,id LIMIT 250")).map_err(|e|e.to_string())?;
        let rows=stmt.query_map(params![account_id,local_id],read).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;Ok(rows.into_iter().map(|op|op.row).collect())
    }).await.map_err(|e|e.to_string())?
}
