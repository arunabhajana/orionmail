//! Process-local authorization. Only successful native Windows Hello verification
//! can grant access; renderer state is never accepted as proof of unlock.
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct AppLockState(pub Mutex<LockSession>);

pub struct LockSession {
    enabled: bool,
    verified: bool,
}

impl LockSession {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            verified: false,
        }
    }
    fn authorize(&self) -> Result<(), String> {
        if self.enabled && !self.verified {
            Err("APP_LOCKED: Complete Windows Hello to unlock OrionMail".into())
        } else {
            Ok(())
        }
    }
    pub fn check_settings_change(&self, enabled: bool) -> Result<(), String> {
        self.authorize()?;
        if enabled && !self.enabled && !self.verified {
            return Err("Verify Windows Hello before enabling app lock".into());
        }
        Ok(())
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
}

pub fn require_unlocked(app: &AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<AppLockState>()
        .ok_or("App-lock state is unavailable")?;
    let session = state
        .0
        .lock()
        .map_err(|_| "App-lock state is unavailable")?;
    session.authorize()
}

pub fn record_native_verification(app: &AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<AppLockState>()
        .ok_or("App-lock state is unavailable")?;
    state
        .0
        .lock()
        .map_err(|_| "App-lock state is unavailable")?
        .verified = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locked_session_denies_reads_and_disabling_the_lock() {
        let session = LockSession::new(true);
        assert!(session.authorize().is_err());
        assert!(session.check_settings_change(false).is_err());
    }
    #[test]
    fn enabling_requires_native_proof_and_restart_revokes_it() {
        let mut session = LockSession::new(false);
        assert!(session.authorize().is_ok());
        assert!(session.check_settings_change(true).is_err());
        session.verified = true;
        assert!(session.check_settings_change(true).is_ok());
        session.set_enabled(true);
        assert!(session.authorize().is_ok());
        assert!(LockSession::new(true).authorize().is_err());
    }
}
