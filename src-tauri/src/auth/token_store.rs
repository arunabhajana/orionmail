use wincredentials::{write_credential, read_credential, delete_credential, credential::Credential};
use zeroize::Zeroize;

const SERVICE_ACCESS: &str = "orionmail.access";
const SERVICE_REFRESH: &str = "orionmail.refresh";

#[derive(Zeroize)]
#[zeroize(drop)]
struct StoredToken {
    token: String,
}

/// Atomic persistence.
/// Returns success only if both tokens are stored and explicitly verified.
pub fn persist_tokens(account_id: &str, access_token: &str, refresh_token: &str) -> Result<(), String> {
    let mut at = StoredToken { token: access_token.to_string() };
    let mut rt = StoredToken { token: refresh_token.to_string() };

    let target_access = format!("{}_{}", SERVICE_ACCESS, account_id);
    let target_refresh = format!("{}_{}", SERVICE_REFRESH, account_id);

    // Atomic persistence: write both, then verify both
    write_credential(
        &target_access,
        Credential {
            secret: at.token.clone(),
        }
    ).map_err(|e| e.to_string())?;

    if let Err(e) = write_credential(
        &target_refresh,
        Credential {
            secret: rt.token.clone(),
        }
    ) {
        log::error!("persist_tokens: writing refresh token failed: {}", e);
        let _ = delete_credential(&target_access); // Rollback access token if refresh fails
        return Err(e.to_string());
    }

    // Verify
    let read_access_cred = read_credential(&target_access).map_err(|e| e.to_string())?;
    let read_refresh_cred = read_credential(&target_refresh).map_err(|e| e.to_string())?;

    if read_access_cred.secret != at.token || read_refresh_cred.secret != rt.token {
        log::error!("persist_tokens: verify failed!");
        let _ = delete_credential(&target_access);
        let _ = delete_credential(&target_refresh);
        return Err("Keychain readback verification failed".to_string());
    }

    // Cleanup memory manually via Zeroize drop trait happens automatically for `at` and `rt`
    Ok(())
}

pub fn get_tokens(account_id: &str) -> Result<(String, String), String> {
    let target_access = format!("{}_{}", SERVICE_ACCESS, account_id);
    let target_refresh = format!("{}_{}", SERVICE_REFRESH, account_id);

    let access_token = match read_credential(&target_access) {
        Ok(c) => c.secret,
        Err(e) => {
            log::error!("get_tokens: reading access token failed: {:?}", e);
            return Err(e.to_string());
        }
    };
    let refresh_token = match read_credential(&target_refresh) {
        Ok(c) => c.secret,
        Err(e) => {
            log::error!("get_tokens: reading refresh token failed: {:?}", e);
            return Err(e.to_string());
        }
    };

    if access_token.is_empty() || refresh_token.is_empty() {
        log::error!("get_tokens: empty token found!");
        return Err("Empty token found in keychain".to_string());
    }

    Ok((access_token, refresh_token))
}

pub fn delete_tokens(account_id: &str) {
    let target_access = format!("{}_{}", SERVICE_ACCESS, account_id);
    let target_refresh = format!("{}_{}", SERVICE_REFRESH, account_id);
    
    let _ = delete_credential(&target_access);
    let _ = delete_credential(&target_refresh);
}

pub fn health_check() -> Result<(), String> {
    let target = "orionmail.health_startup";
    write_credential(
        target,
        Credential {
            secret: "health_check_test".to_string(),
        }
    ).map_err(|e| e.to_string())?;

    let read_cred = read_credential(target).map_err(|e| e.to_string())?;
    
    if read_cred.secret != "health_check_test" {
        return Err("Keychain readback verification failed".to_string());
    }
    let _ = delete_credential(target);
    Ok(())
}
