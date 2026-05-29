use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::mail::message_list::MessageHeader;

#[derive(Debug, Clone)]
pub struct FolderSyncState {
    pub folder: String,
    pub last_uid: u32,
    pub last_synced_at: i64,
    pub sync_in_progress: bool,
    pub last_full_sync_at: i64,
    pub last_error: Option<String>,
}

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

    // Verify primary key constraint is (folder, uid) to match ON CONFLICT clause
    let mut check_stmt = conn.prepare("PRAGMA table_info(messages)").map_err(|e| e.to_string())?;
    let check_rows = check_stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        let pk: i32 = row.get(5)?;
        Ok((name, pk))
    }).map_err(|e| e.to_string())?;

    let mut pk_cols = Vec::new();
    for row in check_rows {
        if let Ok((name, pk)) = row {
            if pk > 0 {
                pk_cols.push(name);
            }
        }
    }

    if !pk_cols.is_empty() {
        let has_folder = pk_cols.iter().any(|c| c.to_lowercase() == "folder");
        let has_uid = pk_cols.iter().any(|c| c.to_lowercase() == "uid");
        if pk_cols.len() != 2 || !has_folder || !has_uid {
            log::warn!("Mismatched Primary Key in messages table: {:?}. Dropping table for clean recreation.", pk_cols);
            let _ = conn.execute("DROP TABLE IF EXISTS messages", ());
        }
    }

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
            processed_html TEXT,
            PRIMARY KEY (folder, uid)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    // Safe Schema Migration for existing databases
    let mut stmt = conn.prepare("PRAGMA table_info(messages)").unwrap();
    let mut has_processed_html = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "processed_html" {
                has_processed_html = true;
                break;
            }
        }
    }

    if !has_processed_html {
        conn.execute("ALTER TABLE messages ADD COLUMN processed_html TEXT", ()).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(messages)").unwrap();
    let mut has_attachments_json = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "attachments_json" {
                has_attachments_json = true;
                break;
            }
        }
    }

    if !has_attachments_json {
        conn.execute("ALTER TABLE messages ADD COLUMN attachments_json TEXT", ()).map_err(|e| e.to_string())?;
    }


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

    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_sync_state (
            folder TEXT PRIMARY KEY,
            last_uid INTEGER,
            last_synced_at INTEGER,
            sync_in_progress INTEGER DEFAULT 0,
            last_full_sync_at INTEGER,
            last_error TEXT
        )",
        (),
    ).map_err(|e| e.to_string())?;

    // Reset sync_in_progress on startup to avoid permanent soft-locks from previous crashes
    conn.execute("UPDATE folder_sync_state SET sync_in_progress = 0", ()).map_err(|e| e.to_string())?;

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
    load_messages_page(app_handle, "inbox", None, limit as u32)
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

    if folder.to_lowercase() == "starred" {
        // Starred uses date-based sorting and pagination
        let mut query = "SELECT uid, uid_validity, subject, sender, date, seen, flagged, snippet, folder, has_attachments, thread_id
             FROM messages 
             WHERE flagged = 1".to_string();
             
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(uid) = before_uid {
            // Find the date of the before_uid to paginate correctly
            // Note: Since Starred spans folders, finding the exact message by just UID is ambiguous, 
            // but we can assume the client passes a known flagged UID. 
            // A safer approach is to look up its date:
            let date: Option<i64> = conn.query_row(
                "SELECT date FROM messages WHERE uid = ?1 AND flagged = 1 LIMIT 1",
                rusqlite::params![uid],
                |row| row.get(0)
            ).ok();
            
            if let Some(d) = date {
                query.push_str(" AND date < ?1");
                params.push(Box::new(d));
                query.push_str(" ORDER BY date DESC LIMIT ?2");
                params.push(Box::new(limit));
            } else {
                query.push_str(" ORDER BY date DESC LIMIT ?1");
                params.push(Box::new(limit));
            }
        } else {
            query.push_str(" ORDER BY date DESC LIMIT ?1");
            params.push(Box::new(limit));
        }

        // Convert params to refs
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let msg_iter = stmt.query_map(rusqlite::params_from_iter(param_refs), parse_row).map_err(|e| e.to_string())?;
        for msg in msg_iter {
            messages.push(msg.map_err(|e| e.to_string())?);
        }
    } else {
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
    }

    Ok(messages)
}

pub fn get_folder_sync_state(app_handle: &AppHandle, folder: &str) -> Result<Option<FolderSyncState>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error FROM folder_sync_state WHERE folder = ?1").unwrap();
    let state = stmt.query_row([folder], |row| {
        Ok(FolderSyncState {
            folder: row.get(0)?,
            last_uid: row.get(1)?,
            last_synced_at: row.get(2)?,
            sync_in_progress: row.get::<_, i32>(3)? != 0,
            last_full_sync_at: row.get(4)?,
            last_error: row.get(5)?,
        })
    }).ok();

    Ok(state)
}

pub fn update_folder_sync_state(app_handle: &AppHandle, state: &FolderSyncState) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO folder_sync_state (folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            state.folder,
            state.last_uid,
            state.last_synced_at,
            if state.sync_in_progress { 1 } else { 0 },
            state.last_full_sync_at,
            state.last_error
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_sync_in_progress(app_handle: &AppHandle, folder: &str, in_progress: bool) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // We use INSERT OR IGNORE and then UPDATE to ensure the row exists
    conn.execute(
        "INSERT OR IGNORE INTO folder_sync_state (folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error) VALUES (?1, 0, 0, 0, 0, NULL)",
        rusqlite::params![folder],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE folder_sync_state SET sync_in_progress = ?1 WHERE folder = ?2",
        rusqlite::params![if in_progress { 1 } else { 0 }, folder],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_folder_sync_error(app_handle: &AppHandle, folder: &str, error: &str) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE folder_sync_state SET last_error = ?1 WHERE folder = ?2",
        rusqlite::params![error, folder],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub struct SyncProgressGuard {
    app_handle: AppHandle,
    folder: String,
}

impl SyncProgressGuard {
    pub fn new(app_handle: AppHandle, folder: String) -> Result<Self, String> {
        set_sync_in_progress(&app_handle, &folder, true)?;
        Ok(Self { app_handle, folder })
    }
}

impl Drop for SyncProgressGuard {
    fn drop(&mut self) {
        let _ = set_sync_in_progress(&self.app_handle, &self.folder, false);
    }
}


pub fn get_message_body_cache(app_handle: &AppHandle, folder: &str, uid: u32) -> Result<Option<(String, Option<String>)>, String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT processed_html, attachments_json FROM messages WHERE folder = ?1 AND uid = ?2 AND body_fetched = 1 AND processed_html IS NOT NULL").unwrap();
    let result = stmt.query_row(rusqlite::params![folder, uid], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).ok();

    Ok(result)
}

pub fn update_message_body(app_handle: &AppHandle, folder: &str, uid: u32, body: &str, snippet: &str, attachments_json: Option<String>) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET processed_html = ?1, snippet = ?2, attachments_json = ?3, body_fetched = 1 WHERE folder = ?4 AND uid = ?5",
        rusqlite::params![body, snippet, attachments_json, folder, uid],
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

pub fn insert_sent_message(
    app_handle: &AppHandle,
    _sender: &str,
    to: &[String],
    subject: &str,
    plain_body: &str,
    html_body: &str,
) -> Result<(), String> {
    let db_path = get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let folder = "sent";
    let date = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let highest = get_highest_uid(app_handle, folder)?;
    let uid = std::cmp::max(highest + 1, (date % 1000000000) as u32);

    let snippet_text = plain_body.trim();
    let snippet = if snippet_text.chars().count() > 100 {
        let end = snippet_text.char_indices().nth(100).map(|(i, _)| i).unwrap_or(snippet_text.len());
        &snippet_text[..end]
    } else {
        snippet_text
    };

    let to_joined = to.join(", ");

    conn.execute(
        "INSERT INTO messages (folder, uid, subject, sender, date, snippet, processed_html, body_fetched, seen, flagged, uid_validity)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1, 0, 1)",
        rusqlite::params![
            folder,
            uid,
            subject,
            to_joined, // use 'to' for sender column to show recipients in Sent folder list
            date,
            snippet,
            html_body,
        ],
    ).map_err(|e| format!("Failed to insert sent message: {}", e))?;

    Ok(())
}
