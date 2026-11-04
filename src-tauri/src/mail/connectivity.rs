use std::sync::atomic::{AtomicBool,Ordering};
use tauri::AppHandle;
// Wait for the renderer's network hint before starting network work on launch.
// Local reads and durable admissions remain available immediately.
static ONLINE:AtomicBool=AtomicBool::new(false);
static WAKE:tokio::sync::Notify=tokio::sync::Notify::const_new();
static RESUME:AtomicBool=AtomicBool::new(true);
pub fn is_online()->bool{ONLINE.load(Ordering::Relaxed)}
#[tauri::command]
pub async fn set_network_status(app_handle:AppHandle,online:bool)->Result<(),String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let previous=ONLINE.swap(online,Ordering::Relaxed);
    crate::wait_for_boot(&app_handle).await?;
    if online&&!previous {RESUME.store(true,Ordering::Relaxed);super::drafts::outbox::reconnected(&app_handle);WAKE.notify_one();super::drafts::kick(&app_handle);}
    Ok(())
}
pub fn start(app:&AppHandle){
    let app=app.clone();tauri::async_runtime::spawn(async move{
        loop{
            if is_online()&&crate::auth::app_lock::require_unlocked(&app).is_ok(){
                let resume=RESUME.swap(false,Ordering::Relaxed);
                if resume{super::drafts::outbox::reconnected(&app);}
                for profile in crate::auth::session::load_profile_metadata(&app).0 {
                    if profile.needs_reauth||crate::mail_preferences::load_for(&app,&profile.id).sync_paused{continue;}
                    // Local durable queues, rather than mounted views, own replay.
                    let pending=super::database::open_connection(&app).and_then(|conn|conn.query_row("SELECT (SELECT COUNT(*) FROM pending_message_actions WHERE account_id=?1)+(SELECT COUNT(*) FROM pending_tag_edits WHERE account_id=?1)+(SELECT COUNT(*) FROM mail_location_intents WHERE account_id=?1 AND phase<>'settled')",[&profile.id],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())).unwrap_or(0);
                    if pending==0&&!resume{continue;}
                    if let Ok(account)=crate::auth::bootstrap::ensure_account(&app,&profile.id).await{
                        super::message_actions::retry_pending(&app,&account).await;
                        super::tags::outbox::retry_pending(&app,&account).await;
                        super::trash::retry_pending(&app,&account).await;
                        if resume{super::sync_manager::enqueue_sync_with_force(app.clone(),account,super::folder::MailFolder::Inbox,true).await;}
                    }
                }
            }
            tokio::select!{_=WAKE.notified()=>{},_=tokio::time::sleep(std::time::Duration::from_secs(60))=>{},_=super::shutdown::APP_TOKEN.cancelled()=>break}
        }
    });
}
