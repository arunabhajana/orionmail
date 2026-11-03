use super::{database, message_list::MessageHeader};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize)]
pub struct Cursor {
    pinned: bool,
    date: i64,
    account: String,
    folder: String,
    uid: u32,
    validity: u32,
    local_id: String,
}
#[derive(Serialize)]
pub struct OwnedHeader {
    account_id: String,
    header: MessageHeader,
    local_id: Option<String>,
    pinned: bool,
    resurfaced_at: Option<i64>,
}
#[derive(Serialize)]
pub struct Page {
    messages: Vec<OwnedHeader>,
    next_cursor: Option<Cursor>,
    tags: std::collections::HashMap<String, Vec<database::Tag>>,
}

// The visible location contract matches the ordinary inbox: pending moves hide
// their source, pending restores project into Inbox, and snoozed mail is hidden.
const SQL: &str = r#"WITH candidates AS (
 SELECT m.account_id,m.folder,m.uid,m.uid_validity,m.date,NULL AS local_id,m.subject,m.sender,m.seen,m.flagged,m.has_attachments,m.snippet,m.thread_id,m.recipient,m.message_id
 FROM messages m WHERE m.folder='inbox' AND m.account_id IN(SELECT value FROM json_each(?1))
 AND NOT EXISTS(SELECT 1 FROM mail_location_intents p WHERE p.account_id=m.account_id AND p.optimistic=1 AND p.identity=CASE WHEN NULLIF(m.message_id,'') IS NOT NULL THEN json_array('id',m.message_id,m.date,m.sender,m.subject) ELSE json_array('row',m.folder,m.uid,m.uid_validity) END)
 UNION ALL
 SELECT p.account_id,json_extract(p.source,'$.folder'),json_extract(p.source,'$.uid'),json_extract(p.source,'$.uid_validity'),json_extract(p.source,'$.date'),p.id,json_extract(p.source,'$.subject'),json_extract(p.source,'$.from'),json_extract(p.source,'$.seen'),json_extract(p.source,'$.flagged'),json_extract(p.source,'$.has_attachments'),json_extract(p.source,'$.snippet'),json_extract(p.source,'$.thread_id'),json_extract(p.source,'$.to'),json_extract(p.source,'$.message_id')
 FROM mail_location_intents p WHERE p.account_id IN(SELECT value FROM json_each(?1)) AND p.optimistic=1 AND p.deleted=0 AND p.desired='inbox'
), identities AS (
 SELECT *,CASE WHEN NULLIF(message_id,'') IS NOT NULL THEN json_array('id',message_id,date,sender,subject) ELSE json_array('row',folder,uid,uid_validity) END AS pin_key,
 ROW_NUMBER() OVER(PARTITION BY account_id,CASE WHEN NULLIF(message_id,'') IS NOT NULL THEN json_array('id',message_id,date,sender,subject) ELSE json_array('row',folder,uid,uid_validity) END ORDER BY date DESC,uid DESC,uid_validity DESC,COALESCE(local_id,'') DESC) AS copy_rank
 FROM candidates
), visible AS (
 SELECT *,EXISTS(SELECT 1 FROM mail_pins p WHERE p.account_id=i.account_id AND p.identity=i.pin_key) AS pinned,
 (SELECT MAX(wake_at) FROM mail_snoozes s WHERE s.account_id=i.account_id AND s.wake_at<=strftime('%s','now') AND i.date<=s.cutoff AND i.uid<=s.seen_uid AND s.key IN(json_array('thread',COALESCE(NULLIF(i.thread_id,''),i.message_id)),json_array('source',i.folder,i.uid,i.uid_validity))) AS resurfaced_at
 FROM identities i WHERE copy_rank=1
 AND NOT EXISTS(SELECT 1 FROM mail_snoozes s WHERE s.account_id=i.account_id AND s.state=0 AND s.wake_at>strftime('%s','now') AND i.date<=s.cutoff AND i.uid<=s.seen_uid AND s.key IN(json_array('thread',COALESCE(NULLIF(i.thread_id,''),i.message_id)),json_array('source',i.folder,i.uid,i.uid_validity)))
 AND NOT EXISTS(SELECT 1 FROM json_each(?3) token WHERE instr(lower(COALESCE(subject,'')||' '||COALESCE(sender,'')||' '||COALESCE(recipient,'')||' '||COALESCE(snippet,'')),lower(token.value))=0)
 AND (?4='all' OR (?4='unread' AND seen=0) OR (?4='flagged' AND flagged=1))
), ordered AS (SELECT *,MAX(date,COALESCE(resurfaced_at,0)) AS sort_date FROM visible)
 SELECT account_id,json_object('folder',folder,'uid',uid,'uid_validity',uid_validity,'subject',subject,'from',sender,'date',date,'seen',json(CASE seen WHEN 0 THEN 'false' ELSE 'true' END),'flagged',json(CASE flagged WHEN 0 THEN 'false' ELSE 'true' END),'has_attachments',json(CASE has_attachments WHEN 0 THEN 'false' ELSE 'true' END),'snippet',snippet,'thread_id',thread_id,'to',recipient,'message_id',message_id),local_id,pinned,resurfaced_at,sort_date,folder,uid,uid_validity FROM ordered
 WHERE ?2 IS NULL OR (pinned,sort_date,account_id,folder,uid,uid_validity,COALESCE(local_id,'')) < (json_extract(?2,'$.pinned'),json_extract(?2,'$.date'),json_extract(?2,'$.account'),json_extract(?2,'$.folder'),json_extract(?2,'$.uid'),json_extract(?2,'$.validity'),json_extract(?2,'$.local_id'))
 ORDER BY pinned DESC,sort_date DESC,account_id DESC,folder DESC,uid DESC,uid_validity DESC,COALESCE(local_id,'') DESC LIMIT ?5"#;

fn query(
    conn: &Connection,
    ids: &[String],
    cursor: Option<Cursor>,
    query: &str,
    filter: &str,
    limit: u32,
) -> Result<(Vec<OwnedHeader>, Option<Cursor>), String> {
    let ids = serde_json::to_string(ids).map_err(|e| e.to_string())?;
    let cursor = cursor
        .map(|c| serde_json::to_string(&c))
        .transpose()
        .map_err(|e| e.to_string())?;
    let terms = serde_json::to_string(&query.split_whitespace().take(20).collect::<Vec<_>>())
        .map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(SQL).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![ids, cursor, terms, filter, limit + 1], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    let mut cursors = Vec::new();
    let mut tags=conn.prepare("SELECT tag_id FROM message_tags WHERE account_id=?1 AND folder=?2 AND message_uid=?3 ORDER BY tag_id").map_err(|e|e.to_string())?;
    for row in rows {
        let (account, header, local_id, pinned, resurfaced_at, date) =
            row.map_err(|e| e.to_string())?;
        let mut header: MessageHeader = serde_json::from_str(&header).map_err(|e| e.to_string())?;
        header.tags = tags
            .query_map(params![account, header.folder, header.uid], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        cursors.push(Cursor {
            account: account.clone(),
            folder: header.folder.clone(),
            uid: header.uid,
            validity: header.uid_validity,
            local_id: local_id.clone().unwrap_or_default(),
            date,
            pinned,
        });
        result.push(OwnedHeader {
            account_id: account,
            header,
            local_id,
            pinned,
            resurfaced_at,
        });
    }
    let more = result.len() > limit as usize;
    result.truncate(limit as usize);
    cursors.truncate(limit as usize);
    Ok((result, if more { cursors.pop() } else { None }))
}
#[tauri::command]
pub async fn get_unified_inbox(
    app_handle: AppHandle,
    cursor: Option<Cursor>,
    query_text: Option<String>,
    filter: Option<String>,
    account_filter: Option<String>,
    limit: Option<u32>,
) -> Result<Page, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let mut ids: Vec<String> = crate::auth::session::load_profile_metadata(&app_handle)
        .0
        .into_iter()
        .map(|p| p.id)
        .collect();
    if let Some(id) = account_filter {
        if !ids.contains(&id) {
            return Err("Account no longer connected".into());
        }
        ids.retain(|i| i == &id);
    }
    let query_text = query_text.unwrap_or_default();
    if query_text.len() > 1000 {
        return Err("Search is too long".into());
    }
    let filter = filter.unwrap_or_else(|| "all".into());
    if !["all", "unread", "flagged"].contains(&filter.as_str()) {
        return Err("Invalid inbox filter".into());
    }
    tokio::task::spawn_blocking(move||{
   let _work=crate::performance::WorkSpan::new("unified inbox page query");
   let conn=database::open_connection(&app_handle)?;
   conn.execute_batch("CREATE TABLE IF NOT EXISTS mail_pins(account_id TEXT NOT NULL,identity TEXT NOT NULL,PRIMARY KEY(account_id,identity)); CREATE TABLE IF NOT EXISTS mail_snoozes(account_id TEXT NOT NULL,key TEXT NOT NULL,wake_at INTEGER NOT NULL,snapshot TEXT NOT NULL,cutoff INTEGER NOT NULL,state INTEGER NOT NULL DEFAULT 0,seen_uid INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,key));").map_err(|e|e.to_string())?;
   let (messages,next_cursor)=query(&conn,&ids,cursor,&query_text,&filter,limit.unwrap_or(50).clamp(1,100))?;
   let mut tags=std::collections::HashMap::new();for id in ids{tags.insert(id.clone(),database::get_all_tags(&app_handle,&id)?);}
   Ok(Page{messages,next_cursor,tags})
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn sync_unified_inbox(app_handle: AppHandle) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    for profile in crate::auth::session::load_profile_metadata(&app_handle).0 {
        let app = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            match crate::auth::bootstrap::ensure_account(&app, &profile.id).await {
                Ok(account) => {
                    super::sync_manager::enqueue_sync_with_force(
                        app,
                        account,
                        super::folder::MailFolder::Inbox,
                        true,
                    )
                    .await
                }
                Err(error) => {
                    let _ = app.emit(
                        "mail:sync_error",
                        serde_json::json!({"account_id":profile.id,"folder":"inbox","error":error}),
                    );
                }
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,uid_validity INTEGER DEFAULT 9,date INTEGER,subject TEXT DEFAULT 'Subject',sender TEXT DEFAULT 'Sender',seen INTEGER DEFAULT 0,flagged INTEGER DEFAULT 0,snippet TEXT DEFAULT 'Preview',recipient TEXT,thread_id TEXT DEFAULT 'thread',message_id TEXT,has_attachments INTEGER DEFAULT 0);
   CREATE TABLE message_tags(account_id TEXT,folder TEXT,message_uid INTEGER,tag_id TEXT);
   CREATE TABLE mail_location_intents(account_id TEXT,id TEXT,identity TEXT,optimistic INTEGER,deleted INTEGER,desired TEXT,source TEXT);
   CREATE TABLE mail_pins(account_id TEXT,identity TEXT);
   CREATE TABLE mail_snoozes(account_id TEXT,key TEXT,wake_at INTEGER,cutoff INTEGER,state INTEGER,seen_uid INTEGER);
   INSERT INTO messages(account_id,folder,uid,date,message_id) VALUES('a','inbox',1,100,'same'),('b','inbox',1,100,'same'),('a','inbox',2,90,'older'),('a','sent',3,1000,'sent'),('a','trash',4,1000,'trash'),('removed','inbox',99,9999,'private');").unwrap();
        conn
    }
    fn ids() -> Vec<String> {
        vec!["a".into(), "b".into()]
    }
    #[test]
    fn accounts_with_colliding_uids_and_ids_remain_separate_and_cursor_survives_deletion() {
        let conn = fixture();
        let (first, cursor) = query(&conn, &ids(), None, "", "all", 1).unwrap();
        assert_eq!(first[0].account_id, "b");
        assert_eq!(first[0].header.uid, 1);
        conn.execute("DELETE FROM messages WHERE account_id='b'", [])
            .unwrap();
        let (second, cursor) = query(&conn, &ids(), cursor, "", "all", 1).unwrap();
        assert_eq!(second[0].account_id, "a");
        assert_eq!(second[0].header.uid, 1);
        let (third, cursor) = query(&conn, &ids(), cursor, "", "all", 1).unwrap();
        assert_eq!(third[0].header.uid, 2);
        assert!(cursor.is_none());
    }
    #[test]
    fn newest_dates_win_over_uid_order_and_filters_search_all_cached_rows() {
        let conn = fixture();
        conn.execute("UPDATE messages SET date=200,subject='Invoice 100% ready',seen=1,flagged=1 WHERE account_id='a' AND uid=2",[]).unwrap();
        let (rows, _) = query(&conn, &ids(), None, "", "all", 50).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].header.uid, 2);
        let (rows, _) = query(&conn, &ids(), None, "100% ready", "flagged", 50).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].header.uid, 2);
        let (rows, _) = query(&conn, &ids(), None, "", "unread", 50).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(query(&conn, &ids(), None, "private", "all", 50)
            .unwrap()
            .0
            .is_empty());
    }
    #[test]
    fn duplicate_inbox_copies_deduplicate_only_inside_their_owner() {
        let conn = fixture();
        conn.execute("INSERT INTO messages(account_id,folder,uid,date,message_id) VALUES('a','inbox',8,100,'same')",[]).unwrap();
        let (rows, _) = query(&conn, &ids(), None, "", "all", 50).unwrap();
        assert_eq!(rows.len(), 3);
        assert!(rows
            .iter()
            .any(|row| row.account_id == "a" && row.header.uid == 8));
        assert!(rows
            .iter()
            .any(|row| row.account_id == "b" && row.header.uid == 1));
    }
    #[test]
    fn pins_snoozes_and_tag_names_do_not_cross_account_boundaries() {
        let conn = fixture();
        conn.execute(
            "INSERT INTO mail_pins VALUES('a',?1)",
            [serde_json::json!(["id", "same", 100, "Sender", "Subject"]).to_string()],
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO message_tags VALUES('a','inbox',1,'work'),('b','inbox',1,'personal');",
        )
        .unwrap();
        let (rows, _) = query(&conn, &ids(), None, "", "all", 1).unwrap();
        assert_eq!(rows[0].account_id, "a");
        assert!(rows[0].pinned);
        assert_eq!(rows[0].header.tags, vec!["work"]);
        conn.execute(
            "INSERT INTO mail_snoozes VALUES('a',?1,?2,100,0,1)",
            params![
                serde_json::json!(["thread", "thread"]).to_string(),
                chrono::Utc::now().timestamp() + 3600
            ],
        )
        .unwrap();
        let (rows, _) = query(&conn, &ids(), None, "", "all", 50).unwrap();
        assert_eq!(rows.len(), 2);
        let b = rows.iter().find(|r| r.account_id == "b").unwrap();
        assert!(!b.pinned);
        assert_eq!(b.header.tags, vec!["personal"]);
    }
    #[test]
    fn optimistic_moves_hide_sources_and_restore_projects_with_real_identity() {
        let conn = fixture();
        let source = MessageHeader {
            folder: "trash".into(),
            uid: 4,
            uid_validity: 9,
            date: 1000,
            subject: "Restored".into(),
            from: "Sender".into(),
            seen: false,
            flagged: false,
            has_attachments: false,
            snippet: None,
            thread_id: None,
            to: None,
            message_id: Some("trash".into()),
            tags: vec![],
        };
        conn.execute("INSERT INTO mail_location_intents VALUES('a','restore','restore-identity',1,0,'inbox',?1)",[serde_json::to_string(&source).unwrap()]).unwrap();
        conn.execute(
            "INSERT INTO mail_location_intents VALUES('a','move',?1,1,0,'trash','{}')",
            [serde_json::json!(["id", "same", 100, "Sender", "Subject"]).to_string()],
        )
        .unwrap();
        let (rows, _) = query(&conn, &ids(), None, "", "all", 50).unwrap();
        assert_eq!(rows.len(), 3);
        let projected = &rows[0];
        assert_eq!(projected.account_id, "a");
        assert_eq!(projected.header.folder, "trash");
        assert_eq!(projected.header.uid, 4);
        assert_eq!(projected.local_id.as_deref(), Some("restore"));
        assert!(!rows
            .iter()
            .any(|r| r.account_id == "a" && r.header.uid == 1));
    }
}
