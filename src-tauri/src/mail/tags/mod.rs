pub mod gmail;
pub mod assignment;
pub mod cache;
pub mod refresh;
pub mod outbox;

use crate::auth::account::{Account, MailProvider};
use tauri::AppHandle;

pub async fn sync_tags(app_handle: &AppHandle, account: &Account) -> Result<(), String> {
    match account.provider {
        MailProvider::Google => gmail::sync_tags(app_handle, account).await,
        _ => {
            log::info!("Tag sync not implemented for {:?}", account.provider);
            Ok(())
        }
    }
}

pub fn sync_message_tags(
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    range: &str,
    folder: &str,
    account_id: &str,
    provider: &MailProvider,
    app_handle: &AppHandle,
) -> Result<(), String> {
    match provider {
        MailProvider::Google => gmail::sync_message_tags(session, range, folder, account_id, app_handle),
        _ => Ok(())
    }
}

pub async fn update_tag(
    app_handle: &AppHandle,
    account: &Account,
    tag_id: &str,
    name: &str,
    bg_color: Option<&str>,
    text_color: Option<&str>,
) -> Result<(), String> {
    match account.provider {
        MailProvider::Google => gmail::update_tag(app_handle, account, tag_id, name, bg_color, text_color).await,
        _ => Err("Provider does not support updating tags".to_string()),
    }
}

pub async fn create_tag(
    app_handle: &AppHandle,
    account: &Account,
    name: &str,
    bg_color: Option<&str>,
    text_color: Option<&str>,
) -> Result<(), String> {
    match account.provider {
        MailProvider::Google => gmail::create_tag(app_handle, account, name, bg_color, text_color).await,
        _ => Err("Provider does not support creating tags yet".to_string()),
    }
}

pub async fn delete_tag(
    app_handle: &AppHandle,
    account: &Account,
    tag_id: &str,
) -> Result<(), String> {
    match account.provider {
        MailProvider::Google => gmail::delete_tag(app_handle, account, tag_id).await,
        _ => Err("Provider does not support deleting tags".to_string()),
    }
}
