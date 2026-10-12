use crate::auth::account::Account;
use crate::mail::database::{self, Tag};
use tauri::AppHandle;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

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
    let client = Client::new();
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
            tag_type: label.label_type.unwrap_or_else(|| "user".to_string()).to_lowercase(),
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
    log::info!("Fetching X-GM-LABELS for range {} in folder {}", range, folder);
    
    let all_tags = database::get_all_tags(app_handle, account_id)?;
    if all_tags.is_empty() {
        return Ok(());
    }

    // name -> id map
    let mut name_to_id = HashMap::new();
    for tag in all_tags {
        name_to_id.insert(tag.name, tag.id);
    }

    let cmd = format!("UID FETCH {} (UID X-GM-LABELS)", range);
    let response = session.run_command_and_read_response(&cmd).map_err(|e| e.to_string())?;

    let mut batch = Vec::new();

    // Parse the raw response lines
    // Example: * 1 FETCH (X-GM-LABELS ("\\Inbox" "\\Sent" "Personal") UID 1)
    for line_bytes in response.split(|&b| b == b'\n') {
        if let Ok(line) = std::str::from_utf8(line_bytes) {
            if !line.starts_with('*') { continue; }
            if !line.contains("FETCH") { continue; }
            
            // Extract UID
            let mut uid = 0;
            if let Some(uid_idx) = line.find("UID ") {
                let rest = &line[uid_idx + 4..];
                let end_idx = rest.find(' ').or_else(|| rest.find(')')).unwrap_or(rest.len());
                if let Ok(u) = rest[..end_idx].parse::<u32>() {
                    uid = u;
                }
            }
            if uid == 0 { continue; }

            // Extract X-GM-LABELS
            let mut tag_ids = Vec::new();
            if let Some(lbl_idx) = line.find("X-GM-LABELS (") {
                let rest = &line[lbl_idx + 13..];
                if let Some(end_idx) = rest.find(')') {
                    let labels_str = &rest[..end_idx];
                    
                    // Parse quotes and escaped strings. Simple space split works mostly, but labels can have spaces.
                    // "My Label" "\\Inbox"
                    let mut in_quotes = false;
                    let mut current_label = String::new();
                    let mut i = 0;
                    let chars: Vec<char> = labels_str.chars().collect();
                    
                    while i < chars.len() {
                        let c = chars[i];
                        if c == '"' {
                            in_quotes = !in_quotes;
                            if !in_quotes && !current_label.is_empty() {
                                if let Some(tid) = name_to_id.get(&current_label) {
                                    tag_ids.push(tid.clone());
                                }
                                current_label.clear();
                            }
                        } else if c == '\\' && !in_quotes && i + 1 < chars.len() {
                            // System label like \Inbox
                            let mut sys_label = String::new();
                            while i < chars.len() && chars[i] != ' ' {
                                sys_label.push(chars[i]);
                                i += 1;
                            }
                            // Map \Inbox to INBOX for Google (often mapped this way in REST API)
                            // The REST API returns "INBOX" for name when type is "system".
                            let sys_name = sys_label.replace('\\', "").to_uppercase();
                            if let Some(tid) = name_to_id.get(&sys_name) {
                                tag_ids.push(tid.clone());
                            } else {
                                // fallback exactly
                                if let Some(tid) = name_to_id.get(&sys_label) {
                                    tag_ids.push(tid.clone());
                                }
                            }
                            continue;
                        } else if !in_quotes && c == ' ' {
                            if !current_label.is_empty() {
                                if let Some(tid) = name_to_id.get(&current_label) {
                                    tag_ids.push(tid.clone());
                                }
                                current_label.clear();
                            }
                        } else {
                            if in_quotes || c != ' ' {
                                current_label.push(c);
                            }
                        }
                        i += 1;
                    }
                    if !current_label.is_empty() {
                        if let Some(tid) = name_to_id.get(&current_label) {
                            tag_ids.push(tid.clone());
                        }
                    }
                }
            }

            batch.push((uid, tag_ids));
        }
        if batch.len() >= 500 {
            database::set_message_tags_batch(app_handle, account_id, folder, &batch)?;
            batch.clear();
        }
    }

    if !batch.is_empty() {
        database::set_message_tags_batch(app_handle, account_id, folder, &batch)?;
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
    log::info!("Updating Gmail label for account {}, tag {}", account.id, tag_id);
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

    let url = format!("https://gmail.googleapis.com/gmail/v1/users/me/labels/{}", tag_id);
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
    log::info!("Deleting Gmail label for account {}, tag {}", account.id, tag_id);
    let client = Client::new();
    
    let url = format!("https://gmail.googleapis.com/gmail/v1/users/me/labels/{}", tag_id);
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
    ).map_err(|e| e.to_string())?;

    // Next, delete the tag itself
    tx.execute(
        "DELETE FROM tags WHERE account_id = ?1 AND id = ?2",
        rusqlite::params![account.id, tag_id],
    ).map_err(|e| e.to_string())?;

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
    log::info!("Creating Gmail label for account {}, name {}", account.id, name);
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
        tag_type: label.label_type.unwrap_or_else(|| "user".to_string()).to_lowercase(),
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
