use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use std::sync::Mutex;
use chrono::Timelike;
static WRITE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct MailPreferences {
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
    fn default() -> Self { Self { dnd_enabled: false, desktop_notifications: true, notification_sound: true,
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
        if minutes(&self.quiet_start).is_none() || minutes(&self.quiet_end).is_none() { return Err("Invalid quiet hours".into()); }
        if !["60", "180", "300", "900"].contains(&self.poll_interval.as_str()) { return Err("Invalid sync interval".into()); }
        Ok(())
    }
}
fn path(app: &AppHandle) -> std::path::PathBuf { crate::config::get_config_path(app).with_file_name("mail-preferences.json") }
pub fn load(app: &AppHandle) -> MailPreferences {
    std::fs::read(path(app)).ok().and_then(|bytes| serde_json::from_slice::<MailPreferences>(&bytes).ok())
        .filter(|prefs| prefs.validate().is_ok()).unwrap_or_default()
}
#[tauri::command]
pub fn get_mail_preferences(app_handle: AppHandle) -> MailPreferences { load(&app_handle) }
#[tauri::command]
pub fn set_mail_preferences(app_handle: AppHandle, preferences: MailPreferences) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    preferences.validate()?;
    let _guard = WRITE_LOCK.lock().map_err(|_| "Preferences unavailable")?;
    let path = path(&app_handle);
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(&preferences).map_err(|e| e.to_string())?;
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())?;
    crate::mail::notifications::refresh_policy(&app_handle);
    Ok(())
}
