use crate::auth::account::Account;
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, PkceCodeChallenge,
    RedirectUrl, Scope, TokenResponse, TokenUrl, RefreshToken,
};
use reqwest::Client as HttpClient;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use url::Url;

/// Orchestrates the Google OAuth 2.0 Authorization Code flow for desktop applications.
/// 
/// This function:
/// 1. Loads credentials from environment variables.
/// 2. Spins up a temporary loopback server to catch the authorization code.
/// 3. Opens the system browser for user authentication.
/// 4. Exchanges the received code for access/refresh tokens.
/// 5. Fetches the user profile from Google's UserInfo API.
pub async fn start_google_login() -> Result<Account, String> {
    crate::auth::token_store::health_check()?;
    
    dotenvy::dotenv().ok();

    let google_client_id = ClientId::new(
        std::env::var("GOOGLE_CLIENT_ID")
            .or_else(|_| option_env!("GOOGLE_CLIENT_ID").map(|s| s.to_string()).ok_or_else(|| "GOOGLE_CLIENT_ID not found".to_string()))?,
    );
    let google_client_secret = ClientSecret::new(
        std::env::var("GOOGLE_CLIENT_SECRET")
            .or_else(|_| option_env!("GOOGLE_CLIENT_SECRET").map(|s| s.to_string()).ok_or_else(|| "GOOGLE_CLIENT_SECRET not found".to_string()))?,
    );
    
    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string()).unwrap();
    let token_url = TokenUrl::new("https://www.googleapis.com/oauth2/v4/token".to_string()).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_url = format!("http://127.0.0.1:{}", port);

    let client = BasicClient::new(
        google_client_id,
        Some(google_client_secret),
        auth_url,
        Some(token_url),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).unwrap());

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let (authorize_url, _csrf_state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("https://www.googleapis.com/auth/userinfo.email".to_string()))
        .add_scope(Scope::new("https://www.googleapis.com/auth/userinfo.profile".to_string()))
        .add_scope(Scope::new("https://mail.google.com/".to_string()))
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .add_extra_param("include_granted_scopes", "true")
        .set_pkce_challenge(pkce_challenge)
        .url();



    open::that(authorize_url.as_str()).map_err(|e| e.to_string())?;

    let mut stream = listener.incoming().next().ok_or("Listener died")?.map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| e.to_string())?;

    let redirect_url_path = request_line.split_whitespace().nth(1).ok_or("Malformed request")?;
    let url = Url::parse(&format!("http://localhost{}", redirect_url_path)).map_err(|e| e.to_string())?;
    
    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| AuthorizationCode::new(value.into_owned()))
        .ok_or("No code received from Google")?;

    let token_result = client
        .exchange_code(code)
        .set_pkce_verifier(pkce_verifier)
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    let access_token = token_result.access_token().secret();
    let refresh_token = token_result
        .refresh_token()
        .map(|r| r.secret().to_string())
        .unwrap_or_default();
    
    let expires_in = token_result.expires_in().map(|d| d.as_secs()).unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in as i64;

    let http_client = HttpClient::new();
    let user_info: Value = http_client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let id = user_info["id"]
        .as_str()
        .or_else(|| user_info["sub"].as_str())
        .ok_or("Failed to identify user (missing id/sub)")?
        .to_string();

    crate::auth::token_store::persist_tokens(&id, &access_token, &refresh_token)?;

    let success_response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><script>window.close()</script><h1>Authentication Successful</h1><p>You can close this window now.</p></body></html>";
    stream.write_all(success_response.as_bytes()).ok();

    Ok(Account {
        id,
        email: user_info["email"].as_str().unwrap_or_default().to_string(),
        provider: crate::auth::account::MailProvider::Google,
        access_token: access_token.to_string(),
        refresh_token,
        needs_reauth: false,
        expires_at,
        last_sync: None,
        profile_name: user_info["name"].as_str().unwrap_or_default().to_string(),
        profile_picture: user_info["picture"].as_str().unwrap_or_default().to_string(),
    })
}

pub async fn refresh_google_token(account: &mut Account) -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let google_client_id = ClientId::new(
        std::env::var("GOOGLE_CLIENT_ID")
            .or_else(|_| option_env!("GOOGLE_CLIENT_ID").map(|s| s.to_string()).ok_or_else(|| anyhow::anyhow!("GOOGLE_CLIENT_ID not found")))?,
    );
    let google_client_secret = ClientSecret::new(
        std::env::var("GOOGLE_CLIENT_SECRET")
            .or_else(|_| option_env!("GOOGLE_CLIENT_SECRET").map(|s| s.to_string()).ok_or_else(|| anyhow::anyhow!("GOOGLE_CLIENT_SECRET not found")))?,
    );
    
    let auth_url = AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string()).unwrap();
    let token_url = TokenUrl::new("https://oauth2.googleapis.com/token".to_string()).unwrap();

    let client = BasicClient::new(
        google_client_id,
        Some(google_client_secret),
        auth_url,
        Some(token_url),
    );

    let token_result = client
        .exchange_refresh_token(&RefreshToken::new(account.refresh_token.clone()))
        .request_async(oauth2::reqwest::async_http_client)
        .await
        .map_err(|e| anyhow::anyhow!("Token exchange failed: {}", e))?;

    account.access_token = token_result.access_token().secret().to_string();
    
    if let Some(new_refresh_token) = token_result.refresh_token() {
        account.refresh_token = new_refresh_token.secret().to_string();
    }
    
    let expires_in = token_result.expires_in().map(|d| d.as_secs()).unwrap_or(3600);
    account.expires_at = chrono::Utc::now().timestamp() + expires_in as i64;

    crate::auth::token_store::persist_tokens(&account.id, &account.access_token, &account.refresh_token)
        .map_err(|e| anyhow::anyhow!("Failed to persist refreshed tokens: {}", e))?;
        
    account.needs_reauth = false;

    Ok(())
}
