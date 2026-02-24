use crate::auth::account::Account;
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::Instant;
use native_tls::TlsConnector;

pub struct ImapSession {
    pub session: imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    pub last_used: Instant,
}

pub static GLOBAL_SESSION: Lazy<Mutex<Vec<ImapSession>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub struct SessionGuard {
    pub session: Option<ImapSession>,
    pub discard: bool,
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if self.discard {
            return; // Poisoned/Dead session; do not restore to global pool.
        }

        if let Some(mut session) = self.session.take() {
            if let Ok(mut lock) = GLOBAL_SESSION.lock() {
                // Limit the pool size to a maximum of 3 concurrent idle connections
                // to prevent connection leaks or holding too many sockets.
                if lock.len() < 3 {
                    lock.push(session);
                } else {
                    log::info!("IMAP Session pool full. Dropping excess session.");
                    let _ = session.session.logout();
                }
            }
        }
    }
}

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

pub fn execute_with_session<F, R>(account: &Account, mut f: F) -> Result<R, String>
where
    F: FnMut(&mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>) -> Result<R, String>,
{
    // Try to pop a valid session from the global pool.
    let mut session_opt = None;
    
    {
        let mut lock = GLOBAL_SESSION.lock().map_err(|_| "Failed to lock global session")?;
        
        while let Some(mut s) = lock.pop() {
            if s.last_used.elapsed().as_secs() > 30 {
                log::info!("Session idle > 30s, validating health...");
                // 1. Send NOOP to verify TCP connection is alive
                // 2. Send SELECT INBOX to guarantee mailbox context is valid and not reclaimed
                let is_healthy = s.session.noop().is_ok() && s.session.select("INBOX").is_ok();
                
                if is_healthy {
                    log::info!("Session health validation passed. Reusing session.");
                    s.last_used = Instant::now();
                    session_opt = Some(s);
                    break;
                } else {
                    log::info!("Session health validation failed. Destroying stale session.");
                    let _ = s.session.logout(); // Best effort clean close
                    // Keep looping to find a fresh one
                }
            } else {
                session_opt = Some(s);
                break; // Found a good one!
            }
        }
    }

    // Provision new session if we didn't get a valid one from the pool.
    let session = match session_opt {
        Some(s) => s,
        None => create_session(account)?,
    };

    // Wrap in our RAII guard
    let mut guard = SessionGuard {
        session: Some(session),
        discard: false,
    };

    // Execute payload
    let result = match f(&mut guard.session.as_mut().unwrap().session) {
        Ok(res) => Ok(res),
        Err(e) => {
            log::warn!("Session operation failed: {}. Attemping auto-recovery...", e);
            
            // 1. Poison the broken session. It will drop and NOT restore.
            guard.discard = true;

            // 2. Drop the guard explicitly now (it won't restore) and shadow it.
            drop(guard);

            // 3. Create a fresh session (includes SELECT INBOX).
            let new_session = create_session(account)?;

            // 4. Wrap again.
            let mut new_guard = SessionGuard {
                session: Some(new_session),
                discard: false,
            };

            // 5. Retry EXACTLY ONCE.
            let retry_result = f(&mut new_guard.session.as_mut().unwrap().session);
            
            if retry_result.is_err() {
                new_guard.discard = true; // Still broken? Discard this one too.
            }

            // Return whatever the retry resulted in.
            // Heartbeat update is handled below before the guard natively drops.
            guard = new_guard;
            retry_result
        }
    };

    // If initial (or retry) attempt succeeded, update heartbeat (ordering matters!).
    if result.is_ok() && !guard.discard {
        guard.session.as_mut().unwrap().last_used = Instant::now();
    }

    // guard drops here organically (or via early returns), restoring valid sessions safely.
    result
}
