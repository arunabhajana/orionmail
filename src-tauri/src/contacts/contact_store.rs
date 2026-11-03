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

    let profiles = crate::auth::session::load_profile_metadata(app_handle).0;
    let owner = if profiles.len() == 1 { Some(profiles[0].id.as_str()) } else { None };
    initialize_ownership(&conn, owner)?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ContactEntry {
    pub email: String,
    pub display_name: Option<String>,
    pub source: String,
}

pub fn upsert_contacts(app_handle: &AppHandle, account: &str, contacts: &[ContactEntry]) -> Result<(), String> {
    if contacts.is_empty() { return Ok(()); }
    
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO account_contacts (email, display_name, usage_count, last_used, source, account_id)
             VALUES (?1, ?2, 1, ?3, ?4, ?5)
             ON CONFLICT(account_id,email) DO UPDATE SET
                display_name = CASE 
                    WHEN account_contacts.display_name IS NULL OR LENGTH(excluded.display_name) > LENGTH(account_contacts.display_name)
                    THEN excluded.display_name
                    ELSE account_contacts.display_name
                END,
                last_used = MAX(account_contacts.last_used, excluded.last_used)"
        ).map_err(|e| e.to_string())?;
        
        let now = Utc::now().timestamp();
        
        for c in contacts {
            stmt.execute(rusqlite::params![
                c.email,
                c.display_name,
                now,
                c.source,
                account
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn record_usage(app_handle: &AppHandle, account: &str, emails: &[String]) -> Result<(), String> {
    if emails.is_empty() { return Ok(()); }
    
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    let now = Utc::now().timestamp();
    
    let placeholders = emails.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "UPDATE account_contacts SET usage_count = usage_count + 1, last_used = ?1 WHERE account_id=?2 AND email IN ({})",
        placeholders
    );
    
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&now, &account];
    for e in emails {
        params.push(e);
    }
    
    conn.execute(&query, params.as_slice()).map_err(|e| e.to_string())?;
    
    Ok(())
}

// Preserve legacy data without assigning another account's contacts to every profile.
fn initialize_ownership(conn: &Connection, legacy_owner: Option<&str>) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS account_contacts (account_id TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT, usage_count INTEGER NOT NULL DEFAULT 1, last_used INTEGER NOT NULL, source TEXT, PRIMARY KEY(account_id,email));
        CREATE INDEX IF NOT EXISTS idx_account_contacts_rank ON account_contacts(account_id,usage_count DESC,last_used DESC);
        CREATE TABLE IF NOT EXISTS contact_ownership_migrations (id INTEGER PRIMARY KEY);").map_err(|e|e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e|e.to_string())?;
    let migrated: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM contact_ownership_migrations WHERE id=1)",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if !migrated {
        if let Some(owner) = legacy_owner {
            tx.execute("INSERT OR IGNORE INTO account_contacts SELECT ?1,email,display_name,usage_count,last_used,source FROM contacts",[owner]).map_err(|e|e.to_string())?;
        }
        tx.execute("INSERT INTO contact_ownership_migrations(id) VALUES(1)",[]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}

#[cfg(test)] mod ownership_tests {
    use super::*;
    #[test] fn legacy_contacts_migrate_once_to_only_the_original_owner() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE contacts(email TEXT,display_name TEXT,usage_count INTEGER,last_used INTEGER,source TEXT);INSERT INTO contacts VALUES('friend@example.com','Friend',2,1,'IMAP');").unwrap();
        initialize_ownership(&conn,Some("a")).unwrap();
        initialize_ownership(&conn,Some("b")).unwrap();
        let count:i64=conn.query_row("SELECT COUNT(*) FROM account_contacts WHERE account_id='b'",[],|row|row.get(0)).unwrap();
        assert_eq!(count,0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM account_contacts WHERE account_id='a'",[],|row|row.get::<_,i64>(0)).unwrap(),1);
    }
    #[test] fn ambiguous_legacy_contacts_are_never_assigned_to_a_later_single_account() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE contacts(email TEXT,display_name TEXT,usage_count INTEGER,last_used INTEGER,source TEXT);INSERT INTO contacts VALUES('private@example.com','Private',1,1,'IMAP');").unwrap();
        initialize_ownership(&conn,None).unwrap(); initialize_ownership(&conn,Some("b")).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM account_contacts",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }
}
