use crate::auth::account::Account;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub const TOKEN_KEYCHAIN_MIGRATION_V1: u32 = 1;
pub const MAX_ACCOUNTS: usize = 3;
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AuthStore {
    #[serde(default)]
    pub migration_version: u32,
    pub accounts: Vec<Account>,
    pub active_account_id: Option<String>,
}

/// Manages persistence for user accounts and active sessions.
/// Stores data in `accounts.json` within the OS-specific app data directory.
/// Loads the JSON store path from Tauri's path resolver.
fn get_store_path(app_handle: &AppHandle) -> PathBuf {
    let mut path = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data directory");
    
    if !path.exists() {
        fs::create_dir_all(&path).ok();
    }
    path.push("accounts.json");
    path
}

/// Commits an account to persistent storage and optionally sets it as active.
pub fn save_account(app_handle: &AppHandle, account: Account, set_active: bool) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let path = get_store_path(app_handle);
    let mut store = load_store(app_handle)?;
    update_store_account(&mut store, account, set_active)?;

    write_store(&path, &store)
}

fn update_store_account(store: &mut AuthStore, account: Account, set_active: bool) -> Result<(), String> {
    if store.accounts.len() >= MAX_ACCOUNTS && !store.accounts.iter().any(|entry|entry.id == account.id) {
        return Err("You can connect up to 3 accounts. Sign out of an account before adding another.".into());
    }
    if !set_active && !store.accounts.iter().any(|entry| entry.id == account.id) {
        return Err("Account was removed during refresh".into());
    }

    // Update existing record if present, otherwise append
    if let Some(pos) = store.accounts.iter().position(|a| a.id == account.id) {
        store.accounts[pos] = account.clone();
    } else {
        store.accounts.push(account.clone());
    }

    // Update active session pointer
    if set_active || store.active_account_id.is_none() {
        store.active_account_id = Some(account.id.clone());
    }

    Ok(())
}



/// Returns the requested stored account.
pub fn get_account(app_handle: &AppHandle, account_id: &str) -> Option<Account> {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    load_store_for(app_handle, Some(account_id)).ok()?.accounts.into_iter().find(|account|account.id==account_id)
}

// Display-only consumers must not read Windows Credential Manager or trigger
// token self-healing just to draw a tray tooltip or notification attribution.
pub fn load_profile_metadata(app: &AppHandle) -> (Vec<crate::auth::account::UserProfile>,Option<String>) {
    try_load_profile_metadata(app).unwrap_or_default()
}
pub fn try_load_profile_metadata(app: &AppHandle) -> Result<(Vec<crate::auth::account::UserProfile>,Option<String>),String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let store = read_store_file(&get_store_path(app))?;
    Ok((store.accounts.into_iter().map(crate::auth::account::UserProfile::from).collect(),store.active_account_id))
}
pub fn get_active_profile(app_handle:&AppHandle)->Option<crate::auth::account::UserProfile>{
    let (profiles,active)=load_profile_metadata(app_handle);
    profiles.into_iter().find(|profile|Some(&profile.id)==active.as_ref())
}

pub fn ensure_account_capacity(app: &AppHandle, id: &str) -> Result<(), String> {
    let (profiles, _) = load_profile_metadata(app);
    if profiles.len() >= MAX_ACCOUNTS && !profiles.iter().any(|profile|profile.id == id) {
        return Err("You can connect up to 3 accounts. Sign out of an account before adding another.".into());
    }
    Ok(())
}

pub fn mark_reauth(app: &AppHandle, id: &str) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let path = get_store_path(app);
    let mut store = read_store_file(&path)?;
    if let Some(account) = store.accounts.iter_mut().find(|account|account.id == id && !account.needs_reauth) {
        account.needs_reauth = true;
        write_store(&path, &store)?;
    }
    Ok(())
}

pub fn update_profile_name(app: &AppHandle, id: &str, name: &str) -> Result<crate::auth::account::UserProfile, String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let path = get_store_path(app);
    let mut store = read_store_file(&path)?;
    let account = store.accounts.iter_mut().find(|account|account.id == id).ok_or("Account was removed")?;
    account.profile_name = name.to_string();
    let profile = crate::auth::account::UserProfile::from(account.clone());
    write_store(&path, &store)?;
    Ok(profile)
}

/// Retrieves the profile currently marked as active.
pub fn get_active_account(app_handle: &AppHandle) -> Option<Account> {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    let store = load_store(app_handle).ok()?;
    let active_id = store.active_account_id?;
    store.accounts.into_iter().find(|a| a.id == active_id)
}

/// Switches the active session to the specified account.
pub fn set_active_account(app_handle: &AppHandle, account_id: String) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let path = get_store_path(app_handle);
    let mut store = read_store_file(&path)?;
    
    if store.accounts.iter().any(|a| a.id == account_id) {
        store.active_account_id = Some(account_id);
        write_store(&path, &store)?;
        Ok(())
    } else {
        Err("Account not found".to_string())
    }
}

/// Removes an account and its tokens from the system.
pub fn remove_account(app_handle: &AppHandle, account_id: String) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;


    let path = get_store_path(app_handle);
    let mut store = read_store_file(&path)?;

    store.accounts.retain(|a| a.id != account_id);
    
    // Reset active ID if the deleted account was active
    if store.active_account_id.as_ref() == Some(&account_id) {
        store.active_account_id = store.accounts.first().map(|a| a.id.clone());
    }

    write_store(&path, &store)?;
    crate::auth::token_store::delete_tokens(&account_id);
    Ok(())
}

fn read_store_file(path: &std::path::Path) -> Result<AuthStore,String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| format!("Account store is unreadable; existing data was preserved: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AuthStore::default()),
        Err(error) => Err(format!("Could not read account store; existing data was preserved: {error}")),
    }
}
fn write_store(path: &std::path::Path, store: &AuthStore) -> Result<(),String> {
    use std::io::Write;
    // Never convert a transient read/parse failure into an empty saved account list.
    read_store_file(path)?;
    let bytes = serde_json::to_vec_pretty(store).map_err(|error|error.to_string())?;
    let temp = path.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|error|error.to_string())?;
        file.write_all(&bytes).map_err(|error|error.to_string())?;
        file.sync_all().map_err(|error|error.to_string())?;
        drop(file);
        fs::rename(&temp,path).map_err(|error|error.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

/// Internal helper to deserialize the state file.
fn load_store(app_handle: &AppHandle) -> Result<AuthStore, String> {
    load_store_for(app_handle, None)
}

fn load_store_for(app_handle: &AppHandle, only_account: Option<&str>) -> Result<AuthStore, String> {
    let path = get_store_path(app_handle);
    let mut store = read_store_file(&path)?;

    let mut needs_save = false;

    // 1. Migration
    if store.migration_version < TOKEN_KEYCHAIN_MIGRATION_V1 {
        for account in &mut store.accounts {
            if !account.access_token.is_empty() && !account.refresh_token.is_empty() {
                match crate::auth::token_store::persist_tokens(&account.id, &account.access_token, &account.refresh_token) {
                    Ok(_) => {
                        account.needs_reauth = false;
                    }
                    Err(e) => {
                        log::error!("Failed to migrate tokens for account {}: {}", account.id, e);
                        account.needs_reauth = true;
                    }
                }
            }
        }
        store.migration_version = TOKEN_KEYCHAIN_MIGRATION_V1;
        needs_save = true;
    }

    // 2. Startup Self-Healing / Reading
    if store.migration_version >= TOKEN_KEYCHAIN_MIGRATION_V1 {
        for account in &mut store.accounts {
            if only_account.is_some_and(|id|id!=account.id) { continue; }
            if account.needs_reauth {
                account.access_token = String::new();
                account.refresh_token = String::new();
                continue;
            }

            match crate::auth::token_store::get_tokens(&account.id) {
                Ok((at, rt)) => {
                    account.access_token = at;
                    account.refresh_token = rt;
                }
                Err(e) => {
                    log::warn!("Could not load tokens from keychain for account {}: {}", account.id, e);
                    account.needs_reauth = true;
                    account.access_token = String::new();
                    account.refresh_token = String::new();
                    needs_save = true;
                }
            }
        }
    }

    if needs_save { write_store(&path, &store)?; }
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn account(id: &str) -> Account {
        serde_json::from_value(serde_json::json!({"id":id,"email":"same@example.com","provider":{"type":"Google"},"expires_at":0,"last_sync":null,"profile_name":"","profile_picture":""})).unwrap()
    }
    #[test]
    fn corrupt_metadata_is_not_treated_as_an_empty_account_store() {
        let directory = std::env::temp_dir().join(format!("orion-account-test-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("accounts.json");
        fs::write(&path,b"{ interrupted write").unwrap();
        assert!(read_store_file(&path).is_err());
        assert!(write_store(&path,&AuthStore::default()).is_err());
        assert_eq!(fs::read(&path).unwrap(),b"{ interrupted write");
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn replacing_metadata_preserves_both_accounts_and_never_serializes_tokens() {
        let directory = std::env::temp_dir().join(format!("orion-account-test-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("accounts.json");
        let mut store = AuthStore::default();
        update_store_account(&mut store,account("a"),true).unwrap();
        update_store_account(&mut store,account("b"),true).unwrap();
        write_store(&path,&store).unwrap();
        store.accounts[0].profile_name="Updated alias".into();
        store.accounts[0].access_token="must-not-be-written".into();
        write_store(&path,&store).unwrap();
        let saved=read_store_file(&path).unwrap();
        assert_eq!(saved.accounts.len(),2);
        assert_eq!(saved.active_account_id.as_deref(),Some("b"));
        assert!(!fs::read_to_string(&path).unwrap().contains("must-not-be-written"));
        assert_eq!(fs::read_dir(&directory).unwrap().count(),1);
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
    #[test]
    fn account_limit_rejects_a_fourth_but_allows_reconnecting_existing_accounts() {
        let mut store = AuthStore::default();
        for id in ["a", "b", "c"] { update_store_account(&mut store, account(id), true).unwrap(); }
        assert!(update_store_account(&mut store, account("d"), true).is_err());
        assert_eq!(store.accounts.len(), 3);
        assert_eq!(store.active_account_id.as_deref(), Some("c"));
        update_store_account(&mut store, account("a"), true).unwrap();
        assert_eq!(store.accounts.len(), 3);
        assert_eq!(store.active_account_id.as_deref(), Some("a"));
    }
    #[test]
    fn background_refresh_preserves_active_account_and_cannot_restore_removed_account() {
        let mut store = AuthStore::default();
        update_store_account(&mut store, account("a"), true).unwrap();
        update_store_account(&mut store, account("b"), true).unwrap();
        update_store_account(&mut store, account("a"), true).unwrap();
        let mut refreshed = account("b");
        refreshed.expires_at = 1234;
        update_store_account(&mut store, refreshed.clone(), false).unwrap();
        assert_eq!(store.active_account_id.as_deref(),Some("a"));
        assert_eq!(store.accounts.iter().find(|account|account.id=="b").unwrap().expires_at,1234);
        store.accounts.retain(|account|account.id!="b");
        assert!(update_store_account(&mut store,refreshed,false).is_err());
        assert_eq!(store.accounts.len(),1);
    }
}
