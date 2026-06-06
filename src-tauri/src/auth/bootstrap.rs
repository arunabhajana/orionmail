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
    let mut account = session::get_active_account(app_handle)
        .ok_or_else(|| "No active account".to_string())?;

    if account.needs_reauth {
        use tauri::Emitter;
        let _ = app_handle.emit("auth:session_expired", ());
        return Err("NEEDS_REAUTH".to_string());
    }

    let current_time = Utc::now().timestamp();
    
    if account.expires_at <= current_time && !account.refresh_token.is_empty() {
        let client_id = env!("GOOGLE_CLIENT_ID");
        let client_secret = env!("GOOGLE_CLIENT_SECRET");
        
        let http_client = Client::new();
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

        let mut refresh_failed = true;
        if let Ok(response) = res {
            if let Ok(json) = response.json::<Value>().await {
                if let Some(access_token) = json["access_token"].as_str() {
                    account.access_token = access_token.to_string();
                    let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
                    account.expires_at = Utc::now().timestamp() + expires_in;

                    if let Err(e) = crate::auth::token_store::persist_tokens(&account.id, &account.access_token, &account.refresh_token) {
                        log::error!("Failed to persist tokens during bootstrap refresh: {}", e);
                    } else {
                        account.needs_reauth = false;
                    }

                    let _ = session::save_account(app_handle, account.clone(), true);
                    refresh_failed = false;
                } else {
                    log::error!("Token refresh failed: {}", json);
                }
            }
        }

        if refresh_failed {
            use tauri::Emitter;
            let _ = app_handle.emit("auth:session_expired", ());
            return Err("TOKEN_REFRESH_FAILED".to_string());
        }
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

