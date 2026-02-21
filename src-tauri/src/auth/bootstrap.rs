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

/// Validates the active account and checks for token expiry.
/// Automatically attempts to refresh the Google OAuth token if expired.
pub async fn bootstrap_accounts(app_handle: &AppHandle) -> BootstrapResult {
    let mut active_account = session::get_active_account(app_handle);

    if let Some(mut account) = active_account.take() {
        let current_time = Utc::now().timestamp();
        
        if account.expires_at <= current_time && !account.refresh_token.is_empty() {
            // Attempt to refresh the token
            dotenvy::dotenv().ok();
            if let (Ok(client_id), Ok(client_secret)) = (std::env::var("GOOGLE_CLIENT_ID"), std::env::var("GOOGLE_CLIENT_SECRET")) {
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

                if let Ok(response) = res {
                    if let Ok(json) = response.json::<Value>().await {
                        if let Some(access_token) = json["access_token"].as_str() {
                            account.access_token = access_token.to_string();
                            let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
                            account.expires_at = Utc::now().timestamp() + expires_in;

                            // Persist the refreshed account
                            let _ = session::save_account(app_handle, account.clone(), true);
                        }
                    }
                }
            }
        }

        let updated_time = Utc::now().timestamp();
        let has_token = !account.access_token.is_empty();
        let is_expired = account.expires_at <= updated_time;

        return BootstrapResult {
            user: Some(UserProfile::from(account)),
            needs_refresh: !has_token || is_expired,
        };
    }

    BootstrapResult {
        user: None,
        needs_refresh: false,
    }
}
