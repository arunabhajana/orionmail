//! Durable Gmail label intent. No foreign key to cached mail: sync may evict it.
use crate::{
    auth::account::Account,
    mail::{database, message_actions},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Edit {
    pub folder: String,
    pub mailbox: String,
    pub uid: u32,
    pub validity: u32,
    pub message_id: Option<String>,
    pub date: i64,
    pub sender: String,
    pub subject: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

pub(super) fn enqueue(app: &AppHandle, account: &str, mut edit: Edit) -> Result<i64, String> {
    let identity = match edit.message_id.as_deref().filter(|id| !id.is_empty()) {
        Some(id) => serde_json::to_string(&(id, edit.date, &edit.sender, &edit.subject)),
        None => serde_json::to_string(&(&edit.folder, edit.uid, edit.validity)),
    }
    .map_err(|e| e.to_string())?;
    let mut conn = database::open_connection(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let old: Option<String> = tx
        .query_row(
            "SELECT payload FROM pending_tag_edits WHERE account_id=?1 AND identity=?2",
            params![account, identity],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(old) = old {
        let previous: Edit = serde_json::from_str(&old).map_err(|e| e.to_string())?;
        let mut desired = std::collections::BTreeMap::new();
        for id in previous.added {
            desired.insert(id, true);
        }
        for id in previous.removed {
            desired.insert(id, false);
        }
        for id in &edit.added {
            desired.insert(id.clone(), true);
        }
        for id in &edit.removed {
            desired.insert(id.clone(), false);
        }
        edit.added = desired
            .iter()
            .filter(|(_, value)| **value)
            .map(|(id, _)| id.clone())
            .collect();
        edit.removed = desired
            .into_iter()
            .filter(|(_, value)| !value)
            .map(|(id, _)| id)
            .collect();
    }
    // Replace the row ID as well, so an older in-flight completion can never
    // delete or record an error against the newer intent.
    tx.execute(
        "DELETE FROM pending_tag_edits WHERE account_id=?1 AND identity=?2",
        params![account, identity],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO pending_tag_edits(account_id,identity,payload) VALUES(?1,?2,?3)",
        params![
            account,
            identity,
            serde_json::to_string(&edit).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

pub(super) async fn deliver(
    app: &AppHandle,
    account: &Account,
    id: i64,
) -> Result<Vec<String>, String> {
    let _mutation = message_actions::MUTATION_LOCK.lock().await;
    let result = deliver_locked(app, account, id).await;
    if let Err(error) = &result {
        let conn = database::open_connection(app)?;
        conn.execute("UPDATE pending_tag_edits SET last_error=?3,attempts=attempts+1 WHERE id=?1 AND account_id=?2",params![id,account.id,error]).map_err(|e|e.to_string())?;
        log::warn!(
            "Tag edit {} for account {} retained: {}",
            id,
            account.id,
            error
        );
    }
    result
}

async fn deliver_locked(
    app: &AppHandle,
    account: &Account,
    id: i64,
) -> Result<Vec<String>, String> {
    let row: Option<(String, bool)> = database::open_connection(app)?
        .query_row(
            "SELECT payload,remote_done FROM pending_tag_edits WHERE id=?1 AND account_id=?2",
            params![id, account.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (payload, remote_done) = row.ok_or("This tag edit was replaced by a newer edit")?;
    let mut edit: Edit = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    if !remote_done {
        // Resolve current provider IDs/names before replay. A renamed/deleted
        // label must never be recreated under an old cached name.
        super::sync_tags(app, account).await?;
        edit.message_id = super::assignment::execute_edit(app, account, &edit).await?;
        database::open_connection(app)?.execute(
            "UPDATE pending_tag_edits SET remote_done=1,payload=?3 WHERE id=?1 AND account_id=?2",
            params![id,account.id,serde_json::to_string(&edit).map_err(|e|e.to_string())?],
        ).map_err(|e|e.to_string())?;
    }
    super::assignment::LABEL_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    // Cache eviction must not prevent completion of a provider-confirmed edit.
    // If the original source was evicted, repair a matching cached alias.
    let conn = database::open_connection(app)?;
    let source: Option<(String, u32, u32)> = conn
        .query_row(
            "SELECT folder,uid,uid_validity FROM messages WHERE account_id=?1 AND
        ((folder=?2 AND uid=?3 AND uid_validity=?4) OR
        (NULLIF(message_id,'')=?5 AND date=?6 AND sender=?7 AND subject=?8))
        ORDER BY CASE WHEN folder=?2 AND uid=?3 AND uid_validity=?4 THEN 0 ELSE 1 END LIMIT 1",
            params![
                account.id,
                edit.folder,
                edit.uid,
                edit.validity,
                edit.message_id,
                edit.date,
                edit.sender,
                edit.subject
            ],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let assigned = if let Some((folder, uid, validity)) = source {
        super::cache::apply_delta(
            app,
            &account.id,
            &folder,
            uid,
            validity,
            edit.message_id.as_deref(),
            &edit.added,
            &edit.removed,
        )?
    } else {
        Vec::new()
    };
    conn.execute(
        "DELETE FROM pending_tag_edits WHERE id=?1 AND account_id=?2",
        params![id, account.id],
    )
    .map_err(|e| e.to_string())?;
    let _ = app.emit("mail:labels_changed", &account.id);
    log::info!(
        "Completed queued tag edit {} for account {}",
        id,
        account.id
    );
    Ok(assigned)
}

pub async fn retry_pending(app: &AppHandle, account: &Account) {
    let load = || -> Result<Vec<i64>, String> {
        let conn = database::open_connection(app)?;
        let mut stmt=conn.prepare("SELECT id FROM pending_tag_edits WHERE account_id=?1 AND (last_error IS NULL OR last_error NOT LIKE 'CONFLICT:%') ORDER BY id LIMIT 50").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([&account.id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    };
    let ids = match load() {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("Could not load queued tag edits: {}", e);
            return;
        }
    };
    for id in ids {
        if let Err(error) = deliver(app, account, id).await {
            if error.starts_with("CONFLICT:") {
                let _ = app.emit(
                    "mail:action_conflict",
                    serde_json::json!({"account_id":account.id,"error":error}),
                );
            } else {
                // Avoid repeatedly waiting for network timeouts while offline.
                break;
            }
        }
    }
}
