use rusqlite::Connection;
use tauri::AppHandle;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ContactSuggestion {
    pub name: String,
    pub email: String,
}

#[tauri::command]
pub async fn search_contacts(app_handle: AppHandle, account_id: Option<String>, query: String) -> Result<Vec<ContactSuggestion>, String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let owner = crate::auth::scope::profile(&app_handle, account_id.as_deref())?.id;
    let app = app_handle.clone();
    let q = query.trim().to_lowercase();

    tokio::task::spawn_blocking(move || {
        let db_path = crate::mail::database::get_db_path(&app)?;
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        let mut suggestions = Vec::new();

        if q.is_empty() {
            // Return top contacts globally
            let mut stmt = conn.prepare(
                "SELECT email, display_name FROM account_contacts
                 WHERE account_id=?1 ORDER BY usage_count DESC, last_used DESC
                 LIMIT 10"
            ).map_err(|e| e.to_string())?;

            let iter = stmt.query_map([&owner], |row| {
                let email: String = row.get(0)?;
                let display_name: Option<String> = row.get(1)?;
                Ok(ContactSuggestion {
                    name: display_name.unwrap_or(email.clone()), // Fallback to email if no name
                    email,
                })
            }).map_err(|e| e.to_string())?;

            for contact in iter.flatten() {
                suggestions.push(contact);
            }
        } else {
            // Prefix search with LIKE
            let like_q_prefix = format!("{}%", q);
            let like_q_any = format!("%{}%", q);

            let mut stmt = conn.prepare(
                "SELECT email, display_name FROM account_contacts
                 WHERE account_id=?3 AND (email LIKE ?1 OR display_name LIKE ?1)
                 ORDER BY
                   CASE
                     WHEN LOWER(email) LIKE ?2 THEN 0
                     WHEN LOWER(display_name) LIKE ?2 THEN 1
                     ELSE 2
                   END,
                   usage_count DESC,
                   last_used DESC
                 LIMIT 10"
            ).map_err(|e| e.to_string())?;

            let iter = stmt.query_map(rusqlite::params![like_q_any, like_q_prefix, owner], |row| {
                let email: String = row.get(0)?;
                let display_name: Option<String> = row.get(1)?;
                Ok(ContactSuggestion {
                    name: display_name.unwrap_or(email.clone()),
                    email,
                })
            }).map_err(|e| e.to_string())?;

            for contact in iter.flatten() {
                suggestions.push(contact);
            }
        }

        Ok(suggestions)
    }).await.map_err(|e| e.to_string())?
}
