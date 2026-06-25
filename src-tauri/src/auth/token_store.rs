use windows::Win32::Security::Credentials::{
    CredWriteW, CredReadW, CredDeleteW, CredFree, CREDENTIALW, CRED_PERSIST, CRED_FLAGS, CRED_TYPE,
};
use windows::Win32::Foundation::FILETIME;
use windows::core::{PWSTR, PCWSTR};
use zeroize::Zeroize;

const SERVICE_ACCESS: &str = "orionmail.access";
const SERVICE_REFRESH: &str = "orionmail.refresh";

#[derive(Zeroize)]
#[zeroize(drop)]
struct StoredToken {
    token: String,
}

pub struct Credential {
    pub secret: String,
}

pub fn read_credential(target: &str) -> Result<Credential, String> {
    let target_utf16: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
    
    unsafe {
        CredReadW(
            PCWSTR(target_utf16.as_ptr()),
            CRED_TYPE(1), // GENERIC_CREDENTIAL
            0,
            &mut cred,
        ).map_err(|e| format!("CredReadW failed: {}", e))?;
        
        if cred.is_null() {
            return Err("Credential not found".to_string());
        }
        
        let blob_ptr = (*cred).CredentialBlob as *const u16;
        let blob_len = (*cred).CredentialBlobSize as usize / 2;
        let secret_slice = std::slice::from_raw_parts(blob_ptr, blob_len);
        let secret = String::from_utf16_lossy(secret_slice);
        
        CredFree(cred as *const std::ffi::c_void);
        
        Ok(Credential { secret })
    }
}

pub fn write_credential(target: &str, val: Credential) -> Result<(), String> {
    let mut target_utf16: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut secret_utf16: Vec<u16> = val.secret.encode_utf16().chain(std::iter::once(0)).collect();
    let mut user_utf16: Vec<u16> = "".encode_utf16().chain(std::iter::once(0)).collect();

    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE(1), // GENERIC_CREDENTIAL
        TargetName: PWSTR(target_utf16.as_mut_ptr()),
        Comment: PWSTR(std::ptr::null_mut()),
        LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
        CredentialBlobSize: (secret_utf16.len() - 1) as u32 * 2, // Exclude null terminator
        CredentialBlob: secret_utf16.as_mut_ptr() as *mut u8,
        Persist: CRED_PERSIST(2), // CRED_PERSIST_LOCAL_MACHINE
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: PWSTR(std::ptr::null_mut()),
        UserName: PWSTR(user_utf16.as_mut_ptr()),
    };

    unsafe {
        CredWriteW(&cred, 0).map_err(|e| format!("CredWriteW failed: {}", e))?;
    }
    Ok(())
}

pub fn delete_credential(target: &str) -> Result<(), String> {
    let target_utf16: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        CredDeleteW(PCWSTR(target_utf16.as_ptr()), CRED_TYPE(1), 0).map_err(|e| format!("CredDeleteW failed: {}", e))?;
    }
    Ok(())
}

/// Atomic persistence.
/// Returns success only if both tokens are stored and explicitly verified.
pub fn persist_tokens(account_id: &str, access_token: &str, refresh_token: &str) -> Result<(), String> {
    let at = StoredToken { token: access_token.to_string() };
    let rt = StoredToken { token: refresh_token.to_string() };

    let target_access = format!("{}_{}", SERVICE_ACCESS, account_id);
    let target_refresh = format!("{}_{}", SERVICE_REFRESH, account_id);

    // Atomic persistence: write both, then verify both
    write_credential(
        &target_access,
        Credential {
            secret: at.token.clone(),
        }
    )?;

    if let Err(e) = write_credential(
        &target_refresh,
        Credential {
            secret: rt.token.clone(),
        }
    ) {
        log::error!("persist_tokens: writing refresh token failed: {}", e);
        let _ = delete_credential(&target_access); // Rollback access token if refresh fails
        return Err(e);
    }

    // Verify
    let read_access_cred = read_credential(&target_access)?;
    let read_refresh_cred = read_credential(&target_refresh)?;

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
            return Err(e);
        }
    };
    let refresh_token = match read_credential(&target_refresh) {
        Ok(c) => c.secret,
        Err(e) => {
            log::error!("get_tokens: reading refresh token failed: {:?}", e);
            return Err(e);
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
    )?;

    let read_cred = read_credential(target)?;
    
    if read_cred.secret != "health_check_test" {
        return Err("Keychain readback verification failed".to_string());
    }
    let _ = delete_credential(target);
    Ok(())
}

