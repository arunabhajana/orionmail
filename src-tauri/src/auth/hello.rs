use tauri::command;

#[cfg(target_os = "windows")]
use windows::{
    core::{factory, HSTRING},
    Foundation::IAsyncOperation,
    Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability},
    Win32::Foundation::HWND,
    Win32::System::WinRT::IUserConsentVerifierInterop,
};

#[cfg(target_os = "windows")]
use tauri::Manager;

#[command]
pub async fn check_hello_availability() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(operation) => match operation.get() {
                Ok(availability) => Ok(availability == UserConsentVerifierAvailability::Available),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[command]
pub async fn authenticate_hello(app: tauri::AppHandle, message: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd_isize = match app.get_webview_window("main") {
            Some(w) => match w.hwnd() {
                Ok(h) => h.0 as isize,
                Err(_) => return Err("Failed to get window handle".to_string()),
            },
            None => return Err("Main window not found".to_string()),
        };

        let result = tokio::task::spawn_blocking(move || -> Result<bool, String> {
            let hwnd = HWND(hwnd_isize as *mut std::ffi::c_void);
            let h_message = HSTRING::from(message);
            let interop = match factory::<UserConsentVerifier, IUserConsentVerifierInterop>() {
                Ok(i) => i,
                Err(e) => return Err(format!("Failed to get interop factory: {}", e)),
            };

            let operation: IAsyncOperation<UserConsentVerificationResult> = 
                match unsafe { interop.RequestVerificationForWindowAsync(hwnd, &h_message) } {
                    Ok(op) => op,
                    Err(e) => return Err(format!("Interop request failed: {}", e)),
                };

            match operation.get() {
                Ok(res) => Ok(res == UserConsentVerificationResult::Verified),
                Err(e) => Err(e.to_string()),
            }
        }).await.map_err(|e| format!("Tokio blocking error: {}", e))??;

        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Windows Hello is only supported on Windows".into())
    }
}
