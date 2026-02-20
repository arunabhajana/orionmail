use crate::auth::account::Account;
use std::time::Duration;
use native_tls::TlsConnector;
use mailparse::parse_mail;
use tauri::AppHandle;

#[derive(Debug, serde::Serialize)]
pub struct MessageHeader {
    pub uid: u32,
    pub uid_validity: u32,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub seen: bool,
    pub flagged: bool,
    pub snippet: Option<String>,
}

pub async fn get_inbox_messages(app_handle: &AppHandle, account: Account) -> Result<Vec<MessageHeader>, String> {
    let email = account.email.clone();
    let access_token = account.access_token.clone();
    let app_handle_clone = app_handle.clone();

    let handle = tokio::task::spawn_blocking(move || {
        let domain = "imap.gmail.com";
        let port = 993;

        let tls = TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS Error: {}", e))?;

        let client = imap::connect((domain, port), domain, &tls)
            .map_err(|e| format!("IMAP Connection Error: {}", e))?;

        let auth_raw = format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            email,
            access_token
        );

        struct XoAuth2 { auth_string: String }
        impl imap::Authenticator for XoAuth2 {
            type Response = String;
            fn process(&self, _: &[u8]) -> Self::Response { self.auth_string.clone() }
        }

        let auth = XoAuth2 { auth_string: auth_raw };

        let mut session = client
            .authenticate("XOAUTH2", &auth)
            .map_err(|(e, _)| format!("IMAP Authentication Failed: {}", e))?;

        let result = (|| -> Result<Vec<MessageHeader>, String> {
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
            let fetches = session.uid_fetch(uids_str, "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
                .map_err(|e| format!("IMAP UID Fetch Error: {}", e))?;

            let mut messages = Vec::new();

            for fetch in fetches.iter() {
                let content = fetch.header().or_else(|| fetch.body()).or_else(|| fetch.text());
                
                let actual_uid = fetch.uid.unwrap_or(0);
                
                if let Some(body) = content {
                    let mut subject = String::new();
                    let mut from = String::new();
                    let mut date = String::new();
                    let mut seen = false;
                    let mut flagged = false;

                    for flag in fetch.flags() {
                        match flag {
                            imap::types::Flag::Seen => seen = true,
                            imap::types::Flag::Flagged => flagged = true,
                            _ => {}
                        }
                    }

                    if let Ok(parsed) = parse_mail(body) {
                        for header in parsed.get_headers() {
                            let key = header.get_key().to_lowercase();
                            let value = header.get_value();
                            match key.as_str() {
                                "subject" => subject = value,
                                "from" => from = value,
                                "date" => date = value,
                                _ => {}
                            }
                        }
                    }

                    messages.push(MessageHeader {
                        uid: actual_uid,
                        uid_validity,
                        subject,
                        from,
                        date,
                        seen,
                        flagged,
                        snippet: None,
                    });
                }
            }

            if messages.is_empty() && !recent_uids.is_empty() {
                return Err(format!("DEBUG: Fetched {} uids but parsed 0 messages. First fetch had uid: {:?}, header_len: {:?}, body_len: {:?}, text_len: {:?}", 
                    fetches.len(),
                    fetches.get(0).map(|f| f.uid),
                    fetches.get(0).map(|f| f.header().map(|b| b.len())),
                    fetches.get(0).map(|f| f.body().map(|b| b.len())),
                    fetches.get(0).map(|f| f.text().map(|b| b.len()))
                ));
            }

            messages.sort_by(|a, b| b.uid.cmp(&a.uid));
            
            // Save to local cache
            if let Err(e) = crate::mail::database::insert_or_update_messages(&app_handle_clone, &messages) {
                log::warn!("Failed to insert messages into DB cache: {}", e);
            }

            Ok(messages)
        })();

        session.logout().map_err(|e| format!("IMAP Logout Error: {}", e))?;

        result
    });

    match tokio::time::timeout(Duration::from_secs(30), handle).await {
        Ok(join_result) => join_result.map_err(|e| e.to_string())?,
        Err(_) => Err("IMAP Connection Timeout".to_string()),
    }
}
