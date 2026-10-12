use once_cell::sync::Lazy;
use serde::Serialize;
use std::{collections::HashMap, io::Read, sync::{Arc, Mutex}, time::{Duration, Instant}};

pub const MAX_ATTACHMENTS: usize = 25;
pub const MAX_ATTACHMENT_BYTES: usize = 18 * 1024 * 1024;
const HANDLE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_STORED_ATTACHMENT_BYTES: usize = 72 * 1024 * 1024;

static SELECTED_ATTACHMENTS: Lazy<Mutex<HashMap<String, SelectedAttachment>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentMetadata {
    pub handle: String,
    pub name: String,
    pub size: usize,
    pub mime_type: String,
}

#[derive(Debug, Clone)]
pub struct AttachmentData {
    pub name: String,
    pub mime_type: String,
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Debug)]
struct SelectedAttachment {
    account_id: String,
    name: String,
    mime_type: String,
    bytes: Arc<Vec<u8>>,
    created_at: Instant,
}

fn purge_expired(store: &mut HashMap<String, SelectedAttachment>) {
    store.retain(|_, attachment| attachment.created_at.elapsed() < HANDLE_TTL);
}

pub fn pick_for_account(app: &tauri::AppHandle, account_id: &str) -> Result<Vec<AttachmentMetadata>, String> {
    use tauri_plugin_dialog::DialogExt;

    let paths = app.dialog().file().blocking_pick_files().unwrap_or_default();
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if paths.len() > MAX_ATTACHMENTS {
        return Err(format!("You can attach at most {} files", MAX_ATTACHMENTS));
    }

    let mut selected = Vec::with_capacity(paths.len());
    let mut total_bytes = 0usize;
    for file_path in paths {
        let path = file_path.into_path().map_err(|error| format!("Could not access selected file: {}", error))?;
        let file = std::fs::File::open(&path).map_err(|error| format!("Could not open selected file: {}", error))?;
        let metadata = file.metadata().map_err(|error| format!("Could not inspect selected file: {}", error))?;
        if !metadata.file_type().is_file() {
            return Err("Attachments must be regular files".to_string());
        }
        let file_size = usize::try_from(metadata.len()).map_err(|_| "Attachment is too large".to_string())?;
        if file_size > MAX_ATTACHMENT_BYTES || total_bytes.saturating_add(file_size) > MAX_ATTACHMENT_BYTES {
            return Err("Attachments exceed the 18 MB total size limit".to_string());
        }

        // Snapshot bytes from the opened file now. The SMTP layer never reopens a renderer path,
        // and later filesystem changes cannot swap the content behind this handle.
        let mut bytes = Vec::with_capacity(file_size);
        file.take((MAX_ATTACHMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read selected file: {}", error))?;
        if bytes.len() > MAX_ATTACHMENT_BYTES || total_bytes.saturating_add(bytes.len()) > MAX_ATTACHMENT_BYTES {
            return Err("Attachments exceed the 18 MB total size limit".to_string());
        }
        total_bytes += bytes.len();
        let name = path.file_name().and_then(|name| name.to_str()).ok_or_else(|| "Selected file has an invalid name".to_string())?.to_string();
        let mime_type = mime_guess::from_path(&path).first_or_octet_stream().to_string();
        selected.push((AttachmentMetadata {
            handle: uuid::Uuid::new_v4().to_string(),
            name: name.clone(),
            size: bytes.len(),
            mime_type: mime_type.clone(),
        }, SelectedAttachment {
            account_id: account_id.to_string(),
            name,
            mime_type,
            bytes: Arc::new(bytes),
            created_at: Instant::now(),
        }));
    }

    let mut store = SELECTED_ATTACHMENTS.lock().map_err(|_| "Attachment store is unavailable".to_string())?;
    purge_expired(&mut store);
    let retained_bytes = store.values().map(|attachment| attachment.bytes.len()).sum::<usize>();
    let new_bytes = selected.iter().map(|(_, attachment)| attachment.bytes.len()).sum::<usize>();
    if store.len().saturating_add(selected.len()) > MAX_ATTACHMENTS * 4
        || retained_bytes.saturating_add(new_bytes) > MAX_STORED_ATTACHMENT_BYTES
    {
        return Err("Too many temporary attachments are open; remove some or reopen the compose window".to_string());
    }
    for (metadata, attachment) in &selected {
        store.insert(metadata.handle.clone(), SelectedAttachment {
            account_id: attachment.account_id.clone(),
            name: attachment.name.clone(),
            mime_type: attachment.mime_type.clone(),
            bytes: attachment.bytes.clone(),
            created_at: attachment.created_at,
        });
    }
    Ok(selected.into_iter().map(|(metadata, _)| metadata).collect())
}

pub fn load_for_send(account_id: &str, handles: &[String]) -> Result<Vec<AttachmentData>, String> {
    if handles.len() > MAX_ATTACHMENTS {
        return Err(format!("You can attach at most {} files", MAX_ATTACHMENTS));
    }
    let mut store = SELECTED_ATTACHMENTS.lock().map_err(|_| "Attachment store is unavailable".to_string())?;
    purge_expired(&mut store);
    load_for_send_from_store(&store, account_id, handles)
}

fn load_for_send_from_store(
    store: &HashMap<String, SelectedAttachment>,
    account_id: &str,
    handles: &[String],
) -> Result<Vec<AttachmentData>, String> {
    if handles.len() > MAX_ATTACHMENTS {
        return Err(format!("You can attach at most {} files", MAX_ATTACHMENTS));
    }
    let mut total_bytes = 0usize;
    let mut attachments = Vec::with_capacity(handles.len());
    for handle in handles {
        let attachment = store.get(handle).ok_or_else(|| "An attachment expired or is no longer available; select it again".to_string())?;
        if attachment.account_id != account_id {
            return Err("Attachment handle does not belong to the active account".to_string());
        }
        total_bytes = total_bytes.checked_add(attachment.bytes.len()).ok_or_else(|| "Attachment size limit exceeded".to_string())?;
        if total_bytes > MAX_ATTACHMENT_BYTES {
            return Err("Attachments exceed the 18 MB total size limit".to_string());
        }
        attachments.push(AttachmentData {
            name: attachment.name.clone(),
            mime_type: attachment.mime_type.clone(),
            bytes: attachment.bytes.clone(),
        });
    }
    Ok(attachments)
}

pub fn release_handles(account_id: &str, handles: &[String]) {
    if let Ok(mut store) = SELECTED_ATTACHMENTS.lock() {
        for handle in handles {
            if store.get(handle).is_some_and(|attachment| attachment.account_id == account_id) {
                store.remove(handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(account_id: &str, size: usize) -> SelectedAttachment {
        SelectedAttachment {
            account_id: account_id.to_string(),
            name: "file.bin".to_string(),
            mime_type: "application/octet-stream".to_string(),
            bytes: Arc::new(vec![0; size]),
            created_at: Instant::now(),
        }
    }

    #[test]
    fn opaque_handle_must_exist_and_belong_to_active_account() {
        let mut store = HashMap::new();
        store.insert("known-handle".to_string(), stored("account-a", 4));
        assert!(load_for_send_from_store(&store, "account-a", &["forged".to_string()]).is_err());
        assert!(load_for_send_from_store(&store, "account-b", &["known-handle".to_string()]).is_err());
        assert_eq!(load_for_send_from_store(&store, "account-a", &["known-handle".to_string()]).unwrap()[0].bytes.len(), 4);
    }

    #[test]
    fn backend_rejects_more_than_the_attachment_count_limit() {
        let mut store = HashMap::new();
        let handles = (0..=MAX_ATTACHMENTS).map(|index| {
            let handle = format!("handle-{index}");
            store.insert(handle.clone(), stored("account-a", 1));
            handle
        }).collect::<Vec<_>>();
        assert!(load_for_send_from_store(&store, "account-a", &handles).is_err());
    }

    #[test]
    fn backend_rejects_total_bytes_above_limit_even_when_each_file_is_small_enough() {
        let mut store = HashMap::new();
        store.insert("first".to_string(), stored("account-a", MAX_ATTACHMENT_BYTES / 2));
        store.insert("second".to_string(), stored("account-a", MAX_ATTACHMENT_BYTES / 2 + 1));
        let handles = vec!["first".to_string(), "second".to_string()];
        assert!(load_for_send_from_store(&store, "account-a", &handles).is_err());
    }

    #[test]
    fn expired_attachment_handles_are_purged() {
        let mut store = HashMap::new();
        let mut expired = stored("account-a", 1);
        expired.created_at = Instant::now() - HANDLE_TTL - Duration::from_secs(1);
        store.insert("expired".to_string(), expired);
        purge_expired(&mut store);
        assert!(store.is_empty());
    }
}
