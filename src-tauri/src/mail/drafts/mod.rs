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
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
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
        let valid=|id:&str|id.len()>=3 && id.len()<=998 && id.starts_with('<') && id.ends_with('>') && !id.chars().any(char::is_whitespace) && !id.chars().any(char::is_control) && !id[1..id.len()-1].contains(['<','>']);
        if self.references.len()>100 || self.in_reply_to.as_ref().is_some_and(|id|!valid(id)) || self.references.iter().any(|id|!valid(id)){return Err("Invalid reply threading headers".into());}
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
pub fn start_worker(app: &AppHandle) {
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
                if crate::auth::app_lock::require_unlocked(&app).is_err()
                {
                    continue;
                }
                for profile in crate::auth::session::load_profile_metadata(&app).0 {
                    if profile.needs_reauth || crate::mail_preferences::load_for(&app, &profile.id).sync_paused { continue; }
                    if let Ok(account) = crate::auth::bootstrap::ensure_account(&app, &profile.id).await {
                        if matches!(account.provider, crate::auth::account::MailProvider::Google) { let _ = remote::sync(&app, &account).await; }
                    }
                }
            }
        });
    }
}
pub fn kick(app: &AppHandle) {
    start_worker(app);
    WAKE.notify_one();
}

#[cfg(test)]
mod reply_payload_tests {
    use super::*;
    #[test]
    fn reply_metadata_survives_draft_serialization_and_rejects_header_injection(){
        let mut payload=Payload{in_reply_to:Some("<parent@example.com>".into()),references:vec!["<root@example.com>".into(),"<parent@example.com>".into()],..Default::default()};
        assert!(payload.validate().is_ok());
        let restored:Payload=serde_json::from_str(&serde_json::to_string(&payload).unwrap()).unwrap();
        assert_eq!(restored.in_reply_to,payload.in_reply_to);assert_eq!(restored.references,payload.references);
        payload.references.push("<bad>\r\nBcc: injected@example.com".into());assert!(payload.validate().is_err());
        payload.references.clear();payload.in_reply_to=Some("<>".into());assert!(payload.validate().is_err());
    }
    #[test]fn old_drafts_need_no_reply_metadata(){
        let payload:Payload=serde_json::from_str(r#"{"to":[],"pending_to":"","cc":"","bcc":"","subject":"","html":"","plain":"","attachments":[]}"#).unwrap();
        assert!(payload.in_reply_to.is_none());assert!(payload.references.is_empty());assert!(payload.validate().is_ok());
    }
}
