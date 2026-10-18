use crate::auth::account::Account;
use crate::mail::database::{self, Tag};
use reqwest::Client;
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Deserialize, Debug)]
struct GmailColor {
    #[serde(rename = "textColor")]
    text_color: String,
    #[serde(rename = "backgroundColor")]
    bg_color: String,
}

#[derive(Deserialize, Debug)]
struct GmailLabel {
    id: String,
    name: String,
    #[serde(rename = "type")]
    label_type: Option<String>, // "system" or "user"
    color: Option<GmailColor>,
}

#[derive(Deserialize, Debug)]
struct GmailLabelsResponse {
    labels: Vec<GmailLabel>,
}

pub async fn sync_tags(app_handle: &AppHandle, account: &Account) -> Result<(), String> {
    log::info!("Syncing Gmail labels for account {}", account.id);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build().map_err(|e| e.to_string())?;
    let res = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/labels")
        .bearer_auth(&account.access_token)
        .send()
        .await
        .map_err(|e| format!("Gmail API Error: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Gmail API returned error: {}", err));
    }

    let parsed: GmailLabelsResponse = res.json().await.map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let mut db_tags = Vec::new();
    for label in parsed.labels {
        db_tags.push(Tag {
            account_id: account.id.clone(),
            id: label.id,
            name: label.name,
            tag_type: label
                .label_type
                .unwrap_or_else(|| "user".to_string())
                .to_lowercase(),
            bg_color: label.color.as_ref().map(|c| c.bg_color.clone()),
            text_color: label.color.as_ref().map(|c| c.text_color.clone()),
            provider: "google".to_string(),
            updated_at: now,
        });
    }

    database::upsert_tags(app_handle, &db_tags)?;

    let remote_ids: Vec<String> = db_tags.into_iter().map(|t| t.id).collect();
    database::delete_missing_tags(app_handle, &account.id, &remote_ids)?;

    use tauri::Emitter;
    let _ = app_handle.emit("mail:tags_updated", ());

    // Update global sync state
    let mut state = database::get_global_sync_state(app_handle, &account.id).unwrap_or_default();
    state.last_tag_sync_at = Some(now);
    let _ = database::update_global_sync_state(app_handle, &account.id, &state);

    Ok(())
}

pub fn sync_message_tags(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    range: &str,
    folder: &str,
    account_id: &str,
    app_handle: &AppHandle,
) -> Result<(), String> {
    sync_memberships(session, range, folder, account_id, app_handle, &[])
}

pub fn refresh_cached_memberships(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    folder: &str,
    account_id: &str,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let conn = database::open_connection(app_handle)?;
    let mut stmt=conn.prepare("SELECT uid FROM messages WHERE account_id=?1 AND folder=?2 ORDER BY uid DESC LIMIT 200").map_err(|e|e.to_string())?;
    let uids = stmt
        .query_map(rusqlite::params![account_id, folder], |r| {
            r.get::<_, u32>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    if uids.is_empty() {
        return Ok(());
    }
    let range = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    sync_memberships(session, &range, folder, account_id, app_handle, &uids)
}

fn sync_memberships(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    range: &str,
    folder: &str,
    account_id: &str,
    app_handle: &AppHandle,
    expected: &[u32],
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let generation = super::assignment::LABEL_GENERATION.load(Ordering::SeqCst);
    let all_tags = database::get_all_tags(app_handle, account_id)?;
    // imap 2.4 cannot parse extension FETCH attributes, even through its raw
    // command API. SEARCH returns ordinary UID lists and needs no custom parser.
    let labels = all_tags
        .iter()
        .filter(|tag| tag.tag_type == "user")
        .map(|tag| Ok((tag.id.clone(), super::assignment::quote_label(&tag.name)?)))
        .collect::<Result<Vec<_>, String>>()?;
    let batch = super::assignment::fetch_memberships(session, range, &labels)?;
    // Network scans never block interactive label updates. If an update landed
    // during this scan, leave its confirmed local result intact.
    let _mutation = crate::mail::message_actions::MUTATION_LOCK.blocking_lock();
    if super::assignment::LABEL_GENERATION.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    // Commit once, after every label query succeeds. Never clear assignments
    // from a partial or failed provider snapshot.
    let present: std::collections::HashSet<_> = batch.iter().map(|(uid, _)| *uid).collect();
    let missing: Vec<_> = expected
        .iter()
        .filter(|uid| !present.contains(uid))
        .copied()
        .collect();
    let validity = database::get_folder_sync_state(app_handle, account_id, folder)?
        .and_then(|state| state.uid_validity)
        .ok_or("No mailbox identity for tag refresh")?;
    if super::cache::apply_snapshot(app_handle, account_id, folder, validity, &batch, &missing)? {
        use tauri::Emitter;
        let _ = app_handle.emit("mail:labels_changed", account_id);
    }
    Ok(())
}

pub async fn update_tag(
    app_handle: &AppHandle,
    account: &Account,
    tag_id: &str,
    name: &str,
    bg_color: Option<&str>,
    text_color: Option<&str>,
) -> Result<(), String> {
    log::info!(
        "Updating Gmail label for account {}, tag {}",
        account.id,
        tag_id
    );
    let client = Client::new();

    let mut payload = serde_json::json!({
        "name": name,
    });

    if let (Some(bg), Some(txt)) = (bg_color, text_color) {
        payload["color"] = serde_json::json!({
            "backgroundColor": bg,
            "textColor": txt
        });
    }

    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels/{}",
        tag_id
    );
    let res = client
        .patch(&url)
        .bearer_auth(&account.access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Gmail API Error: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Gmail API returned error updating label: {}", err));
    }

    let label: GmailLabel = res.json().await.map_err(|e| e.to_string())?;

    // Update DB
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    let bg = label.color.as_ref().map(|c| c.bg_color.clone());
    let txt = label.color.as_ref().map(|c| c.text_color.clone());

    conn.execute(
        "UPDATE tags SET name = ?1, bg_color = ?2, text_color = ?3, updated_at = ?4 WHERE account_id = ?5 AND id = ?6",
        rusqlite::params![label.name, bg, txt, now, account.id, tag_id],
    ).map_err(|e| e.to_string())?;

    use tauri::Emitter;
    let _ = app_handle.emit("mail:tags_updated", ());

    Ok(())
}

pub async fn delete_tag(
    app_handle: &AppHandle,
    account: &Account,
    tag_id: &str,
) -> Result<(), String> {
    log::info!(
        "Deleting Gmail label for account {}, tag {}",
        account.id,
        tag_id
    );
    let client = Client::new();

    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels/{}",
        tag_id
    );
    let res = client
        .delete(&url)
        .bearer_auth(&account.access_token)
        .send()
        .await
        .map_err(|e| format!("Gmail API Error: {}", e))?;

    if !res.status().is_success() {
        // A 404 might mean it's already deleted on the server, which is fine to ignore sometimes,
        // but let's report errors cleanly
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Gmail API returned error deleting label: {}", err));
    }

    // Update DB
    let db_path = crate::mail::database::get_db_path(app_handle)?;
    let mut conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // First, remove the tag from any messages
    tx.execute(
        "DELETE FROM message_tags WHERE account_id = ?1 AND tag_id = ?2",
        rusqlite::params![account.id, tag_id],
    )
    .map_err(|e| e.to_string())?;

    // Next, delete the tag itself
    tx.execute(
        "DELETE FROM tags WHERE account_id = ?1 AND id = ?2",
        rusqlite::params![account.id, tag_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    use tauri::Emitter;
    let _ = app_handle.emit("mail:tags_updated", ());

    Ok(())
}

pub async fn create_tag(
    app_handle: &AppHandle,
    account: &Account,
    name: &str,
    bg_color: Option<&str>,
    text_color: Option<&str>,
) -> Result<(), String> {
    log::info!(
        "Creating Gmail label for account {}, name {}",
        account.id,
        name
    );
    let client = Client::new();

    let mut payload = serde_json::json!({
        "name": name,
        "labelListVisibility": "labelShow",
        "messageListVisibility": "show"
    });

    if let (Some(bg), Some(txt)) = (bg_color, text_color) {
        payload["color"] = serde_json::json!({
            "backgroundColor": bg,
            "textColor": txt
        });
    }

    let url = "https://gmail.googleapis.com/gmail/v1/users/me/labels";
    let res = client
        .post(url)
        .bearer_auth(&account.access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Gmail API Error: {}", e))?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        return Err(format!("Gmail API returned error creating label: {}", err));
    }

    let label: GmailLabel = res.json().await.map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let db_tag = Tag {
        account_id: account.id.clone(),
        id: label.id,
        name: label.name,
        tag_type: label
            .label_type
            .unwrap_or_else(|| "user".to_string())
            .to_lowercase(),
        bg_color: label.color.as_ref().map(|c| c.bg_color.clone()),
        text_color: label.color.as_ref().map(|c| c.text_color.clone()),
        provider: "google".to_string(),
        updated_at: now,
    };

    database::upsert_tags(app_handle, &[db_tag])?;

    use tauri::Emitter;
    let _ = app_handle.emit("mail:tags_updated", ());

    Ok(())
}
