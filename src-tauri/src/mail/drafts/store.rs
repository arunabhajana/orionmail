use super::{Draft, Payload, Summary};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::AppHandle;

pub fn db(app: &AppHandle) -> Result<Connection, String> {
    static INIT: once_cell::sync::OnceCell<()> = once_cell::sync::OnceCell::new();
    let conn = crate::mail::database::open_connection(app)?;
    INIT.get_or_try_init(|| -> Result<(), String> {
        conn.execute_batch("CREATE TABLE IF NOT EXISTS compose_drafts (
          account_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
          payload TEXT NOT NULL, updated_at INTEGER NOT NULL, remote_id TEXT, remote_version TEXT,
          dirty INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'queued', error TEXT,
          editing INTEGER NOT NULL DEFAULT 0, conflict INTEGER NOT NULL DEFAULT 0,
          upload_revision INTEGER, PRIMARY KEY(account_id,id));
          CREATE UNIQUE INDEX IF NOT EXISTS drafts_remote_identity ON compose_drafts(account_id,remote_id) WHERE remote_id IS NOT NULL;
          CREATE TABLE IF NOT EXISTS draft_files(account_id TEXT NOT NULL,draft_id TEXT NOT NULL,id TEXT NOT NULL,
          name TEXT NOT NULL,mime_type TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(account_id,draft_id,id));
          CREATE TABLE IF NOT EXISTS draft_send_receipts(account_id TEXT NOT NULL,id TEXT NOT NULL,message_id TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY(account_id,id));
          UPDATE compose_drafts SET editing=0;
          UPDATE compose_drafts SET state='send_unknown',error='Sending was interrupted. Check Sent in Gmail before sending again.' WHERE state='sending';")
            .map_err(|e| e.to_string())?;
        let has_fingerprint:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('compose_drafts') WHERE name='upload_fingerprint')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !has_fingerprint{conn.execute_batch("ALTER TABLE compose_drafts ADD COLUMN upload_fingerprint TEXT;").map_err(|e|e.to_string())?;}
        conn.execute("DELETE FROM draft_files WHERE NOT EXISTS(SELECT 1 FROM compose_drafts WHERE compose_drafts.account_id=draft_files.account_id AND compose_drafts.id=draft_files.draft_id)",[]).map_err(|e|e.to_string())?;
        Ok(())
    })?;
    Ok(conn)
}

const SELECT: &str = "SELECT id,revision,payload,updated_at,remote_id,remote_version,dirty,state,error,editing,conflict,upload_revision,upload_fingerprint FROM compose_drafts WHERE account_id=?1";
fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Draft> {
    let json: String = row.get(2)?;
    let payload = serde_json::from_str(&json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(Draft {
        id: row.get(0)?,
        revision: row.get(1)?,
        payload,
        updated_at: row.get(3)?,
        remote_id: row.get(4)?,
        remote_version: row.get(5)?,
        dirty: row.get(6)?,
        state: row.get(7)?,
        error: row.get(8)?,
        editing: row.get(9)?,
        conflict: row.get(10)?,
        upload_revision: row.get(11)?,
        upload_fingerprint: row.get(12)?,
    })
}
pub fn all(app: &AppHandle, account: &str) -> Result<Vec<Draft>, String> {
    let conn = db(app)?;
    let mut query = conn.prepare(SELECT).map_err(|e| e.to_string())?;
    let values = query
        .query_map([account], row)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(values)
}
pub fn get(app: &AppHandle, account: &str, id: &str) -> Result<Draft, String> {
    db(app)?
        .query_row(&format!("{SELECT} AND id=?2"), params![account, id], row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Draft no longer exists. Refresh Drafts.".into())
}
pub fn list(app: &AppHandle, account: &str) -> Result<Vec<Summary>, String> {
    // Never pull attachment BLOBs across IPC just to render the list.
    let conn = db(app)?;
    let mut query=conn.prepare("SELECT id,revision,json_extract(payload,'$.subject'),json_extract(payload,'$.to'),substr(json_extract(payload,'$.plain'),1,180),updated_at,state,error,conflict,json_array_length(payload,'$.attachments') FROM compose_drafts WHERE account_id=?1 AND state<>'deleting' ORDER BY updated_at DESC").map_err(|e|e.to_string())?;
    let values = query
        .query_map([account], |r| {
            Ok(Summary {
                id: r.get(0)?,
                revision: r.get(1)?,
                subject: r.get(2)?,
                to: serde_json::from_str(&r.get::<_, String>(3)?).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        3,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?,
                preview: r.get(4)?,
                updated_at: r.get(5)?,
                state: r.get(6)?,
                error: r.get(7)?,
                conflict: r.get(8)?,
                attachments: r.get::<_, i64>(9)? as usize,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(values)
}
pub fn by_remote(app: &AppHandle, account: &str, remote: &str) -> Result<Option<Draft>, String> {
    db(app)?
        .query_row(
            &format!("{SELECT} AND remote_id=?2"),
            params![account, remote],
            row,
        )
        .optional()
        .map_err(|e| e.to_string())
}
pub fn save(
    app: &AppHandle,
    account: &str,
    id: &str,
    expected: i64,
    mut payload: Payload,
) -> Result<Draft, String> {
    save_inner(app, account, id, expected, &mut payload, false)
}
pub fn recover(
    app: &AppHandle,
    account: &str,
    id: &str,
    expected: i64,
    mut payload: Payload,
) -> Result<Draft, String> {
    save_inner(app, account, id, expected, &mut payload, true)
}
fn save_inner(
    app: &AppHandle,
    account: &str,
    id: &str,
    expected: i64,
    payload: &mut Payload,
    recovery: bool,
) -> Result<Draft, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid draft identity")?;
    payload.validate()?;
    let mut conn = db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current: Option<(i64, String)> = tx
        .query_row(
            "SELECT revision,state FROM compose_drafts WHERE account_id=?1 AND id=?2",
            params![account, id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if current.as_ref().map(|r| r.0).unwrap_or(0) != expected {
        return Err("Draft changed in another editor. Your text is still open; save a separate copy before reopening.".into());
    }
    if current
        .as_ref()
        .is_some_and(|(_, state)| matches!(state.as_str(), "sending" | "send_unknown" | "deleting"))
    {
        return Err(
            "This draft is being sent or discarded. Check its status before editing.".into(),
        );
    }
    let mut total = 0usize;
    let mut missing = false;
    for file in &mut payload.attachments {
        uuid::Uuid::parse_str(&file.id).map_err(|_| "Invalid draft attachment")?;
        let stored:Option<i64>=tx.query_row("SELECT length(bytes) FROM draft_files WHERE account_id=?1 AND draft_id=?2 AND id=?3",params![account,id,file.id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let size = if let Some(size) = stored {
            size as usize
        } else {
            match crate::mail::attachments::load_for_send(account,&[file.handle.clone()]){
                Ok(mut selected)=>{
                    let selected=selected.pop().ok_or("Attachment is unavailable")?;
                    file.name=selected.name; file.mime_type=selected.mime_type;
                    tx.execute("INSERT INTO draft_files VALUES(?1,?2,?3,?4,?5,?6)",params![account,id,file.id,file.name,file.mime_type,selected.bytes.as_slice()]).map_err(|e|e.to_string())?;
                    selected.bytes.len()
                },
                Err(_) if recovery=>{missing=true;file.size},
                Err(_)=>return Err("An attachment was not saved. Remove it and select the file again; your text is still safe.".into())
            }
        };
        total = total.saturating_add(size);
        file.size = size;
        file.handle.clear();
    }
    if total > crate::mail::attachments::MAX_ATTACHMENT_BYTES {
        return Err("Draft attachments exceed 18 MB".into());
    }
    let json = serde_json::to_string(&*payload).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO compose_drafts(account_id,id,revision,payload,updated_at,editing) VALUES(?1,?2,1,?3,?4,1)
      ON CONFLICT(account_id,id) DO UPDATE SET revision=revision+1,payload=excluded.payload,updated_at=excluded.updated_at,dirty=1,
      state=CASE WHEN state='checking' THEN state ELSE 'queued' END,error=NULL",params![account,id,json,chrono::Utc::now().timestamp_millis()]).map_err(|e|e.to_string())?;
    if missing {
        tx.execute("UPDATE compose_drafts SET state='needs_attachments',error='Your text was recovered. Some attachments had not finished saving; remove and reattach those files before sending.' WHERE account_id=?1 AND id=?2",params![account,id]).map_err(|e|e.to_string())?;
    }
    // Removed attachments are no longer retained indefinitely on disk.
    let mut query = tx
        .prepare("SELECT id FROM draft_files WHERE account_id=?1 AND draft_id=?2")
        .map_err(|e| e.to_string())?;
    let ids = query
        .query_map(params![account, id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    drop(query);
    for file in ids {
        if !payload.attachments.iter().any(|a| a.id == file) {
            tx.execute(
                "DELETE FROM draft_files WHERE account_id=?1 AND draft_id=?2 AND id=?3",
                params![account, id, file],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    get(app, account, id)
}
pub fn files(
    app: &AppHandle,
    account: &str,
    draft: &Draft,
) -> Result<Vec<crate::mail::attachments::AttachmentData>, String> {
    let conn = db(app)?;
    draft.payload.attachments.iter().map(|file|conn.query_row("SELECT name,mime_type,bytes FROM draft_files WHERE account_id=?1 AND draft_id=?2 AND id=?3",params![account,draft.id,file.id],|r|Ok(crate::mail::attachments::AttachmentData{name:r.get(0)?,mime_type:r.get(1)?,bytes:std::sync::Arc::new(r.get(2)?)})).map_err(|e|e.to_string())).collect()
}
pub fn remove(app: &AppHandle, account: &str, id: &str) -> Result<(), String> {
    let mut conn = db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM draft_files WHERE account_id=?1 AND draft_id=?2",
        params![account, id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM compose_drafts WHERE account_id=?1 AND id=?2",
        params![account, id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn sent(app: &AppHandle, account: &str, draft: &Draft) -> Result<(), String> {
    let mut conn = db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let message_id = format!("<orion.{}.{}@orionmail.local>", draft.id, draft.revision);
    tx.execute(
        "INSERT OR REPLACE INTO draft_send_receipts VALUES(?1,?2,?3,?4)",
        params![
            account,
            draft.id,
            message_id,
            chrono::Utc::now().timestamp_millis()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM draft_files WHERE account_id=?1 AND draft_id=?2",
        params![account, draft.id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM compose_drafts WHERE account_id=?1 AND id=?2",
        params![account, draft.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn receipt(app: &AppHandle, account: &str, id: &str) -> Result<Option<String>, String> {
    db(app)?
        .query_row(
            "SELECT message_id FROM draft_send_receipts WHERE account_id=?1 AND id=?2",
            params![account, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}
pub fn remove_clean(app: &AppHandle, account: &str, draft: &Draft) -> Result<(), String> {
    let mut conn = db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let count=tx.execute("DELETE FROM compose_drafts WHERE account_id=?1 AND id=?2 AND revision=?3 AND dirty=0 AND editing=0 AND state NOT IN ('sending','send_unknown','checking','deleting')",params![account,draft.id,draft.revision]).map_err(|e|e.to_string())?;
    if count == 1 {
        tx.execute(
            "DELETE FROM draft_files WHERE account_id=?1 AND draft_id=?2",
            params![account, draft.id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn status(
    app: &AppHandle,
    account: &str,
    id: &str,
    state: &str,
    error: Option<&str>,
) -> Result<(), String> {
    db(app)?
        .execute(
            "UPDATE compose_drafts SET state=?3,error=?4 WHERE account_id=?1 AND id=?2",
            params![account, id, state, error],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub fn acknowledge(
    app: &AppHandle,
    account: &str,
    id: &str,
    revision: i64,
    remote: &str,
    version: &str,
) -> Result<(), String> {
    db(app)?.execute("UPDATE compose_drafts SET remote_id=?3,remote_version=?4,dirty=(revision<>?5),upload_revision=NULL,
      state=CASE WHEN state IN ('deleting','sending') THEN state WHEN revision=?5 THEN 'synced' ELSE 'queued' END,error=NULL WHERE account_id=?1 AND id=?2",
      params![account,id,remote,version,revision]).map(|_|()).map_err(|e|e.to_string())
}
pub fn detach(app: &AppHandle, account: &str, id: &str) -> Result<(), String> {
    db(app)?.execute("UPDATE compose_drafts SET remote_id=NULL,remote_version=NULL,dirty=1,conflict=1,state='queued',upload_revision=NULL,
      error='A different Gmail version was preserved as a separate draft.' WHERE account_id=?1 AND id=?2",params![account,id]).map(|_|()).map_err(|e|e.to_string())
}
pub fn import(
    app: &AppHandle,
    account: &str,
    remote: &str,
    version: &str,
    payload: Payload,
    files: Vec<crate::mail::attachments::AttachmentData>,
    existing: Option<&str>,
) -> Result<(), String> {
    let id = existing
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut conn = db(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // A save may have arrived while the remote MIME was downloading. Never replace it.
    if let Some(id) = existing {
        let protected:bool=tx.query_row("SELECT dirty OR editing OR state IN ('deleting','sending','send_unknown','checking') FROM compose_drafts WHERE account_id=?1 AND id=?2",params![account,id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if protected {
            return Err("Draft is being edited; reconciliation will retry.".into());
        }
    }
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO compose_drafts(account_id,id,revision,payload,updated_at,remote_id,remote_version,dirty,state) VALUES(?1,?2,1,?3,?4,?5,?6,0,'synced')
      ON CONFLICT(account_id,id) DO UPDATE SET payload=excluded.payload,revision=revision+1,remote_version=excluded.remote_version,updated_at=excluded.updated_at",params![account,id,json,chrono::Utc::now().timestamp_millis(),remote,version]).map_err(|e|e.to_string())?;
    tx.execute(
        "DELETE FROM draft_files WHERE account_id=?1 AND draft_id=?2",
        params![account, id],
    )
    .map_err(|e| e.to_string())?;
    for (meta, file) in payload.attachments.iter().zip(files) {
        tx.execute(
            "INSERT INTO draft_files VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                account,
                id,
                meta.id,
                file.name,
                file.mime_type,
                file.bytes.as_slice()
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
