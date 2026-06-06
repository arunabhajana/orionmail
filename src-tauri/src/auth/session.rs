use crate::auth::account::Account;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub const TOKEN_KEYCHAIN_MIGRATION_V1: u32 = 1;

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
    let path = get_store_path(app_handle);
    let mut store = load_store(app_handle);

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

    let json = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    Ok(())
}

/// Returns all stored accounts.
pub fn load_accounts(app_handle: &AppHandle) -> Vec<Account> {
    load_store(app_handle).accounts
}

/// Retrieves the profile currently marked as active.
pub fn get_active_account(app_handle: &AppHandle) -> Option<Account> {
    let store = load_store(app_handle);
    let active_id = store.active_account_id?;
    store.accounts.into_iter().find(|a| a.id == active_id)
}

/// Switches the active session to the specified account.
pub fn set_active_account(app_handle: &AppHandle, account_id: String) -> Result<(), String> {
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
