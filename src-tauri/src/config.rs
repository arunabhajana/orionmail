use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use std::fs;

pub struct AppSettings {
    pub minimize_to_tray: Mutex<bool>,
    pub start_hidden: Mutex<bool>,
}

pub fn get_config_path(app: &AppHandle) -> std::path::PathBuf {
    app.path().app_config_dir().unwrap().join("config.json")
}

pub fn load_settings(app: &AppHandle) -> (bool, bool) {
    let path = get_config_path(app);
    if let Ok(contents) = fs::read_to_string(&path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&contents) {
            let min_to_tray = json["minimize_to_tray"].as_bool().unwrap_or(true);
            let start_hidden = json["start_hidden"].as_bool().unwrap_or(true);
            return (min_to_tray, start_hidden);
        }
    }
    (true, true) // Defaults
}

pub fn save_settings(app: &AppHandle, min_to_tray: bool, start_hidden: bool) {
    let path = get_config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::json!({
        "minimize_to_tray": min_to_tray,
        "start_hidden": start_hidden
    });
    let _ = fs::write(&path, json.to_string());
}

#[tauri::command]
pub fn get_app_settings(app_handle: AppHandle) -> serde_json::Value {
    let state = app_handle.state::<AppSettings>();
    let minimize_to_tray = *state.minimize_to_tray.lock().unwrap();
    let start_hidden = *state.start_hidden.lock().unwrap();
    serde_json::json!({
        "minimize_to_tray": minimize_to_tray,
        "start_hidden": start_hidden,
    })
}

#[tauri::command]
pub fn set_app_settings(app_handle: AppHandle, minimize_to_tray: bool, start_hidden: bool) {
    let state = app_handle.state::<AppSettings>();
    *state.minimize_to_tray.lock().unwrap() = minimize_to_tray;
    *state.start_hidden.lock().unwrap() = start_hidden;
    save_settings(&app_handle, minimize_to_tray, start_hidden);
}

#[tauri::command]
pub fn was_launched_minimized() -> bool {
    let args: Vec<String> = std::env::args().collect();
    args.contains(&"--minimized".to_string())
}
