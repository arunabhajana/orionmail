use super::{Batch, Item};
use crate::mail::database;
use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

pub fn init(app: &AppHandle) -> Result<(), String> {
    let conn = database::open_connection(app)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS mail_notification_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL, display_tag TEXT NOT NULL, items TEXT NOT NULL, created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_mail_notification_account ON mail_notification_snapshots(account_id,id);
    CREATE INDEX IF NOT EXISTS idx_mail_notification_created ON mail_notification_snapshots(created_at);")
        .map_err(|e|e.to_string())?;
    conn.execute(
        "DELETE FROM mail_notification_snapshots WHERE created_at < ?1",
        [chrono::Utc::now().timestamp() - 86400],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, i64)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}
fn decode(row: (String, String, String, String, i64)) -> Result<Batch, String> {
    Ok(Batch {
        token: row.0,
        account_id: row.1,
        display_tag: row.2,
        items: serde_json::from_str(&row.3).map_err(|e| e.to_string())?,
        created_at: row.4,
    })
}
pub fn latest(app: &AppHandle, account: &str) -> Result<Option<Batch>, String> {
    let row=database::open_connection(app)?.query_row("SELECT token,account_id,display_tag,items,created_at FROM mail_notification_snapshots WHERE account_id=?1 ORDER BY id DESC LIMIT 1",[account],read).optional().map_err(|e|e.to_string())?;
    row.map(decode).transpose()
}
pub fn find(app: &AppHandle, token: &str) -> Result<Batch, String> {
    let row=database::open_connection(app)?.query_row("SELECT token,account_id,display_tag,items,created_at FROM mail_notification_snapshots WHERE token=?1 AND created_at>=?2",params![token,chrono::Utc::now().timestamp()-86400],read).optional().map_err(|e|e.to_string())?;
    decode(row.ok_or("This notification expired. Open Inbox to see current mail.")?)
}
pub fn save(app: &AppHandle, batch: &Batch) -> Result<(), String> {
    let conn = database::open_connection(app)?;
    conn.execute(
        "DELETE FROM mail_notification_snapshots WHERE created_at < ?1",
        [chrono::Utc::now().timestamp() - 86400],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO mail_notification_snapshots(token,account_id,display_tag,items,created_at) VALUES(?1,?2,?3,?4,?5)",params![batch.token,batch.account_id,batch.display_tag,serde_json::to_string(&batch.items).map_err(|e|e.to_string())?,batch.created_at]).map_err(|e|e.to_string())?;
    // Only the newest card is visible. Retain a bounded history for in-flight
    // button activations rather than storing every full summary all day.
    conn.execute("DELETE FROM mail_notification_snapshots WHERE account_id=?1 AND id NOT IN(SELECT id FROM mail_notification_snapshots WHERE account_id=?1 ORDER BY id DESC LIMIT 64)",[&batch.account_id]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn unread(app: &AppHandle, account: &str, items: Vec<Item>) -> Result<Vec<Item>, String> {
    let conn = database::open_connection(app)?;
    let prefs=crate::mail_preferences::load(app);
    let mut folders=std::collections::HashMap::<String,Vec<&Item>>::new();
    for item in &items {if prefs.folder_notifications_allowed(&item.folder){folders.entry(item.folder.clone()).or_default().push(item);}}
    let mut present=std::collections::HashSet::new();
    for (folder,items) in folders {
        for chunk in items.chunks(200) {
            let placeholders=vec!["?";chunk.len()].join(",");
            let importance=if prefs.important_only {" AND EXISTS(SELECT 1 FROM message_tags mt JOIN tags t ON t.account_id=mt.account_id AND t.id=mt.tag_id WHERE mt.account_id=messages.account_id AND mt.folder=messages.folder AND mt.message_uid=messages.uid AND t.type='system' AND (lower(t.name)='important' OR lower(t.id)='important'))"}else{""};
            let sql=format!("SELECT uid,uid_validity FROM messages WHERE account_id=? AND folder=? AND seen=0 AND uid IN ({placeholders}){importance}");
            let mut values=vec![rusqlite::types::Value::Text(account.into()),rusqlite::types::Value::Text(folder.clone())];
            values.extend(chunk.iter().map(|item|rusqlite::types::Value::Integer(item.uid as i64)));
            let mut stmt=conn.prepare(&sql).map_err(|e|e.to_string())?;
            let rows=stmt.query_map(rusqlite::params_from_iter(values),|row|Ok((row.get::<_,u32>(0)?,row.get::<_,u32>(1)?))).map_err(|e|e.to_string())?;
            for row in rows {let (uid,validity)=row.map_err(|e|e.to_string())?;present.insert((folder.clone(),uid,validity));}
        }
    }
    Ok(items.into_iter().filter(|item|present.contains(&(item.folder.clone(),item.uid,item.validity))).collect())
}
