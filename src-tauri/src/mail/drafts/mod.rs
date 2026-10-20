pub mod commands;
mod remote;
mod store;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DraftFile {
    pub id: String,
    pub name: String,
    pub size: usize,
    pub mime_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub handle: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Payload {
    pub to: Vec<String>,
    pub pending_to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub html: String,
    pub plain: String,
    pub attachments: Vec<DraftFile>,
}
impl Payload {
    fn validate(&self) -> Result<(), String> {
        if self.html.len() > 2 * 1024 * 1024
            || self.plain.len() > 2 * 1024 * 1024
            || self.subject.len() > 2000
            || self.to.len() > 100
            || self.to.iter().any(|s| s.len() > 512)
            || self.pending_to.len() > 8192
            || self.cc.len() > 8192
            || self.bcc.len() > 8192
            || self.attachments.len() > crate::mail::attachments::MAX_ATTACHMENTS
            || self
                .attachments
                .iter()
                .any(|file| file.name.len() > 1024 || file.mime_type.len() > 256)
        {
            return Err("This draft exceeds the supported size limits.".into());
        }
        let mut ids = std::collections::HashSet::new();
        if self.attachments.iter().any(|f| !ids.insert(&f.id)) {
            return Err("Duplicate attachment identity".into());
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct Draft {
    pub id: String,
    pub revision: i64,
    pub payload: Payload,
    pub updated_at: i64,
    pub remote_id: Option<String>,
    pub remote_version: Option<String>,
    pub dirty: bool,
    pub state: String,
    pub error: Option<String>,
    pub editing: bool,
    pub conflict: bool,
    pub upload_revision: Option<i64>,
    #[serde(skip_serializing)]
    pub upload_fingerprint: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub id: String,
    pub revision: i64,
    pub subject: String,
    pub to: Vec<String>,
    pub preview: String,
    pub updated_at: i64,
    pub state: String,
    pub error: Option<String>,
    pub conflict: bool,
    pub attachments: usize,
}
pub(crate) static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();
pub fn changed(app: &AppHandle, account: &str) {
    let _ = app.emit("drafts:updated", account);
}
pub fn kick(app: &AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if !STARTED.swap(true, std::sync::atomic::Ordering::AcqRel) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {_=WAKE.notified()=>{
                    let deadline=tokio::time::Instant::now()+std::time::Duration::from_secs(10);
                    loop { tokio::select!{_=tokio::time::sleep_until(deadline)=>break,
                        result=tokio::time::timeout(std::time::Duration::from_secs(2),WAKE.notified())=>if result.is_err(){break}} }
                },_=tokio::time::sleep(std::time::Duration::from_secs(60))=>{}}
                if crate::mail_preferences::load(&app).sync_paused
                    || crate::auth::app_lock::require_unlocked(&app).is_err()
                {
                    continue;
                }
                if let Ok(account) = crate::auth::bootstrap::ensure_active_account(&app).await {
                    if matches!(account.provider, crate::auth::account::MailProvider::Google) {
                        let _ = remote::sync(&app, &account).await;
                    }
                }
            }
        });
    }
    WAKE.notify_one();
}
