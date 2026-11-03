use super::{account::{Account, UserProfile}, session};
use tauri::AppHandle;

pub fn validate_owner(active: &str, requested: Option<&str>) -> Result<(), String> {
    if requested.is_some_and(|id| id != active) {
        return Err("Account changed. Reopen the mailbox and try again.".into());
    }
    Ok(())
}

/// Capture ownership before any asynchronous work. A stale UI must never
/// reinterpret a UID, tag, attachment or draft under the newly selected account.
pub fn profile(app: &AppHandle, requested: Option<&str>) -> Result<UserProfile, String> {
    crate::auth::app_lock::require_unlocked(app)?;
    let profile = session::get_active_profile(app).ok_or("No active account")?;
    validate_owner(&profile.id, requested)?;
    Ok(profile)
}

pub async fn account(app: &AppHandle, requested: Option<&str>) -> Result<Account, String> {
    let owner = profile(app, requested)?.id;
    let account = super::bootstrap::ensure_account(app, &owner).await?;
    profile(app, Some(&owner))?;
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_requests_cannot_be_retargeted_after_switching() {
        assert!(validate_owner("a", Some("a")).is_ok());
        assert!(validate_owner("b", Some("a")).is_err());
        assert!(validate_owner("a", Some("")).is_err());
        assert!(validate_owner("a", None).is_ok()); // Legacy native callers.
    }
}
