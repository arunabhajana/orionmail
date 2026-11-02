use crate::auth::account::Account;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub const TOKEN_KEYCHAIN_MIGRATION_V1: u32 = 1;
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
    let mut store = load_store(app_handle);
    update_store_account(&mut store, account, set_active)?;

    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    Ok(())
}

fn update_store_account(store: &mut AuthStore, account: Account, set_active: bool) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    fn account(id: &str) -> Account {
        serde_json::from_value(serde_json::json!({"id":id,"email":"same@example.com","provider":{"type":"Google"},"expires_at":0,"last_sync":null,"profile_name":"","profile_picture":""})).unwrap()
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

/// Returns all stored accounts.
pub fn load_accounts(app_handle: &AppHandle) -> Vec<Account> {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    load_store(app_handle).accounts
}

pub fn get_account(app_handle: &AppHandle, account_id: &str) -> Option<Account> {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    load_store_for(app_handle, Some(account_id)).accounts.into_iter().find(|account|account.id==account_id)
}

// Display-only consumers must not read Windows Credential Manager or trigger
// token self-healing just to draw a tray tooltip or notification attribution.
pub fn load_profile_metadata(app_handle: &AppHandle) -> (Vec<crate::auth::account::UserProfile>,Option<String>) {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    let store:AuthStore=fs::read(get_store_path(app_handle)).ok()
        .and_then(|bytes|serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    (store.accounts.into_iter().map(crate::auth::account::UserProfile::from).collect(),store.active_account_id)
}
pub fn get_active_profile(app_handle:&AppHandle)->Option<crate::auth::account::UserProfile>{
    let (profiles,active)=load_profile_metadata(app_handle);
    profiles.into_iter().find(|profile|Some(&profile.id)==active.as_ref())
}

/// Retrieves the profile currently marked as active.
pub fn get_active_account(app_handle: &AppHandle) -> Option<Account> {
    let _store = STORE_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    let store = load_store(app_handle);
    let active_id = store.active_account_id?;
    store.accounts.into_iter().find(|a| a.id == active_id)
}

/// Switches the active session to the specified account.
pub fn set_active_account(app_handle: &AppHandle, account_id: String) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    let path = get_store_path(app_handle);
    let mut store = load_store(app_handle);
    
    if store.accounts.iter().any(|a| a.id == account_id) {
        store.active_account_id = Some(account_id);
        let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Account not found".to_string())
    }
}

/// Removes an account and its tokens from the system.
pub fn remove_account(app_handle: &AppHandle, account_id: String) -> Result<(), String> {
    let _store = STORE_LOCK.lock().map_err(|_| "Account store unavailable")?;
    crate::auth::token_store::delete_tokens(&account_id);

    let path = get_store_path(app_handle);
    let mut store = load_store(app_handle);

    store.accounts.retain(|a| a.id != account_id);
    
    // Reset active ID if the deleted account was active
    if store.active_account_id.as_ref() == Some(&account_id) {
        store.active_account_id = store.accounts.first().map(|a| a.id.clone());
    }

    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    Ok(())
}

/// Internal helper to deserialize the state file.
fn load_store(app_handle: &AppHandle) -> AuthStore {
    load_store_for(app_handle, None)
}

fn load_store_for(app_handle: &AppHandle, only_account: Option<&str>) -> AuthStore {
    let path = get_store_path(app_handle);
    if !path.exists() {
        return AuthStore::default();
    }

    let content = fs::read_to_string(&path).unwrap_or_default();
    let mut store: AuthStore = serde_json::from_str(&content).unwrap_or_default();

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

    if needs_save {
        if let Ok(json) = serde_json::to_string_pretty(&store) {
            let _ = fs::write(&path, json);
        }
    }

    store
}
