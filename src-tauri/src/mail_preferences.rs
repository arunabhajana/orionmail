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
    pub account_overrides: std::collections::HashMap<String, serde_json::Value>,
    pub notify_inbox: bool,
    pub notify_sent: bool,
    pub notify_labels: bool,
    pub important_only: bool,
    pub notification_tone: String,
    pub download_folder: String,
    pub cache_retention: String,
    pub cache_budget: String,
    pub taskbar_badge: bool,
    pub taskbar_badge_scope: String,
    pub dnd_enabled: bool,
    pub desktop_notifications: bool,
    pub smart_notifications: bool,
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
    fn default() -> Self { Self { account_overrides: Default::default(), notify_inbox:true,notify_sent:false,notify_labels:false,important_only:false,notification_tone:"mail".into(),download_folder:String::new(),cache_retention:"30".into(),cache_budget:"512".into(),taskbar_badge:true,taskbar_badge_scope:"active".into(),dnd_enabled: false, desktop_notifications: true, smart_notifications: false, notification_sound: true,
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
        let now = chrono::Local::now();
        self.notifications_allowed_at(now.hour() * 60 + now.minute())
    }
    fn notifications_allowed_at(&self, current: u32) -> bool {
        if !self.desktop_notifications || self.dnd_enabled { return false; }
        if !self.quiet_hours { return true; }
        let (Some(start), Some(end)) = (minutes(&self.quiet_start), minutes(&self.quiet_end)) else { return false; };
        let quiet = if start < end { current >= start && current < end } else { current >= start || current < end };
        !quiet
    }
    pub fn folder_notifications_allowed(&self, folder:&str)->bool {
        match folder { "inbox"=>self.notify_inbox,"sent"=>self.notify_sent, value if value.starts_with("tag:")=>self.notify_labels,_=>false }
    }
    fn validate(&self) -> Result<(), String> {
        if !["active","all"].contains(&self.taskbar_badge_scope.as_str()){return Err("Invalid badge scope".into());}
        if !["mail","default","im","reminder"].contains(&self.notification_tone.as_str()){return Err("Invalid notification tone".into());}
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
pub fn load_selected(app: &AppHandle) -> MailPreferences {
    crate::auth::session::get_active_profile(app).map(|a|load_for(app,&a.id)).unwrap_or_else(||load(app))
}
pub fn load_for(app: &AppHandle, account: &str) -> MailPreferences {
    let base = load(app);
    merge(&base, base.account_overrides.get(account)).unwrap_or(base)
}
fn merge(base: &MailPreferences, patch: Option<&serde_json::Value>) -> Result<MailPreferences,String> {
    let mut value = serde_json::to_value(base).map_err(|e|e.to_string())?;
    if let Some(patch) = patch.and_then(|p|p.as_object()) {
        let object = value.as_object_mut().unwrap();
        for (key, val) in patch { if key != "accountOverrides" && object.contains_key(key) { object.insert(key.clone(),val.clone()); } }
    }
    let result: MailPreferences = serde_json::from_value(value).map_err(|e|e.to_string())?;
    result.validate()?;
    Ok(result)
}
#[tauri::command]
pub fn set_account_preferences(app_handle: AppHandle, account_id: String, overrides: serde_json::Value) -> Result<(),String> {
    crate::auth::scope::profile(&app_handle, Some(&account_id))?;
    let patch = overrides.as_object().ok_or("Invalid account preferences")?;
    if patch.len()>80 || serde_json::to_vec(patch).map_err(|e|e.to_string())?.len()>32000 { return Err("Account preferences too large".into()); }
    let _guard = WRITE_LOCK.lock().map_err(|_|"Preferences unavailable")?;
    let mut base = load(&app_handle);
    let effective = merge(&base,Some(&overrides))?;
    if !effective.download_folder.is_empty() && !std::path::Path::new(&effective.download_folder).is_dir() { return Err("Choose an existing download folder".into()); }
    if patch.is_empty() { base.account_overrides.remove(&account_id); } else { base.account_overrides.insert(account_id,overrides); }
    let target = path(&app_handle);
    if let Some(parent)=target.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let temp = target.with_extension("json.tmp");
    std::fs::write(&temp,serde_json::to_vec(&base).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    std::fs::rename(temp,target).map_err(|e|e.to_string())?;
    *CACHE.get().unwrap().write().unwrap_or_else(|p|p.into_inner())=base;
    crate::mail::notifications::refresh_policy(&app_handle);
    crate::cache_preferences::kick(&app_handle,true);
    crate::tray_state::update_tray_now(&app_handle);
    Ok(())
}
#[tauri::command]
pub fn set_mail_preferences(app_handle: AppHandle, mut preferences: MailPreferences) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    preferences.validate()?;
    if !preferences.download_folder.is_empty() && preferences.download_folder!=load(&app_handle).download_folder && !std::path::Path::new(&preferences.download_folder).is_dir(){return Err("Choose an existing download folder".into());}
    let _guard = WRITE_LOCK.lock().map_err(|_| "Preferences unavailable")?;
    preferences.account_overrides = load(&app_handle).account_overrides;
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
pub fn get_download_folder(app_handle:AppHandle, account_id:Option<String>)->Result<String,String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let owner=crate::auth::scope::profile(&app_handle,account_id.as_deref())?;
    let chosen=load_for(&app_handle,&owner.id).download_folder;
    if !chosen.is_empty()&&std::path::Path::new(&chosen).is_dir(){return Ok(chosen);}
    app_handle.path().download_dir().map(|path|path.to_string_lossy().into_owned()).map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests{
    #[test] fn smart_notifications_migrate_and_override_independently_of_prefetch(){
        let base:MailPreferences=serde_json::from_str(r#"{"prefetchBodies":false}"#).unwrap();
        assert!(!base.smart_notifications);assert!(!base.prefetch_bodies);
        let disabled=merge(&base,Some(&serde_json::json!({"smartNotifications":false}))).unwrap();
        assert!(!disabled.smart_notifications);assert!(!disabled.prefetch_bodies);
        assert!(!merge(&base,None).unwrap().smart_notifications);
        assert!(merge(&base,Some(&serde_json::json!({"smartNotifications":true}))).unwrap().smart_notifications);
        let restored:MailPreferences=serde_json::from_str(&serde_json::to_string(&disabled).unwrap()).unwrap();
        assert!(!restored.smart_notifications);
    }

    use super::*;
    #[test] fn badge_scope_defaults_to_active_and_accepts_only_known_modes(){
        let mut prefs:MailPreferences=serde_json::from_str("{}").unwrap();assert_eq!(prefs.taskbar_badge_scope,"active");
        prefs.taskbar_badge_scope="all".into();assert!(prefs.validate().is_ok());
        prefs.taskbar_badge_scope="unknown".into();assert!(prefs.validate().is_err());
    }
    #[test] fn account_overrides_inherit_and_validate() {
        let mut base=MailPreferences::default();
        base.account_overrides.insert("a".into(),serde_json::json!({"syncPaused":true,"pollInterval":"60","signature":"A"}));
        let a=merge(&base,base.account_overrides.get("a")).unwrap();
        assert!(a.sync_paused);assert_eq!(a.poll_interval,"60");assert!(a.notify_inbox);
        assert!(!merge(&base,base.account_overrides.get("b")).unwrap().sync_paused);
        base.notify_inbox=false;
        assert!(!merge(&base,base.account_overrides.get("a")).unwrap().notify_inbox);
        base.account_overrides.remove("a");
        assert!(!merge(&base,base.account_overrides.get("a")).unwrap().sync_paused);
        assert!(merge(&base,Some(&serde_json::json!({"pollInterval":"1"}))).is_err());
    }
    #[test]fn notification_policy_handles_midnight_boundaries_and_manual_override(){
        let mut prefs=MailPreferences{quiet_hours:true,..Default::default()};
        assert!(!prefs.notifications_allowed_at(22*60));assert!(!prefs.notifications_allowed_at(0));
        assert!(!prefs.notifications_allowed_at(8*60-1));assert!(prefs.notifications_allowed_at(8*60));
        prefs.quiet_start="09:00".into();prefs.quiet_end="17:00".into();
        assert!(prefs.notifications_allowed_at(8*60));assert!(!prefs.notifications_allowed_at(9*60));assert!(prefs.notifications_allowed_at(17*60));
        prefs.quiet_end=prefs.quiet_start.clone();assert!(!prefs.notifications_allowed_at(12*60));
        prefs.quiet_hours=false;prefs.dnd_enabled=true;assert!(!prefs.notifications_allowed_at(12*60));
        prefs.dnd_enabled=false;prefs.desktop_notifications=false;assert!(!prefs.notifications_allowed_at(12*60));
    }
    #[test]fn notification_folders_and_tones_are_bounded(){
        let mut prefs=MailPreferences::default();
        assert!(prefs.folder_notifications_allowed("inbox"));assert!(!prefs.folder_notifications_allowed("sent"));
        prefs.notify_sent=true;prefs.notify_labels=true;
        assert!(prefs.folder_notifications_allowed("sent"));assert!(prefs.folder_notifications_allowed("tag:abc"));
        assert!(!prefs.folder_notifications_allowed("trash"));assert!(!prefs.folder_notifications_allowed("starred"));
        prefs.notification_tone="im".into();assert!(prefs.validate().is_ok());
        prefs.notification_tone="file://untrusted".into();assert!(prefs.validate().is_err());
    }
    #[test]fn legacy_preferences_keep_values_and_gain_cache_defaults(){
        let prefs:MailPreferences=serde_json::from_str(r#"{"desktopNotifications":false,"pollInterval":"300"}"#).unwrap();
        assert!(!prefs.desktop_notifications);assert_eq!(prefs.poll_interval,"300");assert_eq!(prefs.cache_retention,"30");assert!(prefs.taskbar_badge);assert!(prefs.download_folder.is_empty());assert!(prefs.validate().is_ok());
    }
}
