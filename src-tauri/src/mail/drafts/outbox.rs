use super::{changed, remote, store, Summary};
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter};

static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();
static DELIVERY: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static INTENTS:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());
pub async fn intent_guard()->tokio::sync::MutexGuard<'static,()>{INTENTS.lock().await}
pub fn disconnect_guard()->Result<tokio::sync::MutexGuard<'static,()>,String>{DELIVERY.try_lock().map_err(|_|"Outbox is delivering a message. Wait for delivery to finish before signing out.".into())}
pub fn suspend_account(app:&AppHandle,account:&str)->Result<(),String>{
    store::db(app)?.execute("UPDATE mail_outbox SET state='attention',error='This account was disconnected. Review and retry after reconnecting.' WHERE account_id=?1",[account]).map_err(|e|e.to_string())?;changed(app,account);Ok(())
}
pub fn reconnected(app:&AppHandle){
    if let Ok(conn)=store::db(app){let _=conn.execute("UPDATE mail_outbox SET next_attempt=0 WHERE state='waiting'",[]);}
    wake(app);
}

pub(super) fn schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS mail_outbox (
        account_id TEXT NOT NULL,draft_id TEXT NOT NULL,revision INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'waiting',attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,created_at INTEGER NOT NULL,
        PRIMARY KEY(account_id,draft_id));
        UPDATE compose_drafts SET state='send_unknown',error='Sending was interrupted. Check Sent before sending another copy.' WHERE state='sending';
        UPDATE mail_outbox SET state='waiting' WHERE state='delivering';")
        .map_err(|e| e.to_string())
}
pub(super) fn contains(app: &AppHandle, account: &str, id: &str) -> Result<bool, String> {
    store::db(app)?.query_row("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE account_id=?1 AND draft_id=?2)",params![account,id],|r|r.get(0)).map_err(|e|e.to_string())
}
fn authorize(app: &AppHandle, account: &str) -> Result<(), String> {
    crate::auth::scope::profile(app, Some(account)).map(|_| ())
}
fn enqueue(conn: &mut Connection, account: &str, id: &str, revision: i64) -> Result<(), String> {
    let tx=conn.transaction().map_err(|e|e.to_string())?;
    let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE account_id=?1 AND draft_id=?2 AND revision=?3)",params![account,id,revision],|r|r.get(0)).map_err(|e|e.to_string())?;
    if existing { return Ok(()); }
    let changed=tx.execute("UPDATE compose_drafts SET state='outbox',editing=0,error=NULL WHERE account_id=?1 AND id=?2 AND revision=?3 AND conflict=0 AND state IN ('queued','synced')",params![account,id,revision]).map_err(|e|e.to_string())?;
    if changed!=1 {return Err("This draft changed or needs attention. Review it before sending.".into());}
    tx.execute("INSERT INTO mail_outbox(account_id,draft_id,revision,created_at) VALUES(?1,?2,?3,?4)",params![account,id,revision,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn queue_draft(app_handle:AppHandle,account_id:String,id:String,expected_revision:i64)->Result<(),String>{
    let _intent=intent_guard().await;
    authorize(&app_handle,&account_id)?;
    let app=app_handle.clone();let owner=account_id.clone();
    tokio::task::spawn_blocking(move||{
        if store::receipt(&app,&owner,&id)?.is_some(){return Err("This message has already been sent.".into());}
        let draft=store::get(&app,&owner,&id)?;
        if draft.payload.to.is_empty()||!draft.payload.pending_to.trim().is_empty()||draft.payload.plain.trim().is_empty(){return Err("Add recipients and a message before sending.".into());}
        for address in draft.payload.to.iter().chain([&draft.payload.cc,&draft.payload.bcc]) {remote::addresses(address)?;}
        let _=store::files(&app,&owner,&draft)?;
        enqueue(&mut store::db(&app)?,&owner,&id,expected_revision)
    }).await.map_err(|e|e.to_string())??;
    changed(&app_handle,&account_id);wake(&app_handle);Ok(())
}
#[derive(serde::Serialize)]
pub struct Entry { #[serde(flatten)] draft:Summary, delivery_state:String, delivery_error:Option<String>, attempts:i64 }
#[tauri::command]
pub async fn list_outbox(app_handle:AppHandle,account_id:String)->Result<Vec<Entry>,String>{
    authorize(&app_handle,&account_id)?;
    tokio::task::spawn_blocking(move||{
        let conn=store::db(&app_handle)?;let mut entries=Vec::new();
        for draft in store::list_all(&app_handle,&account_id,true)? {
            let row=conn.query_row("SELECT state,error,attempts FROM mail_outbox WHERE account_id=?1 AND draft_id=?2",params![account_id,draft.id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,i64>(2)?)));
            match row {Ok((delivery_state,delivery_error,attempts))=>entries.push(Entry{draft,delivery_state,delivery_error,attempts}),Err(rusqlite::Error::QueryReturnedNoRows)=>{},Err(e)=>return Err(e.to_string())}
        }Ok(entries)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn read_outbox(app_handle:AppHandle,account_id:String,id:String)->Result<super::Draft,String>{
    authorize(&app_handle,&account_id)?;
    tokio::task::spawn_blocking(move||{
        if !contains(&app_handle,&account_id,&id)?{return Err("This message has left Outbox. Refresh to see its status.".into());}
        store::get(&app_handle,&account_id,&id)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn cancel_outbox(app_handle:AppHandle,account_id:String,id:String)->Result<(),String>{
    authorize(&app_handle,&account_id)?;
    // Never wait behind a network send and then pretend cancellation stopped it.
    let _guard=DELIVERY.try_lock().map_err(|_|"A delivery is in progress. Wait for its result before returning this message to Drafts.")?;
    let mut conn=store::db(&app_handle)?;let tx=conn.transaction().map_err(|e|e.to_string())?;
    let state:String=tx.query_row("SELECT state FROM compose_drafts WHERE account_id=?1 AND id=?2",params![account_id,id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if state=="send_unknown"||state=="sending" {return Err("Delivery is uncertain. Check Sent before cancelling or sending another copy.".into());}
    tx.execute("DELETE FROM mail_outbox WHERE account_id=?1 AND draft_id=?2",params![account_id,id]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE compose_drafts SET state=CASE WHEN dirty=1 THEN 'queued' ELSE 'synced' END,error=NULL WHERE account_id=?1 AND id=?2 AND state='outbox'",params![account_id,id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;changed(&app_handle,&account_id);Ok(())
}
#[tauri::command]
pub async fn retry_outbox(app_handle:AppHandle,account_id:String,id:String)->Result<(),String>{
    let _intent=intent_guard().await;
    authorize(&app_handle,&account_id)?;
    let draft=store::get(&app_handle,&account_id,&id)?;
    if matches!(draft.state.as_str(),"send_unknown"|"sending"|"checking")||draft.conflict{return Err("Resolve this message's status before trying again.".into());}
    store::db(&app_handle)?.execute("UPDATE mail_outbox SET state='waiting',next_attempt=0,error=NULL WHERE account_id=?1 AND draft_id=?2 AND state<>'delivering'",params![account_id,id]).map_err(|e|e.to_string())?;
    changed(&app_handle,&account_id);wake(&app_handle);Ok(())
}
fn delay(attempt:i64)->i64{30_i64.saturating_mul(1_i64<<attempt.clamp(0,6)).min(1800)}
fn needs_attention(state:&str,conflict:bool)->bool{conflict||matches!(state,"send_unknown"|"sending"|"checking"|"needs_attachments"|"unsupported"|"deleting")}
fn failure(app:&AppHandle,account:&str,id:&str,state:&str,error:&str)->Result<(),String>{
    store::db(app)?.execute("UPDATE mail_outbox SET state=?3,error=?4,attempts=attempts+1,next_attempt=?5 WHERE account_id=?1 AND draft_id=?2",params![account,id,state,error,chrono::Utc::now().timestamp()+delay(1)]).map_err(|e|e.to_string())?;
    changed(app,account);Ok(())
}
async fn pass(app:&AppHandle){
    if !crate::mail::connectivity::is_online()||crate::auth::app_lock::require_unlocked(app).is_err(){return;}
    let Ok(conn)=store::db(app) else{return;};
    for profile in crate::auth::session::load_profile_metadata(app).0 {
        if profile.needs_reauth {if conn.execute("UPDATE mail_outbox SET state='attention',error='Reconnect this account, then retry delivery.' WHERE account_id=?1 AND state='waiting'",[&profile.id]).unwrap_or(0)>0{changed(app,&profile.id);}continue;}
        let rows=(||->rusqlite::Result<Vec<(String,i64,i64)>>{
            let mut stmt=conn.prepare("SELECT draft_id,revision,attempts FROM mail_outbox WHERE account_id=?1 AND state='waiting' AND next_attempt<=?2 ORDER BY created_at LIMIT 5")?;
            let rows=stmt.query_map(params![profile.id,chrono::Utc::now().timestamp()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect();rows
        })();
        let Ok(rows)=rows else{continue;};if rows.is_empty(){continue;}
        let account=match crate::auth::bootstrap::ensure_account(app,&profile.id).await {
            Ok(account)=>account,
            Err(error)=>{for(id,_,_)in rows{let _=failure(app,&profile.id,&id,"waiting",&error);}continue;}
        };
        for(id,revision,attempts)in rows {
            if crate::mail::shutdown::APP_TOKEN.is_cancelled(){return;}
            let Ok(_delivery)=DELIVERY.try_lock() else{continue;};
            if !contains(app,&profile.id,&id).unwrap_or(false){continue;}
            if store::receipt(app,&profile.id,&id).ok().flatten().is_some(){let _=conn.execute("DELETE FROM mail_outbox WHERE account_id=?1 AND draft_id=?2",params![profile.id,id]);changed(app,&profile.id);continue;}
            let draft=match store::get(app,&profile.id,&id){Ok(draft)=>draft,Err(_)=>{let _=failure(app,&profile.id,&id,"attention","The saved message could not be loaded. Review its delivery status before retrying.");continue;}};
            if draft.revision!=revision||draft.conflict||matches!(draft.state.as_str(),"send_unknown"|"sending"|"needs_attachments"|"unsupported"|"deleting") {
                let _=failure(app,&profile.id,&id,"attention","Review this message in Drafts. Delivery may be uncertain; check Sent before sending another copy.");continue;
            }
            if draft.state=="checking"{let _=failure(app,&profile.id,&id,"attention","Gmail must confirm the previous draft upload before sending. Refresh Drafts, then retry.");continue;}
            if conn.execute("UPDATE mail_outbox SET state='delivering',error=NULL WHERE account_id=?1 AND draft_id=?2 AND state='waiting'",params![profile.id,id]).ok()!=Some(1){continue;}changed(app,&profile.id);
            match remote::send(app,&account,&id,revision).await {
                Ok(_)=>{let _=conn.execute("DELETE FROM mail_outbox WHERE account_id=?1 AND draft_id=?2",params![profile.id,id]);let _=app.emit("outbox:sent",serde_json::json!({"account_id":profile.id,"draft_id":id,"subject":draft.payload.subject}));changed(app,&profile.id);crate::mail::sync_manager::enqueue_sync_with_force(app.clone(),account.clone(),crate::mail::folder::MailFolder::Sent,true).await;}
                Err(error)=>{
                    let current=store::get(app,&profile.id,&id).ok();
                    let uncertain=current.as_ref().is_none_or(|d|needs_attention(&d.state,d.conflict))||["denied","changed","recipient","sign in","configured","invalid","reattach"].iter().any(|word|error.to_lowercase().contains(word));
                    let _=failure(app,&profile.id,&id,if uncertain{"attention"}else{"waiting"},&error);
                    let _=conn.execute("UPDATE mail_outbox SET next_attempt=?3 WHERE account_id=?1 AND draft_id=?2",params![profile.id,id,chrono::Utc::now().timestamp()+delay(attempts)]);
                    if !uncertain{let _=store::status(app,&profile.id,&id,"outbox",Some(&error));}
                    break;
                }
            }
        }
    }
}
pub fn wake(app:&AppHandle){start(app);WAKE.notify_one();}
pub fn start(app:&AppHandle){
    static STARTED:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true,std::sync::atomic::Ordering::AcqRel){return;}
    let app=app.clone();tauri::async_runtime::spawn(async move{
        loop{pass(&app).await;tokio::select!{_=WAKE.notified()=>{},_=tokio::time::sleep(std::time::Duration::from_secs(30))=>{},_=crate::mail::shutdown::APP_TOKEN.cancelled()=>break}}
    });
}

#[cfg(test)]
mod tests{
 use super::*;
 fn db()->Connection{let c=Connection::open_in_memory().unwrap();c.execute_batch("CREATE TABLE compose_drafts(account_id TEXT,id TEXT,revision INTEGER,state TEXT,editing INTEGER,error TEXT,conflict INTEGER);
 INSERT INTO compose_drafts VALUES('a','mail',2,'queued',1,NULL,0),('b','mail',2,'queued',1,NULL,0);").unwrap();schema(&c).unwrap();c}
 #[test]fn queuing_is_atomic_idempotent_and_scoped(){let mut c=db();assert!(enqueue(&mut c,"a","mail",1).is_err());assert_eq!(c.query_row("SELECT COUNT(*) FROM mail_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);enqueue(&mut c,"a","mail",2).unwrap();enqueue(&mut c,"a","mail",2).unwrap();assert_eq!(c.query_row("SELECT COUNT(*) FROM mail_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(c.query_row("SELECT state FROM compose_drafts WHERE account_id='b'",[],|r|r.get::<_,String>(0)).unwrap(),"queued");}
 #[test]fn restart_preserves_intent_and_releases_abandoned_delivery_claim(){let mut c=db();enqueue(&mut c,"a","mail",2).unwrap();c.execute("UPDATE mail_outbox SET state='delivering'",[]).unwrap();schema(&c).unwrap();assert_eq!(c.query_row("SELECT state FROM mail_outbox",[],|r|r.get::<_,String>(0)).unwrap(),"waiting");assert_eq!(delay(0),30);assert_eq!(delay(50),1800);}
 #[test]fn uncertain_sends_and_conflicted_drafts_are_never_automatically_retried(){for state in ["send_unknown","sending","checking","needs_attachments","unsupported","deleting"]{assert!(needs_attention(state,false));}assert!(needs_attention("synced",true));assert!(!needs_attention("outbox",false));assert!(!needs_attention("synced",false));}
 #[test]fn queue_refuses_conflicts_and_existing_unconfirmed_operations(){for state in ["sending","send_unknown","checking","deleting","needs_attachments"]{let mut c=db();c.execute("UPDATE compose_drafts SET state=?1",[state]).unwrap();assert!(enqueue(&mut c,"a","mail",2).is_err());assert_eq!(c.query_row("SELECT COUNT(*) FROM mail_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),0);}let mut c=db();c.execute("UPDATE compose_drafts SET conflict=1",[]).unwrap();assert!(enqueue(&mut c,"a","mail",2).is_err());}
 #[test]fn queue_and_attachment_bytes_survive_reopening_without_repeating_uncertain_delivery(){
  let file=std::env::temp_dir().join(format!("orion-outbox-{}.sqlite",uuid::Uuid::new_v4()));
  {
   let mut c=Connection::open(&file).unwrap();c.execute_batch("CREATE TABLE compose_drafts(account_id TEXT,id TEXT,revision INTEGER,state TEXT,editing INTEGER,error TEXT,conflict INTEGER);CREATE TABLE draft_files(bytes BLOB);INSERT INTO compose_drafts VALUES('a','mail',2,'queued',0,NULL,0);INSERT INTO draft_files VALUES(X'01020304');").unwrap();schema(&c).unwrap();enqueue(&mut c,"a","mail",2).unwrap();c.execute_batch("UPDATE compose_drafts SET state='sending';UPDATE mail_outbox SET state='delivering';").unwrap();
  }
  {let c=Connection::open(&file).unwrap();schema(&c).unwrap();let state:String=c.query_row("SELECT state FROM compose_drafts",[],|r|r.get(0)).unwrap();assert_eq!(state,"send_unknown");assert!(needs_attention(&state,false));assert_eq!(c.query_row("SELECT bytes FROM draft_files",[],|r|r.get::<_,Vec<u8>>(0)).unwrap(),vec![1,2,3,4]);assert_eq!(c.query_row("SELECT COUNT(*) FROM mail_outbox",[],|r|r.get::<_,i64>(0)).unwrap(),1);}
  std::fs::remove_file(file).unwrap();
 }
}
