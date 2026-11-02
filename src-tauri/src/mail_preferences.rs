use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use std::sync::Mutex;
use chrono::Timelike;
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static CACHE: once_cell::sync::OnceCell<std::sync::RwLock<MailPreferences>> = once_cell::sync::OnceCell::new();
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct MailPreferences {
    pub download_folder: String,
    pub cache_retention: String,
    pub cache_budget: String,
    pub taskbar_badge: bool,
    pub dnd_enabled: bool,
    pub desktop_notifications: bool,
    pub notification_sound: bool,
    pub hide_notification_content: bool,
    pub quiet_hours: bool,
    pub quiet_start: String,
    pub quiet_end: String,
    pub sync_paused: bool,
    pub poll_interval: String,
    pub prefetch_bodies: bool,
}
impl Default for MailPreferences {
    fn default() -> Self { Self { download_folder:String::new(),cache_retention:"30".into(),cache_budget:"512".into(),taskbar_badge:true,dnd_enabled: false, desktop_notifications: true, notification_sound: true,
        hide_notification_content: false, quiet_hours: false, quiet_start: "22:00".into(), quiet_end: "08:00".into(),
        sync_paused: false, poll_interval: "180".into(), prefetch_bodies: true } }
}
fn minutes(value: &str) -> Option<u32> {
    if value.len() != 5 || value.as_bytes()[2] != b':' { return None; }
    let hour: u32 = value.get(..2)?.parse().ok()?;
    let minute: u32 = value.get(3..)?.parse().ok()?;
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
}
impl MailPreferences {
    pub fn notifications_allowed(&self) -> bool {
        if !self.desktop_notifications || self.dnd_enabled { return false; }
        if !self.quiet_hours { return true; }
        let now = chrono::Local::now();
        let current = now.hour() * 60 + now.minute();
        let (Some(start), Some(end)) = (minutes(&self.quiet_start), minutes(&self.quiet_end)) else { return false; };
        let quiet = if start < end { current >= start && current < end } else { current >= start || current < end };
        !quiet
    }
    fn validate(&self) -> Result<(), String> {
        if !["0","7","30","90"].contains(&self.cache_retention.as_str()) || !["0","256","512","1024"].contains(&self.cache_budget.as_str()) { return Err("Invalid cache policy".into()); }
        if !self.download_folder.is_empty() {
            let directory=std::path::Path::new(&self.download_folder);
            if self.download_folder.len()>1000 || !directory.is_absolute() { return Err("Choose an absolute download folder".into()); }
        }
        if minutes(&self.quiet_start).is_none() || minutes(&self.quiet_end).is_none() { return Err("Invalid quiet hours".into()); }
        if !["60", "180", "300", "900"].contains(&self.poll_interval.as_str()) { return Err("Invalid sync interval".into()); }
        Ok(())
    }
}
fn path(app: &AppHandle) -> std::path::PathBuf { crate::config::get_config_path(app).with_file_name("mail-preferences.json") }
pub fn load(app: &AppHandle) -> MailPreferences {
    CACHE.get_or_init(|| {
        let preferences = std::fs::read(path(app)).ok()
            .and_then(|bytes| serde_json::from_slice::<MailPreferences>(&bytes).ok())
            .filter(|prefs| prefs.validate().is_ok()).unwrap_or_default();
        std::sync::RwLock::new(preferences)
    }).read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
}
#[tauri::command]
pub fn get_mail_preferences(app_handle: AppHandle) -> MailPreferences { load(&app_handle) }
#[tauri::command]
pub fn set_mail_preferences(app_handle: AppHandle, preferences: MailPreferences) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    preferences.validate()?;
    if !preferences.download_folder.is_empty() && preferences.download_folder!=load(&app_handle).download_folder && !std::path::Path::new(&preferences.download_folder).is_dir(){return Err("Choose an existing download folder".into());}
    let _guard = WRITE_LOCK.lock().map_err(|_| "Preferences unavailable")?;
    let path = path(&app_handle);
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&preferences).map_err(|e| e.to_string())?;
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())?;
    // Publish only after the atomic file replacement succeeds. Every worker
    // observes an in-app preference change without reopening JSON per job.
    let cache = CACHE.get_or_init(|| std::sync::RwLock::new(preferences.clone()));
    *cache.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = preferences;
    crate::mail::notifications::refresh_policy(&app_handle);
    crate::tray_state::update_tray_now(&app_handle);
    crate::cache_preferences::kick(&app_handle,true);
    Ok(())
}

#[tauri::command]
pub fn get_download_folder(app_handle:AppHandle)->Result<String,String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let chosen=load(&app_handle).download_folder;
    if !chosen.is_empty()&&std::path::Path::new(&chosen).is_dir(){return Ok(chosen);}
    app_handle.path().download_dir().map(|path|path.to_string_lossy().into_owned()).map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn legacy_preferences_keep_values_and_gain_cache_defaults(){
        let prefs:MailPreferences=serde_json::from_str(r#"{"desktopNotifications":false,"pollInterval":"300"}"#).unwrap();
        assert!(!prefs.desktop_notifications);assert_eq!(prefs.poll_interval,"300");assert_eq!(prefs.cache_retention,"30");assert!(prefs.taskbar_badge);assert!(prefs.download_folder.is_empty());assert!(prefs.validate().is_ok());
    }
}
