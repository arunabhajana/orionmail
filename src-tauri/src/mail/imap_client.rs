use crate::auth::account::Account;
use std::time::Duration;
use native_tls::TlsConnector;

#[derive(Debug, serde::Serialize)]
pub struct Mailbox {
    pub name: String,
    pub delimiter: String,
}

/// Establishes an IMAP connection to Gmail using XOAUTH2
/// and fetches mailbox list (read-only validation step).
pub async fn get_mailboxes(account: Account) -> Result<Vec<Mailbox>, String> {
    let email = account.email.clone();
    let access_token = account.access_token.clone();

    // IMAP crate is blocking → run in blocking thread
    let handle = tokio::task::spawn_blocking(move || {
        let domain = "imap.gmail.com";
        let port = 993;

        // --------------------------------------------------
        // 1. TLS CONNECTION
        // --------------------------------------------------
        let tls = TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS Error: {}", e))?;

        let client = imap::connect((domain, port), domain, &tls)
            .map_err(|e| format!("IMAP Connection Error: {}", e))?;

        // --------------------------------------------------
        // 2. BUILD XOAUTH2 STRING (IMPORTANT)
        // DO NOT BASE64 ENCODE — imap crate does it internally
        // --------------------------------------------------
        let auth_raw = format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            email,
            access_token
        );

        // --------------------------------------------------
        // 3. AUTHENTICATOR IMPLEMENTATION
        // --------------------------------------------------
        struct XoAuth2 {
            auth_string: String,
        }

        impl imap::Authenticator for XoAuth2 {
            type Response = String;

            fn process(&self, _: &[u8]) -> Self::Response {
                self.auth_string.clone()
            }
        }

        let auth = XoAuth2 {
            auth_string: auth_raw,
        };

        // --------------------------------------------------
        // 4. AUTHENTICATE
        // --------------------------------------------------
        let mut session = client
            .authenticate("XOAUTH2", &auth)
            .map_err(|(e, _)| format!("IMAP Authentication Failed: {}", e))?;

        // --------------------------------------------------
        // 5. FETCH MAILBOXES
        // --------------------------------------------------
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

        // --------------------------------------------------
        // 6. CLEAN LOGOUT (VERY IMPORTANT)
        // --------------------------------------------------
        session
            .logout()
            .map_err(|e| format!("IMAP Logout Error: {}", e))?;

        Ok::<Vec<Mailbox>, String>(mailbox_data)
    });

    // --------------------------------------------------
    // 7. TIMEOUT PROTECTION
    // --------------------------------------------------
    match tokio::time::timeout(Duration::from_secs(30), handle).await {
        Ok(join_result) => join_result.map_err(|e| e.to_string())?,
        Err(_) => Err("IMAP Connection Timeout".to_string()),
    }
}