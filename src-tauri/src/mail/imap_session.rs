use crate::auth::account::Account;
use once_cell::sync::Lazy;
use std::sync::Mutex as StdMutex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use std::time::Instant;
use native_tls::TlsConnector;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SessionKind {
    Primary,
    Prefetch,
}

pub struct ImapSession {
    pub session: imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    pub last_used: Instant,
}

pub struct ManagedSession {
    pub session: Arc<AsyncMutex<Option<ImapSession>>>,
}

pub static SESSION_MANAGER: Lazy<StdMutex<HashMap<(String, SessionKind), Arc<ManagedSession>>>> = 
    Lazy::new(|| StdMutex::new(HashMap::new()));

pub fn create_session(account: &Account) -> Result<ImapSession, String> {
    let mut session = connect_and_authenticate(account)?;

    // GUARANTEE: Always select INBOX on fresh creation
    session.select("INBOX").map_err(|e| format!("IMAP Select Error: {}", e))?;

    log::info!("Created new IMAP Session.");

    Ok(ImapSession {
        session,
        last_used: Instant::now(),
    })
}

/// Helper function to establish a fresh, authenticated connection to the IMAP server.
fn connect_and_authenticate(
    account: &Account,
) -> Result<imap::Session<native_tls::TlsStream<std::net::TcpStream>>, String> {
    let domain = "imap.gmail.com";
    let port = 993;

    let tls = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("TLS Builder Error: {}", e))?;

    let client = imap::connect((domain, port), domain, &tls)
        .map_err(|e| format!("IMAP Connection Error: {}", e))?;

    let auth_raw = format!(
        "user={}\x01auth=Bearer {}\x01\x01",
        account.email, account.access_token
    );

    // Custom Authenticator implementation for XOAUTH2
    struct XoAuth2 { auth_string: String }
    
    impl imap::Authenticator for XoAuth2 {
        type Response = String;
        fn process(&self, _: &[u8]) -> Self::Response { 
            self.auth_string.clone() 
        }
    }

    let auth = XoAuth2 { auth_string: auth_raw };

    let session = client
        .authenticate("XOAUTH2", &auth)
        .map_err(|(e, _)| format!("IMAP Authentication Failed: {}", e))?;

    Ok(session)
}

pub async fn execute_with_session<F, R>(account: &Account, kind: SessionKind, mut f: F) -> Result<R, String>
where
    F: FnMut(&mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    // 1. Get or create the ManagedSession for this Account+Kind
    let session_arc = {
        let mut pools = SESSION_MANAGER.lock().unwrap();
        let key = (account.email.clone(), kind);
        let managed = pools.entry(key).or_insert_with(|| Arc::new(ManagedSession {
            session: Arc::new(AsyncMutex::new(None)),
        }));
        managed.session.clone()
    };

    // 2. Asynchronously acquire the lock token for the session.
    // If another task is using the Prefetch session, this task safely yields without blocking an OS thread.
    let mut owned_guard = session_arc.lock_owned().await;

    let account_clone = account.clone();

    // 3. Move the owned guard into the blocking task to perform IMAP network I/O
    tokio::task::spawn_blocking(move || {
        // We now have exclusive mutable access to the Option<ImapSession>
        
        let mut is_healthy = false;
        if let Some(s) = owned_guard.as_mut() {
            if s.last_used.elapsed().as_secs() > 30 {
                log::info!("Session idle > 30s, validating health...");
                // 1. Send NOOP to verify TCP connection is alive
                // 2. Send SELECT INBOX to guarantee mailbox context is valid and not reclaimed
                if s.session.noop().is_ok() && s.session.select("INBOX").is_ok() {
                    is_healthy = true;
                    s.last_used = Instant::now();
                    log::info!("Session health validation passed. Reusing session.");
                } else {
                    log::info!("Session health validation failed. Destroying stale session.");
                    let _ = s.session.logout();
                }
            } else {
                is_healthy = true;
            }
        }

        if !is_healthy {
            // Overwrite with a fresh session
            *owned_guard = Some(create_session(&account_clone)?);
        }

        let imap_session_wrapper = owned_guard.as_mut().unwrap();

        // 4. Execute the closure
        let result = f(&mut imap_session_wrapper.session);

        if result.is_err() {
            log::warn!("Session operation failed. Attempting auto-recovery...");
            let _ = imap_session_wrapper.session.logout(); // poison
            *owned_guard = None; // discard
            
            // Recreate
            let mut new_session = match create_session(&account_clone) {
                Ok(s) => s,
                Err(e) => return Err(e),
            };

            let retry_result = f(&mut new_session.session);
            if retry_result.is_ok() {
                new_session.last_used = Instant::now();
                *owned_guard = Some(new_session);
            }
            // If retry fails, owned_guard remains None.
            return retry_result;
        }

        // Heartbeat update
        imap_session_wrapper.last_used = Instant::now();
        result
        
        // owned_guard drops here, releasing the tokio async mutex naturally!
    }).await.map_err(|e| format!("Spawn blocking error: {}", e))?
}
