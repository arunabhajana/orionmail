use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::mail::message_list::MessageHeader;

pub fn get_db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join("orbitmail.db"))
}

pub fn init_db(app_handle: &AppHandle) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            uid INTEGER NOT NULL,
            uid_validity INTEGER NOT NULL,
            subject TEXT,
            sender TEXT,
            date TEXT,
            seen INTEGER,
            flagged INTEGER,
            PRIMARY KEY(uid, uid_validity)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn insert_or_update_messages(app_handle: &AppHandle, messages: &[MessageHeader]) -> Result<(), String> {
    if messages.is_empty() {
        return Ok(());
    }

    let db_path = get_db_path(app_handle)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO messages (uid, uid_validity, subject, sender, date, seen, flagged)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        ).map_err(|e| e.to_string())?;

        for msg in messages {
            stmt.execute(rusqlite::params![
                msg.uid,
                msg.uid_validity,
                msg.subject,
                msg.from,
                msg.date,
                if msg.seen { 1 } else { 0 },
                if msg.flagged { 1 } else { 0 },
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_cached_messages(app_handle: &AppHandle, limit: usize) -> Result<Vec<MessageHeader>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT uid, uid_validity, subject, sender, date, seen, flagged 
         FROM messages 
         ORDER BY uid DESC 
         LIMIT ?"
    ).map_err(|e| e.to_string())?;

    let msg_iter = stmt.query_map([limit as i64], |row| {
        Ok(MessageHeader {
            uid: row.get(0)?,
            uid_validity: row.get(1)?,
            subject: row.get(2)?,
            from: row.get(3)?,
            date: row.get(4)?,
            seen: row.get::<_, i32>(5)? != 0,
            flagged: row.get::<_, i32>(6)? != 0,
        })
    }).map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for msg in msg_iter {
        messages.push(msg.map_err(|e| e.to_string())?);
    }

    Ok(messages)
}
