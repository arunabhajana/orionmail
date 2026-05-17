use rusqlite::{Connection, Result};
use tauri::AppHandle;
use chrono::Utc;

pub fn init_contacts_db(app_handle: &AppHandle) -> Result<(), String> {
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA mmap_size = 30000000000;
        
        CREATE TABLE IF NOT EXISTS contacts (
            email TEXT PRIMARY KEY,
            display_name TEXT,
            usage_count INTEGER NOT NULL DEFAULT 1,
            last_used INTEGER NOT NULL,
            source TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_contacts_last_used ON contacts(last_used DESC);
        CREATE INDEX IF NOT EXISTS idx_contacts_usage ON contacts(usage_count DESC);
        CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
        CREATE INDEX IF NOT EXISTS idx_contacts_display_name ON contacts(display_name);
        "
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone)]
pub struct ContactEntry {
    pub email: String,
    pub display_name: Option<String>,
    pub source: String,
}

pub fn upsert_contacts(app_handle: &AppHandle, contacts: &[ContactEntry]) -> Result<(), String> {
    if contacts.is_empty() { return Ok(()); }
    
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO contacts (email, display_name, usage_count, last_used, source)
             VALUES (?1, ?2, 1, ?3, ?4)
             ON CONFLICT(email) DO UPDATE SET
                display_name = CASE 
                    WHEN contacts.display_name IS NULL OR LENGTH(excluded.display_name) > LENGTH(contacts.display_name)
                    THEN excluded.display_name
                    ELSE contacts.display_name
                END,
                last_used = MAX(contacts.last_used, excluded.last_used)"
        ).map_err(|e| e.to_string())?;
        
        let now = Utc::now().timestamp();
        
        for c in contacts {
            stmt.execute(rusqlite::params![
                c.email,
                c.display_name,
                now,
                c.source
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn record_usage(app_handle: &AppHandle, emails: &[String]) -> Result<(), String> {
    if emails.is_empty() { return Ok(()); }
    
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let now = Utc::now().timestamp();
    
    let placeholders = emails.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "UPDATE contacts SET usage_count = usage_count + 1, last_used = ?1 WHERE email IN ({})",
        placeholders
    );
    
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&now];
    for e in emails {
        params.push(e);
    }
    
    conn.execute(&query, params.as_slice()).map_err(|e| e.to_string())?;
    
    Ok(())
}
