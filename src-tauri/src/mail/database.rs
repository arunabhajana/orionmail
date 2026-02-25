use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::mail::message_list::MessageHeader;

pub fn get_db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve App Data Dir: {}", e))?;
        
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create DB directory: {}", e))?;
        
    Ok(app_dir.join("orbitmail.db"))
}

pub fn init_db(app_handle: &AppHandle) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            folder TEXT NOT NULL,
            uid INTEGER NOT NULL,
            uid_validity INTEGER, -- Left for generic IMAP parity
            subject TEXT,
            sender TEXT,
            date INTEGER NOT NULL,
            snippet TEXT,
            body TEXT,
            seen INTEGER DEFAULT 0,
            flagged INTEGER DEFAULT 0,
            has_attachments INTEGER DEFAULT 0,
            thread_id TEXT,
            body_fetched INTEGER DEFAULT 0,
            PRIMARY KEY (folder, uid)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    // Performance Indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_folder_uid_desc ON messages(folder, uid DESC)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_folder_date ON messages(folder, date DESC)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(seen)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_flagged ON messages(flagged)", ()).map_err(|e| e.to_string())?;

    // FTS5 Setup
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            subject,
            sender,
            snippet,
            content='messages',
            content_rowid='rowid'
        )",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, subject, sender, snippet)
            VALUES (new.rowid, new.subject, new.sender, new.snippet);
        END",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS mailbox_state (
            mailbox TEXT PRIMARY KEY,
            uid_validity INTEGER
        )",
        (),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_mailbox_validity(app_handle: &AppHandle, mailbox: &str) -> Result<Option<u32>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT uid_validity FROM mailbox_state WHERE mailbox = ?1").unwrap();
    let validity = stmt.query_row([mailbox], |row| row.get(0)).ok();

    Ok(validity)
}

pub fn update_mailbox_validity(app_handle: &AppHandle, mailbox: &str, validity: u32) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO mailbox_state (mailbox, uid_validity) VALUES (?1, ?2)",
        rusqlite::params![mailbox, validity],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn clear_messages(app_handle: &AppHandle, folder: &str) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM messages WHERE folder = ?1", rusqlite::params![folder]).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_highest_uid(app_handle: &AppHandle, folder: &str) -> Result<u32, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT MAX(uid) FROM messages WHERE folder = ?1").unwrap();
    let max_uid: Option<u32> = stmt.query_row(rusqlite::params![folder], |row| row.get(0)).unwrap_or(None);

    Ok(max_uid.unwrap_or(0))
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
            "INSERT INTO messages (folder, uid, uid_validity, subject, sender, date, seen, flagged, snippet)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(folder, uid) DO UPDATE SET
                subject = excluded.subject,
                sender = excluded.sender,
                date = excluded.date,
                seen = excluded.seen,
                flagged = excluded.flagged,
                snippet = excluded.snippet"
        ).map_err(|e| e.to_string())?;

        for msg in messages {
            stmt.execute(rusqlite::params![
                msg.folder,
                msg.uid,
                msg.uid_validity,
                msg.subject,
                msg.from,
                msg.date,
                if msg.seen { 1 } else { 0 },
                if msg.flagged { 1 } else { 0 },
                msg.snippet.as_deref().unwrap_or(""),
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_cached_messages(app_handle: &AppHandle, limit: usize) -> Result<Vec<MessageHeader>, String> {
    load_messages_page(app_handle, "INBOX", None, limit as u32)
}

pub fn load_messages_page(app_handle: &AppHandle, folder: &str, before_uid: Option<u32>, limit: u32) -> Result<Vec<MessageHeader>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let parse_row = |row: &rusqlite::Row| -> rusqlite::Result<MessageHeader> {
        Ok(MessageHeader {
            uid: row.get(0)?,
            uid_validity: row.get(1)?,
            subject: row.get(2)?,
            from: row.get(3)?,
            date: row.get(4)?,
            seen: row.get::<_, i32>(5)? != 0,
            flagged: row.get::<_, i32>(6)? != 0,
            snippet: row.get(7).unwrap_or(None),
            folder: row.get(8).unwrap_or_else(|_| "INBOX".to_string()),
            has_attachments: row.get::<_, i32>(9).unwrap_or(0) != 0,
            thread_id: row.get(10).unwrap_or(None),
        })
    };

    let mut messages = Vec::new();

    if let Some(uid) = before_uid {
        let mut stmt = conn.prepare(
            "SELECT uid, uid_validity, subject, sender, date, seen, flagged, snippet, folder, has_attachments, thread_id
             FROM messages 
             WHERE folder = ?1 AND uid < ?2
             ORDER BY uid DESC 
             LIMIT ?3"
        ).map_err(|e| e.to_string())?;

        let msg_iter = stmt.query_map(rusqlite::params![folder, uid, limit], parse_row).map_err(|e| e.to_string())?;
        for msg in msg_iter {
            messages.push(msg.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT uid, uid_validity, subject, sender, date, seen, flagged, snippet, folder, has_attachments, thread_id
             FROM messages 
             WHERE folder = ?1
             ORDER BY uid DESC 
             LIMIT ?2"
        ).map_err(|e| e.to_string())?;

        let msg_iter = stmt.query_map(rusqlite::params![folder, limit], parse_row).map_err(|e| e.to_string())?;
        for msg in msg_iter {
            messages.push(msg.map_err(|e| e.to_string())?);
        }
    }

    Ok(messages)
}


pub fn get_message_body_cache(app_handle: &AppHandle, folder: &str, uid: u32) -> Result<Option<String>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT body FROM messages WHERE folder = ?1 AND uid = ?2 AND body_fetched = 1").unwrap();
    let body: Option<String> = stmt.query_row(rusqlite::params![folder, uid], |row| row.get(0)).ok();

    Ok(body)
}

pub fn update_message_body(app_handle: &AppHandle, folder: &str, uid: u32, body: &str, snippet: &str) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET body = ?1, snippet = ?2, body_fetched = 1 WHERE folder = ?3 AND uid = ?4",
        rusqlite::params![body, snippet, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_unfetched_recent_uids(app_handle: &AppHandle, folder: &str, limit: u32) -> Result<Vec<u32>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT uid FROM messages 
         WHERE folder = ?1 AND body_fetched = 0 AND uid > (SELECT MAX(uid) - 200 FROM messages WHERE folder = ?1) 
         ORDER BY uid DESC LIMIT ?2"
    ).unwrap();

    let uid_iter = stmt.query_map(rusqlite::params![folder, limit], |row| {
        Ok(row.get(0)?)
    }).map_err(|e| e.to_string())?;

    let mut uids = Vec::new();
    for u in uid_iter {
        uids.push(u.map_err(|e| e.to_string())?);
    }

    Ok(uids)
}

pub fn is_message_seen(app_handle: &AppHandle, folder: &str, uid: u32) -> Result<bool, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT seen FROM messages WHERE folder = ?1 AND uid = ?2").unwrap();
    let seen: Option<i32> = stmt.query_row(rusqlite::params![folder, uid], |row| row.get(0)).ok();

    Ok(seen.unwrap_or(0) != 0)
}

pub fn set_message_seen(app_handle: &AppHandle, folder: &str, uid: u32, seen: bool) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET seen = ?1 WHERE folder = ?2 AND uid = ?3",
        rusqlite::params![if seen { 1 } else { 0 }, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_message_flagged(app_handle: &AppHandle, folder: &str, uid: u32, flagged: bool) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET flagged = ?1 WHERE folder = ?2 AND uid = ?3",
        rusqlite::params![if flagged { 1 } else { 0 }, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_message_local(app_handle: &AppHandle, folder: &str, uid: u32) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM messages WHERE folder = ?1 AND uid = ?2",
        rusqlite::params![folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}
