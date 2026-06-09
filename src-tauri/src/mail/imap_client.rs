use crate::auth::account::Account;
use std::time::Duration;


#[derive(Debug, serde::Serialize)]
pub struct Mailbox {
    pub name: String,
    pub delimiter: String,
}

/// Establishes an IMAP connection using XOAUTH2
/// and fetches mailbox list (read-only validation step).
pub async fn get_mailboxes(account: Account) -> Result<Vec<Mailbox>, String> {
    let mailboxes_future = crate::mail::imap_session::execute_with_session(
        &account,
        crate::mail::imap_session::SessionKind::Primary,
        move |session| {
            let folders = session
                .list(None, Some("*"))
                .map_err(|e| format!("IMAP List Error: {}", e))?;

            let mailbox_data: Vec<Mailbox> = folders
                .iter()
                .map(|f| Mailbox {
                    name: f.name().to_string(),
                    delimiter: f.delimiter().unwrap_or("/").to_string(),
                })
                .collect();

            Ok(mailbox_data)
        }
    );

    match tokio::time::timeout(Duration::from_secs(30), mailboxes_future).await {
        Ok(join_result) => join_result.map_err(|e| e.to_string()),
        Err(_) => Err("IMAP Connection Timeout".to_string()),
    }
}