//! Provider-backed Trash and a durable, account/epoch-scoped operation queue.
use crate::{auth::account::Account, mail::database};
use rusqlite::{params, Connection};
use tauri::AppHandle;
type Session = imap::Session<native_tls::TlsStream<std::net::TcpStream>>;

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS system_mailboxes(account_id TEXT NOT NULL,role TEXT NOT NULL,mailbox TEXT NOT NULL,PRIMARY KEY(account_id,role));
      CREATE TABLE IF NOT EXISTS pending_trash_actions(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,uid INTEGER NOT NULL,uid_validity INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('restore','purge')),snapshot TEXT NOT NULL,remote_done TEXT,last_error TEXT,created_at INTEGER NOT NULL,
      UNIQUE(account_id,uid,uid_validity));").map_err(|e|e.to_string())?;
    let has_optimistic = conn
        .prepare("PRAGMA table_info(pending_trash_actions)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|name| name == "optimistic");
    if !has_optimistic {
        conn.execute(
            "ALTER TABLE pending_trash_actions ADD COLUMN optimistic INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    operations::init(conn)
}
pub fn mailbox(app: &AppHandle, account: &Account) -> String {
    database::open_connection(app)
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT mailbox FROM system_mailboxes WHERE account_id=?1 AND role='trash'",
                [&account.id],
                |r| r.get(0),
            )
            .ok()
        })
        .unwrap_or_else(|| {
            crate::mail::folder::MailFolder::Trash
                .to_imap_mailbox(&account.provider)
                .unwrap_or("Trash")
                .to_string()
        })
}
pub fn discover(
    app: &AppHandle,
    account: &Account,
    session: &mut Session,
) -> Result<String, String> {
    let folders = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Could not locate Trash: {e}"))?;
    let explicit=folders.iter().find(|name|name.attributes().iter().any(|attribute|matches!(attribute,imap::types::NameAttribute::Custom(value) if value.eq_ignore_ascii_case("\\Trash"))));
    let fallback = mailbox(app, account);
    let name = explicit
        .map(|name| name.name())
        .or_else(|| {
            folders
                .iter()
                .find(|name| name.name() == fallback)
                .map(|name| name.name())
        })
        .ok_or("Provider Trash mailbox was not found; no messages were changed")?
        .to_string();
    database::open_connection(app)?.execute("INSERT INTO system_mailboxes VALUES(?1,'trash',?2) ON CONFLICT(account_id,role) DO UPDATE SET mailbox=excluded.mailbox",params![account.id,name]).map_err(|e|e.to_string())?;
    Ok(name)
}

mod operations;
pub(crate) use operations::{__cmd__list_trash_actions, __cmd__trash_action};
pub use operations::{
    changed, identity, inbox_headers, list_trash_actions, refresh_metadata, retry_pending, source,
    trash_action, Pending,
};
