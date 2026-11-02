use crate::auth::session;
use crate::auth::account::UserProfile;
use tauri::AppHandle;
use chrono::Utc;
use reqwest::Client;
use serde_json::Value;

#[derive(Debug, serde::Serialize)]
pub struct BootstrapResult {
    pub user: Option<UserProfile>,
    pub needs_refresh: bool,
}

pub async fn ensure_active_account(app_handle: &AppHandle) -> Result<crate::auth::account::Account, String> {
    let id = session::get_active_profile(app_handle).ok_or("No active account")?.id;
    ensure_account(app_handle, &id).await
}

static REFRESH_LOCKS: once_cell::sync::Lazy<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>> = once_cell::sync::Lazy::new(Default::default);

/// Background work always resolves its owning account, independent of the UI.
pub async fn ensure_account(app_handle: &AppHandle, account_id: &str) -> Result<crate::auth::account::Account, String> {
    crate::auth::app_lock::require_unlocked(app_handle)?;
    let lock = REFRESH_LOCKS.lock().map_err(|_| "Account refresh unavailable")?
        .entry(account_id.to_string()).or_default().clone();
    let _refresh = lock.lock().await;
    let mut account = session::get_account(app_handle, account_id)
        .ok_or("Account is no longer available")?;

    if account.needs_reauth {
        emit_expired(app_handle, account_id);
        return Err("NEEDS_REAUTH".to_string());
    }

    let current_time = Utc::now().timestamp();
    
    // Proactively refresh the token 5 minutes before it actually expires to prevent
    // mid-flight authentication failures on long-running IMAP connections.
    if matches!(account.provider, crate::auth::account::MailProvider::Google) && account.expires_at <= current_time + 300 && !account.refresh_token.is_empty() {
        let client_id = std::env::var("GOOGLE_CLIENT_ID")
            .unwrap_or_else(|_| option_env!("GOOGLE_CLIENT_ID").unwrap_or("").to_string());
        let client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
            .unwrap_or_else(|_| option_env!("GOOGLE_CLIENT_SECRET").unwrap_or("").to_string());
        
        let http_client = Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
        let payload = format!(
            "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
            url::form_urlencoded::byte_serialize(client_id.as_bytes()).collect::<String>(),
            url::form_urlencoded::byte_serialize(client_secret.as_bytes()).collect::<String>(),
            url::form_urlencoded::byte_serialize(account.refresh_token.as_bytes()).collect::<String>()
        );

        let res = http_client.post("https://oauth2.googleapis.com/token")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(payload)
            .send()
            .await;

        let mut session_expired = false;
        match res {
            Ok(response) => {
                if response.status().is_client_error() && response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
                    log::error!("Token refresh rejected by Google (Session Expired)");
                    session_expired = true;
                } else if let Ok(json) = response.json::<Value>().await {
                    if let Some(access_token) = json["access_token"].as_str() {
                        account.access_token = access_token.to_string();
                        let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
                        account.expires_at = Utc::now().timestamp() + expires_in;

                        if let Err(e) = crate::auth::token_store::persist_tokens(&account.id, &account.access_token, &account.refresh_token) {
                            log::error!("Failed to persist tokens during bootstrap refresh: {}", e);
                        } else {
                            account.needs_reauth = false;
                        }

                        session::save_account(app_handle, account.clone(), false)?;
                    } else {
                        log::error!("Token refresh response did not contain an access token");
                    }
                }
            }
            Err(e) => {
                log::warn!("Network error during token refresh: {}", e);
            }
        }

        if session_expired {
            emit_expired(app_handle, account_id);
            return Err("SESSION_EXPIRED".to_string());
        }
        if account.expires_at <= Utc::now().timestamp() { return Err("TOKEN_REFRESH_FAILED".into()); }
    }

    Ok(account)
}

/// Validates the active account and checks for token expiry.
/// Automatically attempts to refresh the Google OAuth token if expired.
pub async fn bootstrap_accounts(app_handle: &AppHandle) -> BootstrapResult {
    match ensure_active_account(app_handle).await {
        Ok(account) => BootstrapResult {
            user: Some(UserProfile::from(account)),
            needs_refresh: false,
        },
        Err(_) => BootstrapResult {
            user: None,
            needs_refresh: true,
        }
    }
}


fn emit_expired(app: &AppHandle, account_id: &str) {
    use tauri::Emitter;
    if session::get_active_profile(app).is_some_and(|profile| profile.id == account_id) {
        let _ = app.emit("auth:session_expired", ());
    } else {
        let _ = app.emit("auth:account_expired", serde_json::json!({"account_id":account_id}));
    }
}
