use crate::auth::account::Account;
use std::time::Duration;

use mailparse::parse_mail;
use tauri::AppHandle;

#[derive(Debug, serde::Serialize)]
pub struct MessageHeader {
    pub folder: String,
    pub uid: u32,
    pub uid_validity: u32,
    pub subject: String,
    pub from: String,
    pub date: i64,
    pub seen: bool,
    pub flagged: bool,
    pub has_attachments: bool,
    pub thread_id: Option<String>,
    pub snippet: Option<String>,
    pub to: Option<String>,
    pub message_id: Option<String>,
}

pub async fn get_inbox_messages(app_handle: &AppHandle, account: Account) -> Result<Vec<MessageHeader>, String> {
    let app_handle_clone = app_handle.clone();

    let messages_future = crate::mail::imap_session::execute_with_session(
        &account,
        crate::mail::imap_session::SessionKind::Primary,
        move |session| {
            let mailbox = session.select("INBOX").map_err(|e| format!("IMAP Select Error: {}", e))?;
            let uid_validity = mailbox.uid_validity.unwrap_or(0);

            let mut uids: Vec<u32> = session.uid_search("ALL")
                .map_err(|e| format!("IMAP UID Search Error: {}", e))?
                .into_iter()
                .collect();
            
            uids.sort();
            let recent_uids: Vec<u32> = uids.into_iter().rev().take(25).collect();

            if recent_uids.is_empty() {
                return Ok(vec![]);
            }

            let uids_str = recent_uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            let fetches = session.uid_fetch(uids_str, "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE MESSAGE-ID)])")
                .map_err(|e| format!("IMAP UID Fetch Error: {}", e))?;

            let mut messages = Vec::new();

            for fetch in fetches.iter() {
                let content = fetch.header().or_else(|| fetch.body()).or_else(|| fetch.text());
                
                let actual_uid = fetch.uid.unwrap_or(0);
                
                if let Some(body) = content {
                    let mut subject = String::new();
                    let mut from = String::new();
                    let mut to_recipient = String::new();
                    let mut date = String::new();
                    let mut message_id = None;
                    let mut seen = false;
                    let mut flagged = false;

                    for flag in fetch.flags() {
                        match flag {
                            imap::types::Flag::Seen => seen = true,
                            imap::types::Flag::Flagged => flagged = true,
                            _ => {}
                        }
                    }

                    let mut plain_body = String::new();

                    if let Ok(parsed) = parse_mail(body) {
                        for header in parsed.get_headers() {
                            let key = header.get_key().to_lowercase();
                            let value = header.get_value();
                            match key.as_str() {
                                "subject" => subject = value,
                                "from" => from = value,
                                "to" => to_recipient = value,
                                "date" => date = value,
                                "message-id" => message_id = Some(value),
                                _ => {}
                            }
                        }
                        plain_body = parsed.get_body().unwrap_or_default();
                    }

                    let clean_date = date.trim().replace('\r', "").replace('\n', "");
                    let timestamp = chrono::DateTime::parse_from_rfc2822(&clean_date)
                        .map(|dt| dt.timestamp())
                        .unwrap_or_else(|_| chrono::Utc::now().timestamp());

                    let snippet = if !plain_body.is_empty() {
                        let clean: String = plain_body
                            .replace('\n', " ")
                            .replace('\r', "")
                            .chars()
                            .take(180)
                            .collect();
                        Some(clean)
                    } else {
                        None
                    };

                    let to_opt = if to_recipient.is_empty() { None } else { Some(to_recipient.trim().to_string()) };

                    messages.push(MessageHeader {
                        folder: "inbox".to_string(),
                        uid: actual_uid,
                        uid_validity,
                        subject,
                        from,
                        date: timestamp,
                        seen,
                        flagged,
                        has_attachments: false,
                        thread_id: None,
                        snippet,
                        to: to_opt,
                        message_id,
                    });
                }
            }

            messages.sort_by(|a, b| b.uid.cmp(&a.uid));
            
            // Save to local cache
            if let Err(e) = crate::mail::database::insert_or_update_messages(&app_handle_clone, &messages) {
                log::warn!("Failed to insert messages into DB cache: {}", e);
            }

            Ok(messages)
        }
    );

    match tokio::time::timeout(Duration::from_secs(30), messages_future).await {
        Ok(join_result) => join_result.map_err(|e| e.to_string()),
        Err(_) => Err("IMAP Connection Timeout".to_string()),
    }
}
