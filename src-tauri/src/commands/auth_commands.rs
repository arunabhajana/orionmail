use crate::auth::account::UserProfile;
use crate::auth::oauth;
use crate::auth::session;
use tauri::{AppHandle, command};

#[command]
pub async fn login_google(app_handle: AppHandle) -> Result<UserProfile, String> {
    let account = oauth::start_google_login().await?;
    session::save_account(&app_handle, account.clone(), true)?;
    Ok(UserProfile::from(account))
}

#[command]
pub fn get_current_user(app_handle: AppHandle) -> Option<UserProfile> {
    session::get_active_account(&app_handle).map(UserProfile::from)
}

#[command]
pub fn list_accounts(app_handle: AppHandle) -> Vec<UserProfile> {
    session::load_accounts(&app_handle)
        .into_iter()
        .map(UserProfile::from)
        .collect()
}

#[command]
pub fn logout_user(app_handle: AppHandle, account_id: String) -> Result<(), String> {
    session::remove_account(&app_handle, account_id)
}

#[command]
pub async fn bootstrap_accounts(app_handle: AppHandle) -> Result<crate::auth::bootstrap::BootstrapResult, String> {
    Ok(crate::auth::bootstrap::bootstrap_accounts(&app_handle))
}

#[command]
pub async fn get_mailboxes(app_handle: AppHandle) -> Result<Vec<crate::mail::imap_client::Mailbox>, String> {
    let account = session::get_active_account(&app_handle)
        .ok_or_else(|| "No active account".to_string())?;
    
    crate::mail::imap_client::get_mailboxes(account).await
}

#[command]
pub async fn get_inbox_messages(app_handle: AppHandle) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    let account = session::get_active_account(&app_handle)
        .ok_or_else(|| "No active account".to_string())?;
    
    crate::mail::message_list::get_inbox_messages(&app_handle, account).await
}

#[command]
pub async fn sync_inbox(app_handle: AppHandle) -> Result<u32, String> {
    let account = session::get_active_account(&app_handle)
        .ok_or_else(|| "No active account".to_string())?;

    crate::mail::sync::sync_inbox(&app_handle, account).await
}

#[command]
pub async fn get_message_body(app_handle: AppHandle, uid: u32) -> Result<String, String> {
    let account = session::get_active_account(&app_handle)
        .ok_or_else(|| "No active account".to_string())?;

    crate::mail::message_body::get_message_body(&app_handle, account, uid).await
}

#[command]
pub fn get_cached_messages(app_handle: AppHandle) -> Result<Vec<crate::mail::message_list::MessageHeader>, String> {
    crate::mail::database::load_cached_messages(&app_handle, 25)
}
