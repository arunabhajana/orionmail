use rusqlite::{Connection, Result, OptionalExtension};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::mail::message_list::MessageHeader;

#[derive(Debug, Clone, Default)]
pub struct FolderSyncState {
    pub account_id: String,
    pub folder: String,
    pub last_uid: u32,
    pub last_synced_at: i64,
    pub sync_in_progress: bool,
    pub last_full_sync_at: i64,
    pub last_error: Option<String>,
    pub uid_validity: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Default)]
pub struct GlobalSyncState {
    pub last_sync_at: Option<i64>,
    pub last_successful_idle_at: Option<i64>,
    pub last_notification_at: Option<i64>,
    pub last_sync_error: Option<String>,
    pub last_tag_sync_at: Option<i64>,
}

const LEGACY_ACCOUNT_SCOPE: &str = "legacy-unassigned";

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    ).map_err(|e| e.to_string())
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<(String, i32)>, String> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| e.to_string())?;
    let columns = stmt.query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, i32>(5)?)))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(columns)
}

fn is_account_scoped(conn: &Connection, table: &str, expected_primary_key: &[&str]) -> Result<bool, String> {
    if !table_exists(conn, table)? { return Ok(false); }
    let columns = table_columns(conn, table)?;
    let mut primary_key: Vec<(i32, String)> = columns.iter()
        .filter(|(_, ordinal)| *ordinal > 0)
        .map(|(name, ordinal)| (*ordinal, name.to_lowercase()))
        .collect();
    primary_key.sort_by_key(|(ordinal, _)| *ordinal);
    let expected: Vec<String> = expected_primary_key.iter().map(|name| name.to_string()).collect();
    Ok(columns.iter().any(|(name, _)| name.eq_ignore_ascii_case("account_id"))
        && primary_key.into_iter().map(|(_, name)| name).collect::<Vec<_>>() == expected)
}

fn account_expression(columns: &[(String, i32)]) -> String {
    if columns.iter().any(|(name, _)| name.eq_ignore_ascii_case("account_id")) {
        "COALESCE(account_id, ?1)".to_string()
    } else {
        "?1".to_string()
    }
}

fn migrate_account_scoped_schema(conn: &mut Connection, legacy_account_id: &str) -> Result<(), String> {
    let messages_need_migration = table_exists(conn, "messages")?
        && !is_account_scoped(conn, "messages", &["account_id", "folder", "uid"])?;
    let mailbox_needs_migration = table_exists(conn, "mailbox_state")?
        && !is_account_scoped(conn, "mailbox_state", &["account_id", "mailbox"])?;
    let folders_need_migration = table_exists(conn, "folder_sync_state")?
        && !is_account_scoped(conn, "folder_sync_state", &["account_id", "folder"])?;
    let global_needs_migration = table_exists(conn, "global_sync_state")?
        && !is_account_scoped(conn, "global_sync_state", &["account_id"])?;
    let tags_need_migration = if table_exists(conn, "message_tags")? {
        let sql: String = conn.query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_tags'",
            [], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        !sql.to_lowercase().contains("foreign key (account_id, folder, message_uid)")
    } else { false };

    if !(messages_need_migration || mailbox_needs_migration || folders_need_migration || global_needs_migration || tags_need_migration) {
        return Ok(());
    }

    conn.pragma_update(None, "foreign_keys", "OFF").map_err(|e| e.to_string())?;
    let migration = (|| -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute_batch("DROP TRIGGER IF EXISTS messages_ai; DROP TRIGGER IF EXISTS messages_au; DROP TRIGGER IF EXISTS messages_ad; DROP TABLE IF EXISTS messages_fts_v2; DROP TABLE IF EXISTS messages_fts;")
            .map_err(|e| e.to_string())?;

        if messages_need_migration {
            let columns = table_columns(&tx, "messages")?;
            if !columns.iter().any(|(name, _)| name.eq_ignore_ascii_case("folder"))
                || !columns.iter().any(|(name, _)| name.eq_ignore_ascii_case("uid"))
            {
                return Err("Cannot migrate cached messages: folder or UID column is missing".to_string());
            }
            tx.execute_batch("ALTER TABLE messages RENAME TO messages_legacy_account_scope;")
                .map_err(|e| e.to_string())?;
            tx.execute_batch("CREATE TABLE messages (
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                uid INTEGER NOT NULL,
                uid_validity INTEGER,
                subject TEXT,
                sender TEXT,
                recipient TEXT,
                date INTEGER NOT NULL DEFAULT 0,
                snippet TEXT,
                body TEXT,
                seen INTEGER DEFAULT 0,
                flagged INTEGER DEFAULT 0,
                has_attachments INTEGER DEFAULT 0,
                thread_id TEXT,
                body_fetched INTEGER DEFAULT 0,
                processed_html TEXT,
                attachments_json TEXT,
                extracted_data TEXT,
                message_id TEXT,
                PRIMARY KEY (account_id, folder, uid)
            );")
                .map_err(|e| e.to_string())?;

            let legacy_columns = table_columns(&tx, "messages_legacy_account_scope")?;
            let value = |name: &str, default: &str| -> String {
                if legacy_columns.iter().any(|(column, _)| column.eq_ignore_ascii_case(name)) { name.to_string() } else { default.to_string() }
            };
            let account = account_expression(&legacy_columns);
            let insert = format!("INSERT INTO messages (
                    account_id, folder, uid, uid_validity, subject, sender, recipient, date, snippet, body,
                    seen, flagged, has_attachments, thread_id, body_fetched, processed_html, attachments_json,
                    extracted_data, message_id
                ) SELECT {account}, folder, uid, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
                FROM messages_legacy_account_scope",
                value("uid_validity", "NULL"), value("subject", "NULL"), value("sender", "NULL"),
                value("recipient", "NULL"), value("date", "0"), value("snippet", "NULL"),
                value("body", "NULL"), value("seen", "0"), value("flagged", "0"),
                value("has_attachments", "0"), value("thread_id", "NULL"), value("body_fetched", "0"),
                value("processed_html", "NULL"), value("attachments_json", "NULL"),
                value("extracted_data", "NULL"), value("message_id", "NULL"));
            tx.execute(&insert, [legacy_account_id]).map_err(|e| format!("Could not preserve cached messages during account-scope migration: {e}"))?;
            tx.execute_batch("DROP TABLE messages_legacy_account_scope;").map_err(|e| e.to_string())?;
        } else if !table_exists(&tx, "messages")? {
            tx.execute_batch("CREATE TABLE messages (
                account_id TEXT NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL, uid_validity INTEGER,
                subject TEXT, sender TEXT, recipient TEXT, date INTEGER NOT NULL DEFAULT 0, snippet TEXT,
                body TEXT, seen INTEGER DEFAULT 0, flagged INTEGER DEFAULT 0, has_attachments INTEGER DEFAULT 0,
                thread_id TEXT, body_fetched INTEGER DEFAULT 0, processed_html TEXT, attachments_json TEXT,
                extracted_data TEXT, message_id TEXT, PRIMARY KEY (account_id, folder, uid)
            );").map_err(|e| e.to_string())?;
        }

        if table_exists(&tx, "mailbox_state")? && mailbox_needs_migration {
            let columns = table_columns(&tx, "mailbox_state")?;
            tx.execute_batch("ALTER TABLE mailbox_state RENAME TO mailbox_state_legacy_account_scope;
                CREATE TABLE mailbox_state (account_id TEXT NOT NULL, mailbox TEXT NOT NULL, uid_validity INTEGER, PRIMARY KEY (account_id, mailbox));")
                .map_err(|e| e.to_string())?;
            let account = account_expression(&columns);
            tx.execute(&format!("INSERT OR REPLACE INTO mailbox_state (account_id, mailbox, uid_validity) SELECT {account}, mailbox, uid_validity FROM mailbox_state_legacy_account_scope"), [legacy_account_id])
                .map_err(|e| e.to_string())?;
            tx.execute_batch("DROP TABLE mailbox_state_legacy_account_scope;").map_err(|e| e.to_string())?;
        }

        if table_exists(&tx, "folder_sync_state")? && folders_need_migration {
            let columns = table_columns(&tx, "folder_sync_state")?;
            tx.execute_batch("ALTER TABLE folder_sync_state RENAME TO folder_sync_state_legacy_account_scope;
                CREATE TABLE folder_sync_state (
                    account_id TEXT NOT NULL, folder TEXT NOT NULL, last_uid INTEGER, last_synced_at INTEGER,
                    sync_in_progress INTEGER DEFAULT 0, last_full_sync_at INTEGER, last_error TEXT,
                    PRIMARY KEY (account_id, folder)
                );").map_err(|e| e.to_string())?;
            let account = account_expression(&columns);
            let value = |name: &str, default: &str| -> String {
                if columns.iter().any(|(column, _)| column.eq_ignore_ascii_case(name)) { name.to_string() } else { default.to_string() }
            };
            tx.execute(&format!("INSERT OR REPLACE INTO folder_sync_state (account_id, folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error)
                SELECT {account}, folder, {}, {}, {}, {}, {} FROM folder_sync_state_legacy_account_scope",
                value("last_uid", "0"), value("last_synced_at", "0"), value("sync_in_progress", "0"),
                value("last_full_sync_at", "0"), value("last_error", "NULL")), [legacy_account_id])
                .map_err(|e| e.to_string())?;
            tx.execute_batch("DROP TABLE folder_sync_state_legacy_account_scope;").map_err(|e| e.to_string())?;
        }

        if table_exists(&tx, "global_sync_state")? && global_needs_migration {
            let columns = table_columns(&tx, "global_sync_state")?;
            tx.execute_batch("ALTER TABLE global_sync_state RENAME TO global_sync_state_legacy_account_scope;
                CREATE TABLE global_sync_state (
                    account_id TEXT PRIMARY KEY, last_sync_at INTEGER, last_successful_idle_at INTEGER,
                    last_notification_at INTEGER, last_sync_error TEXT, last_tag_sync_at INTEGER
                );").map_err(|e| e.to_string())?;
            let account = account_expression(&columns);
            let value = |name: &str| -> String {
                if columns.iter().any(|(column, _)| column.eq_ignore_ascii_case(name)) { name.to_string() } else { "NULL".to_string() }
            };
            tx.execute(&format!("INSERT OR REPLACE INTO global_sync_state (account_id, last_sync_at, last_successful_idle_at, last_notification_at, last_sync_error, last_tag_sync_at)
                SELECT {account}, {}, {}, {}, {}, {} FROM global_sync_state_legacy_account_scope",
                value("last_sync_at"), value("last_successful_idle_at"), value("last_notification_at"),
                value("last_sync_error"), value("last_tag_sync_at")), [legacy_account_id])
                .map_err(|e| e.to_string())?;
            tx.execute_batch("DROP TABLE global_sync_state_legacy_account_scope;").map_err(|e| e.to_string())?;
        }

        if table_exists(&tx, "message_tags")? && tags_need_migration {
            tx.execute_batch("ALTER TABLE message_tags RENAME TO message_tags_legacy_account_scope;
                CREATE TABLE message_tags (
                    account_id TEXT NOT NULL, folder TEXT NOT NULL, message_uid INTEGER NOT NULL, tag_id TEXT NOT NULL,
                    PRIMARY KEY (account_id, folder, message_uid, tag_id),
                    FOREIGN KEY (account_id, folder, message_uid) REFERENCES messages(account_id, folder, uid) ON DELETE CASCADE
                );")
                .map_err(|e| e.to_string())?;
            tx.execute_batch("INSERT OR IGNORE INTO message_tags (account_id, folder, message_uid, tag_id)
                SELECT old.account_id, old.folder, old.message_uid, old.tag_id
                FROM message_tags_legacy_account_scope old
                JOIN messages m ON m.account_id = old.account_id AND m.folder = old.folder AND m.uid = old.message_uid;
                DROP TABLE message_tags_legacy_account_scope;")
                .map_err(|e| e.to_string())?;
        }

        if table_exists(&tx, "app_metadata")? {
            tx.execute("UPDATE app_metadata SET value = '1' WHERE key = 'fts_version'", [])
                .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())
    })();
    let enable_foreign_keys = conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string());
    migration?;
    enable_foreign_keys?;
    Ok(())
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

pub(crate) fn open_connection(app_handle: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(get_db_path(app_handle)?).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    Ok(conn)
}

#[cfg(test)]
mod account_scope_tests {
    use super::*;

    #[test]
    fn legacy_message_migration_preserves_rows_in_isolated_account_scope() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages (folder TEXT NOT NULL, uid INTEGER NOT NULL, subject TEXT, PRIMARY KEY(folder, uid));
            INSERT INTO messages (folder, uid, subject) VALUES ('inbox', 42, 'legacy mail');
            CREATE TABLE mailbox_state (mailbox TEXT PRIMARY KEY, uid_validity INTEGER);
            INSERT INTO mailbox_state (mailbox, uid_validity) VALUES ('INBOX', 7);
            CREATE TABLE folder_sync_state (folder TEXT PRIMARY KEY, last_uid INTEGER, last_synced_at INTEGER);
            INSERT INTO folder_sync_state (folder, last_uid, last_synced_at) VALUES ('inbox', 42, 100);")
            .unwrap();

        migrate_account_scoped_schema(&mut conn, LEGACY_ACCOUNT_SCOPE).unwrap();

        assert!(is_account_scoped(&conn, "messages", &["account_id", "folder", "uid"]).unwrap());
        assert!(is_account_scoped(&conn, "mailbox_state", &["account_id", "mailbox"]).unwrap());
        assert!(is_account_scoped(&conn, "folder_sync_state", &["account_id", "folder"]).unwrap());
        let legacy: (String, String) = conn.query_row(
            "SELECT account_id, subject FROM messages WHERE folder = 'inbox' AND uid = 42",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(legacy, (LEGACY_ACCOUNT_SCOPE.to_string(), "legacy mail".to_string()));

        // Colliding mailbox/UID identities remain isolated and independently insertable.
        conn.execute("INSERT INTO messages (account_id, folder, uid) VALUES ('account-a', 'inbox', 42)", []).unwrap();
        conn.execute("INSERT INTO messages (account_id, folder, uid) VALUES ('account-b', 'inbox', 42)", []).unwrap();
        let account_rows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE folder = 'inbox' AND uid = 42 AND account_id IN ('account-a', 'account-b')",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(account_rows, 2);

        conn.execute("INSERT INTO mailbox_state (account_id, mailbox, uid_validity) VALUES ('account-a', 'INBOX', 21)", []).unwrap();
        conn.execute("INSERT INTO mailbox_state (account_id, mailbox, uid_validity) VALUES ('account-b', 'INBOX', 22)", []).unwrap();
        conn.execute("INSERT INTO folder_sync_state (account_id, folder, last_uid) VALUES ('account-a', 'inbox', 10)", []).unwrap();
        conn.execute("INSERT INTO folder_sync_state (account_id, folder, last_uid) VALUES ('account-b', 'inbox', 99)", []).unwrap();
        let sync_state_rows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM folder_sync_state WHERE folder = 'inbox' AND account_id IN ('account-a', 'account-b')",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(sync_state_rows, 2);
    }

    #[test]
    fn account_scoping_detects_legacy_primary_keys() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE folder_sync_state (folder TEXT PRIMARY KEY, last_uid INTEGER);").unwrap();
        assert!(!is_account_scoped(&conn, "folder_sync_state", &["account_id", "folder"]).unwrap());
    }
}

fn migrate_reconciliation_identity(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if !table_columns(&tx, "folder_sync_state")?.iter().any(|(name, _)| name == "uid_validity") {
        tx.execute("ALTER TABLE folder_sync_state ADD COLUMN uid_validity INTEGER", ()).map_err(|e| e.to_string())?;
        tx.execute_batch("UPDATE folder_sync_state SET uid_validity = (
            SELECT CASE WHEN MIN(m.uid_validity) = MAX(m.uid_validity) AND COUNT(*) = COUNT(m.uid_validity)
            THEN MIN(m.uid_validity) END FROM messages m
            WHERE m.account_id = folder_sync_state.account_id AND m.folder = folder_sync_state.folder);")
            .map_err(|e| e.to_string())?;
    }
    if !table_columns(&tx, "pending_message_actions")?.iter().any(|(name, _)| name == "uid_validity") {
        tx.execute("ALTER TABLE pending_message_actions ADD COLUMN uid_validity INTEGER", ()).map_err(|e| e.to_string())?;
        tx.execute_batch("UPDATE pending_message_actions SET uid_validity = (
            SELECT m.uid_validity FROM messages m WHERE m.account_id = pending_message_actions.account_id
            AND m.folder = pending_message_actions.folder AND m.uid = pending_message_actions.uid);
            UPDATE pending_message_actions SET last_error = 'CONFLICT: Message UIDVALIDITY is unavailable; refresh before retrying'
            WHERE uid_validity IS NULL OR uid_validity = 0;").map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod reconciliation_identity_tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,uid_validity INTEGER);
            CREATE TABLE folder_sync_state(account_id TEXT,folder TEXT,last_uid INTEGER);
            CREATE TABLE pending_message_actions(account_id TEXT,folder TEXT,uid INTEGER,last_error TEXT);
            INSERT INTO messages VALUES ('a','inbox',1,7),('a','inbox',2,7),('b','inbox',1,8);
            INSERT INTO folder_sync_state VALUES ('a','inbox',2),('b','inbox',1),('a','tag:empty',100);
            INSERT INTO pending_message_actions VALUES ('a','inbox',1,NULL),('a','inbox',99,NULL);").unwrap();
        conn
    }
    #[test]
    fn binds_existing_cursors_and_actions_without_crossing_accounts_or_losing_mail() {
        let conn = fixture();
        migrate_reconciliation_identity(&conn).unwrap();
        migrate_reconciliation_identity(&conn).unwrap();
        let epoch = |account: &str, folder: &str| conn.query_row("SELECT uid_validity FROM folder_sync_state WHERE account_id=?1 AND folder=?2", rusqlite::params![account,folder], |r| r.get::<_,Option<u32>>(0)).unwrap();
        assert_eq!(epoch("a","inbox"),Some(7));
        assert_eq!(epoch("b","inbox"),Some(8));
        assert_eq!(epoch("a","tag:empty"),None);
        assert_eq!(conn.query_row("SELECT uid_validity FROM pending_message_actions WHERE uid=1",[],|r|r.get::<_,u32>(0)).unwrap(),7);
        assert!(conn.query_row("SELECT last_error FROM pending_message_actions WHERE uid=99",[],|r|r.get::<_,String>(0)).unwrap().starts_with("CONFLICT:"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM messages",[],|r|r.get::<_,i64>(0)).unwrap(),3);
    }
    #[test]
    fn identity_migration_rolls_back_both_columns_if_backfill_fails() {
        let conn = fixture();
        conn.execute_batch("CREATE TRIGGER fail_backfill BEFORE UPDATE ON pending_message_actions BEGIN SELECT RAISE(FAIL,'simulated failure'); END;").unwrap();
        assert!(migrate_reconciliation_identity(&conn).is_err());
        assert!(!table_columns(&conn,"folder_sync_state").unwrap().iter().any(|(name,_)|name=="uid_validity"));
        assert!(!table_columns(&conn,"pending_message_actions").unwrap().iter().any(|(name,_)|name=="uid_validity"));
    }
}

pub fn init_db(app_handle: &AppHandle) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    // Legacy message rows have no trustworthy owner. Keep them in an isolated
    // migration scope instead of assigning them to whichever account is active
    // on startup and potentially exposing another account's cached mail.
    let migration_account = LEGACY_ACCOUNT_SCOPE.to_string();
    migrate_account_scoped_schema(&mut conn, &migration_account)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            account_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            uid INTEGER NOT NULL,
            uid_validity INTEGER, -- Left for generic IMAP parity
            subject TEXT,
            sender TEXT,
            recipient TEXT,
            date INTEGER NOT NULL,
            snippet TEXT,
            body TEXT,
            seen INTEGER DEFAULT 0,
            flagged INTEGER DEFAULT 0,
            has_attachments INTEGER DEFAULT 0,
            thread_id TEXT,
            body_fetched INTEGER DEFAULT 0,
            processed_html TEXT,
            message_id TEXT,
            PRIMARY KEY (account_id, folder, uid)
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

    let mut stmt = conn.prepare("PRAGMA table_info(messages)").unwrap();
    let mut has_recipient = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "recipient" {
                has_recipient = true;
                break;
            }
        }
    }

    if !has_recipient {
        conn.execute("ALTER TABLE messages ADD COLUMN recipient TEXT", ()).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(messages)").unwrap();
    let mut has_extracted_data = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "extracted_data" {
                has_extracted_data = true;
                break;
            }
        }
    }

    if !has_extracted_data {
        conn.execute("ALTER TABLE messages ADD COLUMN extracted_data TEXT", ()).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare("PRAGMA table_info(messages)").unwrap();
    let mut has_message_id = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "message_id" {
                has_message_id = true;
                break;
            }
        }
    }

    if !has_message_id {
        conn.execute("ALTER TABLE messages ADD COLUMN message_id TEXT", ()).map_err(|e| e.to_string())?;
    }

    // Performance Indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_folder_uid_desc ON messages(account_id, folder, uid DESC)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_folder_date ON messages(account_id, folder, date DESC)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_thread ON messages(account_id, thread_id)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_seen ON messages(account_id, seen)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_flagged ON messages(account_id, flagged)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account_message_id ON messages(account_id, message_id)", ()).map_err(|e| e.to_string())?;

    // FTS5 Setup & Resumable Contentless FTS Migration
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        (),
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT value FROM app_metadata WHERE key = 'fts_version'").unwrap();
    let fts_version: Option<String> = stmt.query_row([], |row| row.get(0)).ok();
    let fts_version_num: u32 = fts_version.and_then(|v| v.parse().ok()).unwrap_or(1);

    if fts_version_num < 3 {
        log::info!("Performing resumable FTS migration to fts_version 3...");
        let _ = conn.execute("DROP TABLE IF EXISTS messages_fts_v2", ());
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_v2 USING fts5(
                account_id UNINDEXED,
                subject,
                sender,
                recipient,
                body,
                attachment_names,
                content='messages',
                content_rowid='rowid'
            )",
            (),
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO messages_fts_v2(rowid, account_id, subject, sender, recipient, body, attachment_names)
             SELECT rowid, account_id, subject, sender, recipient, coalesce(body, snippet, ''), coalesce(attachments_json, '') FROM messages",
            (),
        ).map_err(|e| format!("Failed to rebuild the local mail search index: {e}"))?;

        let _ = conn.execute("DROP TABLE IF EXISTS messages_fts", ());
        conn.execute("ALTER TABLE messages_fts_v2 RENAME TO messages_fts", ()).map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('fts_version', '3')", ()).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                account_id UNINDEXED,
                subject,
                sender,
                recipient,
                body,
                attachment_names,
                content='messages',
                content_rowid='rowid'
            )",
            (),
        ).map_err(|e| e.to_string())?;
    }

    let _ = conn.execute("DROP TRIGGER IF EXISTS messages_ai", ());
    let _ = conn.execute("DROP TRIGGER IF EXISTS messages_au", ());
    let _ = conn.execute("DROP TRIGGER IF EXISTS messages_ad", ());

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, account_id, subject, sender, recipient, body, attachment_names)
            VALUES (new.rowid, new.account_id, new.subject, new.sender, new.recipient, coalesce(new.body, new.snippet, ''), coalesce(new.attachments_json, ''));
        END",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, account_id, subject, sender, recipient, body, attachment_names)
            VALUES ('delete', old.rowid, old.account_id, old.subject, old.sender, old.recipient, coalesce(old.body, old.snippet, ''), coalesce(old.attachments_json, ''));
            INSERT INTO messages_fts(rowid, account_id, subject, sender, recipient, body, attachment_names)
            VALUES (new.rowid, new.account_id, new.subject, new.sender, new.recipient, coalesce(new.body, new.snippet, ''), coalesce(new.attachments_json, ''));
        END",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, account_id, subject, sender, recipient, body, attachment_names)
            VALUES ('delete', old.rowid, old.account_id, old.subject, old.sender, old.recipient, coalesce(old.body, old.snippet, ''), coalesce(old.attachments_json, ''));
        END",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS mailbox_state (
            account_id TEXT NOT NULL,
            mailbox TEXT NOT NULL,
            uid_validity INTEGER,
            PRIMARY KEY (account_id, mailbox)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_sync_state (
            account_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            last_uid INTEGER,
            last_synced_at INTEGER,
            sync_in_progress INTEGER DEFAULT 0,
            last_full_sync_at INTEGER,
            last_error TEXT,
            PRIMARY KEY (account_id, folder)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS global_sync_state (
            account_id TEXT PRIMARY KEY,
            last_sync_at INTEGER,
            last_successful_idle_at INTEGER,
            last_notification_at INTEGER,
            last_sync_error TEXT,
            last_tag_sync_at INTEGER
        )",
        (),
    ).map_err(|e| e.to_string())?;


    let mut stmt = conn.prepare("PRAGMA table_info(global_sync_state)").unwrap();
    let mut has_last_tag_sync_at = false;
    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).unwrap();

    for name in rows {
        if let Ok(col_name) = name {
            if col_name == "last_tag_sync_at" {
                has_last_tag_sync_at = true;
                break;
            }
        }
    }

    if !has_last_tag_sync_at {
        conn.execute("ALTER TABLE global_sync_state ADD COLUMN last_tag_sync_at INTEGER", ()).map_err(|e| e.to_string())?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            account_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            bg_color TEXT,
            text_color TEXT,
            provider TEXT NOT NULL,
            updated_at INTEGER,
            PRIMARY KEY (account_id, id)
        )",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS message_tags (
            account_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            message_uid INTEGER NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (account_id, folder, message_uid, tag_id),
            FOREIGN KEY (account_id, folder, message_uid) REFERENCES messages(account_id, folder, uid) ON DELETE CASCADE
        )",
        (),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_message_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            mailbox TEXT NOT NULL,
            uid INTEGER NOT NULL,
            action TEXT NOT NULL CHECK(action IN ('seen', 'flagged', 'delete')),
            desired INTEGER,
            created_at INTEGER NOT NULL,
            last_error TEXT,
            UNIQUE(account_id, folder, uid, action)
        )",
        (),
    ).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pending_message_actions_account ON pending_message_actions(account_id, id)", ())
        .map_err(|e| e.to_string())?;
    migrate_reconciliation_identity(&conn)?;

    conn.execute("CREATE INDEX IF NOT EXISTS idx_message_tags_message ON message_tags(account_id, folder, message_uid)", ()).map_err(|e| e.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_message_tags_tag ON message_tags(account_id, tag_id)", ()).map_err(|e| e.to_string())?;

    // Reset sync_in_progress on startup to avoid permanent soft-locks from previous crashes
    conn.execute("UPDATE folder_sync_state SET sync_in_progress = 0", ()).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_mailbox_validity(app_handle: &AppHandle, account_id: &str, mailbox: &str) -> Result<Option<u32>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn.prepare("SELECT uid_validity FROM mailbox_state WHERE account_id = ?1 AND mailbox = ?2").map_err(|e| e.to_string())?;
    let validity = stmt.query_row(rusqlite::params![account_id, mailbox], |row| row.get(0)).optional().map_err(|e| e.to_string())?;

    Ok(validity)
}

pub fn update_mailbox_validity(app_handle: &AppHandle, account_id: &str, mailbox: &str, validity: u32) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO mailbox_state (account_id, mailbox, uid_validity) VALUES (?1, ?2, ?3)",
        rusqlite::params![account_id, mailbox, validity],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn clear_messages(app_handle: &AppHandle, account_id: &str, folder: &str) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute("DELETE FROM messages WHERE account_id = ?1 AND folder = ?2", rusqlite::params![account_id, folder]).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn reset_mailbox_epoch(app: &AppHandle, account: &str, folder: &str, mailbox: &str, validity: u32) -> Result<usize, String> {
    let mut conn = open_connection(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM messages WHERE account_id = ?1 AND folder = ?2", rusqlite::params![account, folder]).map_err(|e| e.to_string())?;
    let conflicts = tx.execute("UPDATE pending_message_actions SET last_error = 'CONFLICT: Mailbox UIDVALIDITY changed; action was not replayed'
        WHERE account_id = ?1 AND mailbox = ?2 AND (uid_validity IS NULL OR uid_validity != ?3) AND (last_error IS NULL OR last_error NOT LIKE 'CONFLICT:%')",
        rusqlite::params![account, mailbox, validity]).map_err(|e| e.to_string())?;
    tx.execute("INSERT OR REPLACE INTO mailbox_state (account_id, mailbox, uid_validity) VALUES (?1,?2,?3)", rusqlite::params![account, mailbox, validity]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE folder_sync_state SET last_uid = 0, last_full_sync_at = 0, uid_validity = ?3 WHERE account_id = ?1 AND folder = ?2", rusqlite::params![account, folder, validity]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(conflicts)
}

pub fn clear_account_cache(app_handle: &AppHandle, account_id: &str) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM message_tags WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM messages WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM mailbox_state WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM folder_sync_state WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM global_sync_state WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM pending_message_actions WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags WHERE account_id = ?1", [account_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn get_highest_uid(app_handle: &AppHandle, account_id: &str, folder: &str) -> Result<u32, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare("SELECT MAX(uid) FROM messages WHERE account_id = ?1 AND folder = ?2").map_err(|e| e.to_string())?;
    let max_uid: Option<u32> = stmt.query_row(rusqlite::params![account_id, folder], |row| row.get(0)).unwrap_or(None);

    Ok(max_uid.unwrap_or(0))
}

pub fn insert_or_update_messages(app_handle: &AppHandle, account_id: &str, messages: &[MessageHeader]) -> Result<(), String> {
    if messages.is_empty() {
        return Ok(());
    }

    let mut conn = open_connection(app_handle)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO messages (account_id, folder, uid, uid_validity, subject, sender, recipient, date, seen, flagged, snippet, message_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(account_id, folder, uid) DO UPDATE SET
                subject = excluded.subject,
                sender = excluded.sender,
                recipient = excluded.recipient,
                date = excluded.date,
                seen = excluded.seen,
                flagged = excluded.flagged,
                snippet = excluded.snippet,
                message_id = excluded.message_id"
        ).map_err(|e| e.to_string())?;

        for msg in messages {
            stmt.execute(rusqlite::params![
                account_id,
                msg.folder,
                msg.uid,
                msg.uid_validity,
                msg.subject,
                msg.from,
                msg.to,
                msg.date,
                if msg.seen { 1 } else { 0 },
                if msg.flagged { 1 } else { 0 },
                msg.snippet.as_deref().unwrap_or(""),
                &msg.message_id,
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

fn populate_message_tags(conn: &Connection, account_id: &str, messages: &mut [MessageHeader]) {
    if messages.is_empty() {
        return;
    }
    if let Ok(mut stmt) = conn.prepare("SELECT tag_id FROM message_tags WHERE account_id = ?1 AND folder = ?2 AND message_uid = ?3") {
        for msg in messages.iter_mut() {
            if let Ok(rows) = stmt.query_map(rusqlite::params![account_id, msg.folder, msg.uid], |row| row.get::<_, String>(0)) {
                for row in rows {
                    if let Ok(tag_id) = row {
                        msg.tags.push(tag_id);
                    }
                }
            }
        }
    }
}

pub fn load_cached_messages(app_handle: &AppHandle, account_id: &str, limit: usize) -> Result<Vec<MessageHeader>, String> {
    load_messages_page(app_handle, account_id, "inbox", None, limit as u32)
}

pub fn load_messages_page(app_handle: &AppHandle, account_id: &str, folder: &str, before_uid: Option<u32>, limit: u32) -> Result<Vec<MessageHeader>, String> {
    let conn = open_connection(app_handle)?;

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
            to: row.get(11).unwrap_or(None),
            message_id: row.get(12).unwrap_or(None),
            tags: Vec::new(),
        })
    };

    let mut messages = Vec::new();
    let fields = "uid, uid_validity, subject, sender, date, seen, flagged, snippet, folder, has_attachments, thread_id, recipient, message_id";
    // A provider label is synced into its own tag:<id> mailbox. Its UIDs belong
    // to that mailbox, so do not mix relationship matches from Inbox/Sent here.
    if folder.eq_ignore_ascii_case("starred") {
        let sql = format!("SELECT {fields} FROM messages WHERE account_id = ?1 AND flagged = 1 AND (?2 IS NULL OR date < (SELECT date FROM messages WHERE account_id = ?1 AND uid = ?2 AND flagged = 1 LIMIT 1)) ORDER BY date DESC, uid DESC LIMIT ?3");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![account_id, before_uid, limit], parse_row).map_err(|e| e.to_string())?;
        for row in rows { messages.push(row.map_err(|e| e.to_string())?); }
    } else if let Some(uid) = before_uid {
        let sql = format!("SELECT {fields} FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid < ?3 ORDER BY uid DESC LIMIT ?4");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![account_id, folder, uid, limit], parse_row).map_err(|e| e.to_string())?;
        for row in rows { messages.push(row.map_err(|e| e.to_string())?); }
    } else {
        let sql = format!("SELECT {fields} FROM messages WHERE account_id = ?1 AND folder = ?2 ORDER BY uid DESC LIMIT ?3");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![account_id, folder, limit], parse_row).map_err(|e| e.to_string())?;
        for row in rows { messages.push(row.map_err(|e| e.to_string())?); }
    }

    populate_message_tags(&conn, account_id, &mut messages);
    Ok(messages)
}

pub fn get_folder_sync_state(app_handle: &AppHandle, account_id: &str, folder: &str) -> Result<Option<FolderSyncState>, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare("SELECT account_id, folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error, uid_validity FROM folder_sync_state WHERE account_id = ?1 AND folder = ?2").map_err(|e| e.to_string())?;
    let state = stmt.query_row(rusqlite::params![account_id, folder], |row| {
        Ok(FolderSyncState {
            account_id: row.get(0)?,
            folder: row.get(1)?,
            last_uid: row.get(2)?,
            last_synced_at: row.get(3)?,
            sync_in_progress: row.get::<_, i32>(4)? != 0,
            last_full_sync_at: row.get(5)?,
            last_error: row.get(6)?,
            uid_validity: row.get(7)?,
        })
    }).optional().map_err(|e| e.to_string())?;

    Ok(state)
}

pub fn update_folder_sync_state(app_handle: &AppHandle, state: &FolderSyncState) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO folder_sync_state (account_id, folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error, uid_validity) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            state.account_id,
            state.folder,
            state.last_uid,
            state.last_synced_at,
            if state.sync_in_progress { 1 } else { 0 },
            state.last_full_sync_at,
            state.last_error,
            state.uid_validity
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_sync_in_progress(app_handle: &AppHandle, account_id: &str, folder: &str, in_progress: bool) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    // We use INSERT OR IGNORE and then UPDATE to ensure the row exists
    conn.execute(
        "INSERT OR IGNORE INTO folder_sync_state (account_id, folder, last_uid, last_synced_at, sync_in_progress, last_full_sync_at, last_error) VALUES (?1, ?2, 0, 0, 0, 0, NULL)",
        rusqlite::params![account_id, folder],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE folder_sync_state SET sync_in_progress = ?1 WHERE account_id = ?2 AND folder = ?3",
        rusqlite::params![if in_progress { 1 } else { 0 }, account_id, folder],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_folder_sync_error(app_handle: &AppHandle, account_id: &str, folder: &str, error: &str) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "UPDATE folder_sync_state SET last_error = ?1 WHERE account_id = ?2 AND folder = ?3",
        rusqlite::params![error, account_id, folder],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub struct SyncProgressGuard {
    app_handle: AppHandle,
    account_id: String,
    folder: String,
}

impl SyncProgressGuard {
    pub fn new(app_handle: AppHandle, account_id: String, folder: String) -> Result<Self, String> {
        set_sync_in_progress(&app_handle, &account_id, &folder, true)?;
        Ok(Self { app_handle, account_id, folder })
    }
}

impl Drop for SyncProgressGuard {
    fn drop(&mut self) {
        let _ = set_sync_in_progress(&self.app_handle, &self.account_id, &self.folder, false);
    }
}


pub fn get_message_body_cache(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32) -> Result<Option<(String, Option<String>, Option<String>)>, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare("SELECT processed_html, attachments_json, extracted_data FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid = ?3 AND body_fetched = 1 AND processed_html IS NOT NULL")
        .map_err(|e| format!("Failed to prepare get_message_body_cache statement: {}", e))?;
    let result = stmt.query_row(rusqlite::params![account_id, folder, uid], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, Option<String>>(2)?))
    }).ok();

    Ok(result)
}

pub fn update_message_body(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32, body: &str, snippet: &str, attachments_json: Option<String>, extracted_data: Option<String>) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "UPDATE messages SET processed_html = ?1, snippet = ?2, attachments_json = ?3, extracted_data = ?4, body_fetched = 1 WHERE account_id = ?5 AND folder = ?6 AND uid = ?7",
        rusqlite::params![body, snippet, attachments_json, extracted_data, account_id, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_unfetched_recent_uids(app_handle: &AppHandle, account_id: &str, folder: &str, limit: u32) -> Result<Vec<u32>, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare(
        "SELECT uid FROM messages 
         WHERE account_id = ?1 AND folder = ?2 AND body_fetched = 0 AND uid > (SELECT MAX(uid) - 200 FROM messages WHERE account_id = ?1 AND folder = ?2)
         ORDER BY uid DESC LIMIT ?3"
    ).unwrap();

    let uid_iter = stmt.query_map(rusqlite::params![account_id, folder, limit], |row| {
        Ok(row.get(0)?)
    }).map_err(|e| e.to_string())?;

    let mut uids = Vec::new();
    for u in uid_iter {
        uids.push(u.map_err(|e| e.to_string())?);
    }

    Ok(uids)
}

pub fn is_message_seen(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32) -> Result<bool, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare("SELECT seen FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid = ?3").map_err(|e| e.to_string())?;
    let seen: Option<i32> = stmt.query_row(rusqlite::params![account_id, folder, uid], |row| row.get(0)).ok();

    Ok(seen.unwrap_or(0) != 0)
}

pub fn set_message_seen(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32, seen: bool) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "UPDATE messages SET seen = ?1 WHERE account_id = ?2 AND folder = ?3 AND uid = ?4",
        rusqlite::params![if seen { 1 } else { 0 }, account_id, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_message_flagged(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32, flagged: bool) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "UPDATE messages SET flagged = ?1 WHERE account_id = ?2 AND folder = ?3 AND uid = ?4",
        rusqlite::params![if flagged { 1 } else { 0 }, account_id, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_message_local(app_handle: &AppHandle, account_id: &str, folder: &str, uid: u32) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "DELETE FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid = ?3",
        rusqlite::params![account_id, folder, uid],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone)]
pub struct PendingMessageAction {
    pub id: i64,
    pub account_id: String,
    pub folder: String,
    pub mailbox: String,
    pub uid: u32,
    pub action: String,
    pub desired: Option<bool>,
    pub uid_validity: Option<u32>,
}

pub fn message_uid_validity(app: &AppHandle, account: &str, folder: &str, uid: u32) -> Result<u32, String> {
    let validity: Option<u32> = open_connection(app)?.query_row(
        "SELECT uid_validity FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid = ?3",
        rusqlite::params![account, folder, uid], |row| row.get(0)).map_err(|e| e.to_string())?;
    validity.filter(|value| *value != 0).ok_or_else(|| "Message identity is unavailable. Refresh this folder before changing the message.".into())
}

pub fn enqueue_message_action(
    app_handle: &AppHandle,
    account_id: &str,
    folder: &str,
    mailbox: &str,
    uid: u32,
    action: &str,
    desired: Option<bool>,
) -> Result<i64, String> {
    let uid_validity = message_uid_validity(app_handle, account_id, folder, uid)?;
    let conn = open_connection(app_handle)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO pending_message_actions (account_id, folder, mailbox, uid, action, desired, created_at, last_error, uid_validity)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)
         ON CONFLICT(account_id, folder, uid, action) DO UPDATE SET
            mailbox = excluded.mailbox, desired = excluded.desired, created_at = excluded.created_at, last_error = NULL, uid_validity = excluded.uid_validity",
        rusqlite::params![account_id, folder, mailbox, uid, action, desired.map(|v| if v { 1 } else { 0 }), now, uid_validity],
    ).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id FROM pending_message_actions WHERE account_id = ?1 AND folder = ?2 AND uid = ?3 AND action = ?4",
        rusqlite::params![account_id, folder, uid, action],
        |row| row.get(0),
    ).map_err(|e| e.to_string())
}

pub fn list_pending_message_actions(app_handle: &AppHandle, account_id: &str, limit: u32) -> Result<Vec<PendingMessageAction>, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn.prepare(
        "SELECT id, account_id, folder, mailbox, uid, action, desired, uid_validity FROM pending_message_actions
         WHERE account_id = ?1 AND (last_error IS NULL OR last_error NOT LIKE 'CONFLICT:%') ORDER BY id LIMIT ?2",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![account_id, limit], |row| {
        let desired: Option<i32> = row.get(6)?;
        Ok(PendingMessageAction {
            id: row.get(0)?, account_id: row.get(1)?, folder: row.get(2)?, mailbox: row.get(3)?,
            uid: row.get(4)?, action: row.get(5)?, desired: desired.map(|v| v != 0), uid_validity: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

pub fn complete_message_action(app_handle: &AppHandle, id: i64) -> Result<(), String> {
    open_connection(app_handle)?.execute("DELETE FROM pending_message_actions WHERE id = ?1", [id])
        .map(|_| ()).map_err(|e| e.to_string())
}

pub fn record_message_action_error(app_handle: &AppHandle, id: i64, error: &str) -> Result<(), String> {
    open_connection(app_handle)?.execute("UPDATE pending_message_actions SET last_error = ?1 WHERE id = ?2", rusqlite::params![error, id])
        .map(|_| ()).map_err(|e| e.to_string())
}

pub fn insert_sent_message(
    app_handle: &AppHandle,
    account_id: &str,
    _sender: &str,
    to: &[String],
    subject: &str,
    plain_body: &str,
    html_body: &str,
) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    let folder = "sent";
    let date = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let highest = get_highest_uid(app_handle, account_id, folder)?;
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
        "INSERT INTO messages (account_id, folder, uid, subject, sender, date, snippet, processed_html, body_fetched, seen, flagged, uid_validity, message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 1, 0, 1, NULL)",
        rusqlite::params![
            account_id,
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

pub fn get_global_sync_state(app_handle: &AppHandle, account_id: &str) -> Result<GlobalSyncState, String> {
    let conn = open_connection(app_handle)?;

    let mut stmt = conn.prepare("SELECT last_sync_at, last_successful_idle_at, last_notification_at, last_sync_error, last_tag_sync_at FROM global_sync_state WHERE account_id = ?1").map_err(|e| e.to_string())?;
    let state = stmt.query_row([account_id], |row| {
        Ok(GlobalSyncState {
            last_sync_at: row.get(0)?,
            last_successful_idle_at: row.get(1)?,
            last_notification_at: row.get(2)?,
            last_sync_error: row.get(3)?,
            last_tag_sync_at: row.get(4)?,
        })
    }).unwrap_or_default();

    Ok(state)
}

pub fn update_global_sync_time(app_handle: &AppHandle, account_id: &str, timestamp: Option<i64>, error: Option<String>) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    
    if timestamp.is_some() {
        conn.execute(
            "INSERT INTO global_sync_state (account_id, last_sync_at, last_sync_error)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(account_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, last_sync_error = excluded.last_sync_error",
            rusqlite::params![account_id, timestamp, error],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO global_sync_state (account_id, last_sync_error)
             VALUES (?1, ?2)
             ON CONFLICT(account_id) DO UPDATE SET last_sync_error = excluded.last_sync_error",
            rusqlite::params![account_id, error],
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn update_global_idle_time(app_handle: &AppHandle, account_id: &str, timestamp: i64) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "INSERT INTO global_sync_state (account_id, last_successful_idle_at)
         VALUES (?1, ?2)
         ON CONFLICT(account_id) DO UPDATE SET last_successful_idle_at = excluded.last_successful_idle_at",
        rusqlite::params![account_id, timestamp],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_global_notification_time(app_handle: &AppHandle, account_id: &str, timestamp: i64) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    conn.execute(
        "INSERT INTO global_sync_state (account_id, last_notification_at)
         VALUES (?1, ?2)
         ON CONFLICT(account_id) DO UPDATE SET last_notification_at = excluded.last_notification_at",
        rusqlite::params![account_id, timestamp],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_global_unread_count(app_handle: &AppHandle, account_id: &str) -> Result<u32, String> {
    let conn = open_connection(app_handle)?;
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM messages WHERE account_id = ?1 AND seen = 0").map_err(|e| e.to_string())?;
    let count: u32 = stmt.query_row([account_id], |row| row.get(0)).unwrap_or(0);
    Ok(count)
}

pub fn search_messages_local(app_handle: &AppHandle, account_id: &str, folder: &str, query: &str, limit: u32) -> Result<Vec<MessageHeader>, String> {
    let conn = open_connection(app_handle)?;

    // Match tokenizer boundaries without losing Unicode or joining email-address tokens.
    // Quote each token so renderer input cannot become FTS syntax.
    let cleaned: Vec<String> = query.split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .take(32)
        .map(|token| format!("\"{}\"*", token))
        .collect();
    let match_query = cleaned.join(" ");

    if match_query.is_empty() {
        return Ok(Vec::new());
    }

    // score = bm25(messages_fts) + recent_bonus + flag_bonus
    // In SQLite FTS5, bm25() is smaller (more negative) for better matches.
    // So we subtract bonuses to make the score even more negative.
    let sql = if folder == "all" {
        "SELECT m.uid, m.uid_validity, m.subject, m.sender, m.date, m.seen, m.flagged, m.snippet, m.folder, m.has_attachments, m.thread_id, m.recipient, m.message_id
         FROM messages m
         JOIN messages_fts f ON m.rowid = f.rowid AND m.account_id = f.account_id
         WHERE m.account_id = ?1 AND messages_fts MATCH ?2
         ORDER BY bm25(messages_fts, 0.0, 8.0, 5.0, 3.0, 1.0, 1.0) ASC, m.date DESC
         LIMIT ?3"
    } else {
        "SELECT m.uid, m.uid_validity, m.subject, m.sender, m.date, m.seen, m.flagged, m.snippet, m.folder, m.has_attachments, m.thread_id, m.recipient, m.message_id
         FROM messages m
         JOIN messages_fts f ON m.rowid = f.rowid AND m.account_id = f.account_id
         WHERE m.account_id = ?1 AND ((?2 = 'starred' AND m.flagged = 1) OR m.folder = ?2) AND messages_fts MATCH ?3
         ORDER BY bm25(messages_fts, 0.0, 8.0, 5.0, 3.0, 1.0, 1.0) ASC, m.date DESC
         LIMIT ?4"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    
    let mut messages = Vec::new();
    if folder == "all" {
        let rows = stmt.query_map(rusqlite::params![account_id, match_query, limit], |row| {
            Ok(MessageHeader {
                uid: row.get(0)?,
                uid_validity: row.get(1)?,
                subject: row.get(2)?,
                from: row.get(3)?,
                date: row.get(4)?,
                seen: row.get(5)?,
                flagged: row.get(6)?,
                snippet: row.get(7)?,
                folder: row.get(8)?,
                has_attachments: row.get(9)?,
                thread_id: row.get(10)?,
                to: row.get(11)?,
                message_id: row.get(12)?,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(msg) = row {
                messages.push(msg);
            }
        }
    } else {
        let rows = stmt.query_map(rusqlite::params![account_id, folder, match_query, limit], |row| {
            Ok(MessageHeader {
                uid: row.get(0)?,
                uid_validity: row.get(1)?,
                subject: row.get(2)?,
                from: row.get(3)?,
                date: row.get(4)?,
                seen: row.get(5)?,
                flagged: row.get(6)?,
                snippet: row.get(7)?,
                folder: row.get(8)?,
                has_attachments: row.get(9)?,
                thread_id: row.get(10)?,
                to: row.get(11)?,
                message_id: row.get(12)?,
                tags: Vec::new(),
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(msg) = row {
                messages.push(msg);
            }
        }
    }

    Ok(messages)
}

pub fn get_existing_uids(app_handle: &AppHandle, account_id: &str, folder: &str, uids: &[u32]) -> Result<std::collections::HashSet<u32>, String> {
    if uids.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    let conn = open_connection(app_handle)?;

    let placeholders: Vec<String> = uids.iter().map(|_| "?".to_string()).collect();
    let sql = format!("SELECT uid FROM messages WHERE account_id = ? AND folder = ? AND uid IN ({})", placeholders.join(","));
    
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(account_id.to_string()), rusqlite::types::Value::Text(folder.to_string())];
    for &uid in uids {
        params.push(rusqlite::types::Value::Integer(uid as i64));
    }

    let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| row.get::<_, u32>(0)).map_err(|e| e.to_string())?;
    
    let mut existing = std::collections::HashSet::new();
    for row in rows {
        if let Ok(uid) = row {
            existing.insert(uid);
        }
    }
    Ok(existing)
}

pub fn get_messages_by_uids(app_handle: &AppHandle, account_id: &str, folder: &str, uids: &[u32]) -> Result<Vec<MessageHeader>, String> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_connection(app_handle)?;

    let placeholders: Vec<String> = uids.iter().map(|_| "?".to_string()).collect();
    let sql = format!("SELECT uid, uid_validity, subject, sender, date, seen, flagged, snippet, folder, has_attachments, thread_id, recipient, message_id FROM messages WHERE account_id = ? AND folder = ? AND uid IN ({}) ORDER BY date DESC, uid DESC", placeholders.join(","));
    
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(account_id.to_string()), rusqlite::types::Value::Text(folder.to_string())];
    for &uid in uids {
        params.push(rusqlite::types::Value::Integer(uid as i64));
    }

    let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
        Ok(MessageHeader {
            uid: row.get(0)?,
            uid_validity: row.get(1)?,
            subject: row.get(2)?,
            from: row.get(3)?,
            date: row.get(4)?,
            seen: row.get(5)?,
            flagged: row.get(6)?,
            snippet: row.get(7)?,
            folder: row.get(8)?,
            has_attachments: row.get(9)?,
            thread_id: row.get(10)?,
            to: row.get(11)?,
            message_id: row.get(12)?,
            tags: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;
    
    let mut messages = Vec::new();
    for row in rows {
        if let Ok(msg) = row {
            messages.push(msg);
        }
    }
    Ok(messages)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Tag {
    pub account_id: String,
    pub id: String,
    pub name: String,
    pub tag_type: String, // 'system' or 'user'
    pub bg_color: Option<String>,
    pub text_color: Option<String>,
    pub provider: String,
    pub updated_at: i64,
}

pub fn upsert_tags(app_handle: &AppHandle, tags: &[Tag]) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO tags (account_id, id, name, type, bg_color, text_color, provider, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(account_id, id) DO UPDATE SET 
             name = excluded.name,
             type = excluded.type,
             bg_color = excluded.bg_color,
             text_color = excluded.text_color,
             provider = excluded.provider,
             updated_at = excluded.updated_at"
        ).map_err(|e| e.to_string())?;

        for tag in tags {
            stmt.execute(rusqlite::params![
                tag.account_id,
                tag.id,
                tag.name,
                tag.tag_type,
                tag.bg_color,
                tag.text_color,
                tag.provider,
                tag.updated_at,
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_missing_tags(app_handle: &AppHandle, account_id: &str, keep_ids: &[String]) -> Result<(), String> {
    let conn = open_connection(app_handle)?;
    
    if keep_ids.is_empty() {
        conn.execute("DELETE FROM tags WHERE account_id = ?", rusqlite::params![account_id]).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let placeholders: String = keep_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM tags WHERE account_id = ? AND id NOT IN ({})", placeholders);
    
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&account_id];
    for id in keep_ids {
        params.push(id);
    }
    
    conn.execute(&sql, rusqlite::params_from_iter(params)).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_all_tags(app_handle: &AppHandle, account_id: &str) -> Result<Vec<Tag>, String> {
    let conn = open_connection(app_handle)?;
    
    let mut stmt = conn.prepare(
        "SELECT id, name, type, bg_color, text_color, provider, updated_at 
         FROM tags WHERE account_id = ?"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map(rusqlite::params![account_id], |row| {
        Ok(Tag {
            account_id: account_id.to_string(),
            id: row.get(0)?,
            name: row.get(1)?,
            tag_type: row.get(2)?,
            bg_color: row.get(3)?,
            text_color: row.get(4)?,
            provider: row.get(5)?,
            updated_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        if let Ok(tag) = row {
            tags.push(tag);
        }
    }
    Ok(tags)
}

pub fn set_message_tags(app_handle: &AppHandle, account_id: &str, folder: &str, message_uid: u32, tag_ids: &[String]) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        // 1. Delete existing associations
        tx.execute(
            "DELETE FROM message_tags WHERE account_id = ? AND folder = ? AND message_uid = ?",
            rusqlite::params![account_id, folder, message_uid]
        ).map_err(|e| e.to_string())?;

        // 2. Insert new ones
        if !tag_ids.is_empty() {
            let mut stmt = tx.prepare(
                "INSERT INTO message_tags (account_id, folder, message_uid, tag_id) VALUES (?1, ?2, ?3, ?4)"
            ).map_err(|e| e.to_string())?;
            
            for tag_id in tag_ids {
                stmt.execute(rusqlite::params![account_id, folder, message_uid, tag_id]).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(())
}

pub fn get_message_tags(app_handle: &AppHandle, account_id: &str, folder: &str, message_uid: u32) -> Result<Vec<String>, String> {
    let conn = open_connection(app_handle)?;
    
    let mut stmt = conn.prepare(
        "SELECT tag_id FROM message_tags WHERE account_id = ? AND folder = ? AND message_uid = ?"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map(rusqlite::params![account_id, folder, message_uid], |row| row.get(0)).map_err(|e| e.to_string())?;
    let mut tag_ids = Vec::new();
    for row in rows {
        if let Ok(id) = row {
            tag_ids.push(id);
        }
    }
    Ok(tag_ids)
}

pub fn update_global_sync_state(app_handle: &AppHandle, account_id: &str, state: &GlobalSyncState) -> Result<(), String> {
    let conn = open_connection(app_handle)?;

    conn.execute(
        "INSERT OR REPLACE INTO global_sync_state (account_id, last_sync_at, last_successful_idle_at, last_notification_at, last_sync_error, last_tag_sync_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            account_id,
            state.last_sync_at,
            state.last_successful_idle_at,
            state.last_notification_at,
            state.last_sync_error,
            state.last_tag_sync_at
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn set_message_tags_batch(app_handle: &AppHandle, account_id: &str, folder: &str, batch: &[(u32, Vec<String>)]) -> Result<(), String> {
    let mut conn = open_connection(app_handle)?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut del_stmt = tx.prepare(
            "DELETE FROM message_tags WHERE account_id = ? AND folder = ? AND message_uid = ?"
        ).map_err(|e| e.to_string())?;

        let mut ins_stmt = tx.prepare(
            "INSERT INTO message_tags (account_id, folder, message_uid, tag_id) VALUES (?1, ?2, ?3, ?4)"
        ).map_err(|e| e.to_string())?;

        for (uid, tag_ids) in batch {
            del_stmt.execute(rusqlite::params![account_id, folder, uid]).map_err(|e| e.to_string())?;
            for tag_id in tag_ids {
                ins_stmt.execute(rusqlite::params![account_id, folder, uid, tag_id]).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(())
}
