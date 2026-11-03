use super::{changed, kick, remote, store, Draft, Payload, Summary};
use rusqlite::params;
use tauri::AppHandle;
fn authorize(app: &AppHandle, account: &str) -> Result<(), String> {
    crate::auth::app_lock::require_unlocked(app)?;
    if crate::auth::session::get_active_profile(app)
        .as_ref()
        .map(|p| p.id.as_str())
        != Some(account)
    {
        return Err("The active account changed. Reopen Drafts.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn list_drafts(
    app_handle: AppHandle,
    account_id: String,
) -> Result<Vec<Summary>, String> {
    authorize(&app_handle, &account_id)?;
    tokio::task::spawn_blocking(move || store::list(&app_handle, &account_id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn draft_status(
    app_handle: AppHandle,
    account_id: String,
    id: String,
) -> Result<serde_json::Value, String> {
    authorize(&app_handle, &account_id)?;
    tokio::task::spawn_blocking(move||{
        if store::receipt(&app_handle,&account_id,&id)?.is_some(){return Ok(serde_json::json!({"state":"sent","error":null}))}
        store::db(&app_handle)?.query_row("SELECT state,error FROM compose_drafts WHERE account_id=?1 AND id=?2",params![account_id,id],|r|Ok(serde_json::json!({"state":r.get::<_,String>(0)?,"error":r.get::<_,Option<String>>(1)?}))).map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn open_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
) -> Result<Draft, String> {
    authorize(&app_handle, &account_id)?;
    tokio::task::spawn_blocking(move || {
        let draft = store::get(&app_handle, &account_id, &id)?;
        if matches!(draft.state.as_str(), "unsupported" | "deleting") {
            return Err("Open this draft in Gmail to edit it.".into());
        }
        store::db(&app_handle)?
            .execute(
                "UPDATE compose_drafts SET editing=1 WHERE account_id=?1 AND id=?2",
                params![account_id, id],
            )
            .map_err(|e| e.to_string())?;
        store::get(&app_handle, &account_id, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    expected_revision: i64,
    payload: Payload,
) -> Result<Draft, String> {
    authorize(&app_handle, &account_id)?;
    let app = app_handle.clone();
    let account = account_id.clone();
    let draft = tokio::task::spawn_blocking(move || {
        store::save(&app, &account, &id, expected_revision, payload)
    })
    .await
    .map_err(|e| e.to_string())??;
    changed(&app_handle, &account_id);
    kick(&app_handle);
    Ok(draft)
}
#[tauri::command]
pub async fn release_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
) -> Result<(), String> {
    authorize(&app_handle, &account_id)?;
    tokio::task::spawn_blocking(move || {
        store::db(&app_handle)?
            .execute(
                "UPDATE compose_drafts SET editing=0 WHERE account_id=?1 AND id=?2",
                params![account_id, id],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn discard_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    expected_revision: i64,
) -> Result<(), String> {
    authorize(&app_handle, &account_id)?;
    let app = app_handle.clone();
    let account = account_id.clone();
    tokio::task::spawn_blocking(move||{
        let count=store::db(&app)?.execute("UPDATE compose_drafts SET state='deleting',dirty=1,revision=revision+1,editing=0 WHERE account_id=?1 AND id=?2 AND revision=?3 AND state NOT IN ('sending','send_unknown')",params![account,id,expected_revision]).map_err(|e|e.to_string())?;
        if count!=1{return Err("This draft changed. Refresh before discarding it.".to_string())}Ok(())
    }).await.map_err(|e|e.to_string())??;
    changed(&app_handle, &account_id);
    kick(&app_handle);
    Ok(())
}
#[tauri::command]
pub async fn sync_drafts(app_handle: AppHandle, account_id: String) -> Result<(), String> {
    authorize(&app_handle, &account_id)?;
    super::start_worker(&app_handle);
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id != account_id {
        return Err("The active account changed".into());
    }
    if !matches!(account.provider, crate::auth::account::MailProvider::Google) {
        return Err("Online drafts currently support Gmail. Local drafts are saved.".into());
    }
    let result = remote::sync(&app_handle, &account).await;
    changed(&app_handle, &account_id);
    result
}
#[tauri::command]
pub async fn send_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    expected_revision: i64,
) -> Result<String, String> {
    authorize(&app_handle, &account_id)?;
    let account = crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id != account_id {
        return Err("The active account changed".into());
    }
    if !matches!(account.provider, crate::auth::account::MailProvider::Google) {
        return Err("Sending saved drafts currently supports Gmail.".into());
    }
    remote::send(&app_handle, &account, &id, expected_revision).await
}
#[tauri::command]
pub async fn resolve_draft_send(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    expected_revision: i64,
    delivered: bool,
) -> Result<Option<Draft>, String> {
    authorize(&app_handle, &account_id)?;
    let _lock = super::SYNC_LOCK.lock().await;
    let draft = store::get(&app_handle, &account_id, &id)?;
    if draft.state != "send_unknown" || draft.revision != expected_revision {
        return Err("The send status changed. Reopen this draft before resolving it.".into());
    }
    let result = if delivered {
        store::sent(&app_handle, &account_id, &draft)?;
        None
    } else {
        store::db(&app_handle)?.execute("UPDATE compose_drafts SET state='queued',dirty=1,error=NULL,upload_revision=NULL,revision=revision+1 WHERE account_id=?1 AND id=?2",params![account_id,id]).map_err(|e|e.to_string())?;
        Some(store::get(&app_handle, &account_id, &id)?)
    };
    changed(&app_handle, &account_id);
    kick(&app_handle);
    Ok(result)
}
#[tauri::command]
pub async fn fork_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    payload: Payload,
) -> Result<Draft, String> {
    authorize(&app_handle, &account_id)?;
    let app = app_handle.clone();
    let account = account_id.clone();
    let result=tokio::task::spawn_blocking(move||{
        let new=uuid::Uuid::new_v4().to_string();let mut conn=store::db(&app)?;let tx=conn.transaction().map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO draft_files SELECT account_id,?3,id,name,mime_type,bytes FROM draft_files WHERE account_id=?1 AND draft_id=?2",params![account,id,new]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        match store::save(&app,&account,&new,0,payload){Ok(draft)=>Ok(draft),Err(error)=>{let _=store::remove(&app,&account,&new);Err(error)}}
    }).await.map_err(|e|e.to_string())?;
    changed(&app_handle, &account_id);
    kick(&app_handle);
    result
}
#[tauri::command]
pub async fn copy_draft_to_account(app_handle:AppHandle,account_id:String,target_account_id:String,id:String,expected_revision:i64)->Result<Draft,String>{
    authorize(&app_handle,&account_id)?;
    if account_id==target_account_id || !crate::auth::session::load_profile_metadata(&app_handle).0.iter().any(|p|p.id==target_account_id){return Err("Choose another connected account".into());}
    let app=app_handle.clone();let target=target_account_id.clone();
    let result=tokio::task::spawn_blocking(move||{
        let source=store::get(&app,&account_id,&id)?;
        validate_sender_copy(source.revision,expected_revision,&source.state,source.conflict,source.payload.in_reply_to.is_some())?;
        let new=uuid::Uuid::new_v4().to_string();
        let mut payload=source.payload;
        for file in &mut payload.attachments{file.handle.clear();}
        copy_sender_files(&store::db(&app)?,&account_id,&id,&target,&new)?;
        let result=(||{let draft=store::save(&app,&target,&new,0,payload)?;
            store::db(&app)?.execute("UPDATE compose_drafts SET editing=0 WHERE account_id=?1 AND id=?2",params![target,new]).map_err(|e|e.to_string())?;
            Ok(draft)})();
        if result.is_err(){let _=store::remove(&app,&target,&new);}
        result
    }).await.map_err(|e|e.to_string())?;
    changed(&app_handle,&target_account_id);
    kick(&app_handle);
    result
}
fn validate_sender_copy(revision:i64,expected:i64,state:&str,conflict:bool,reply:bool)->Result<(),String>{
    if revision!=expected || conflict || !["queued","synced"].contains(&state) || reply{return Err("This draft cannot change sender. Refresh or resolve its status first.".into());}Ok(())
}
fn copy_sender_files(conn:&rusqlite::Connection,source:&str,id:&str,target:&str,new:&str)->Result<(),String>{
    conn.execute("INSERT INTO draft_files(account_id,draft_id,id,name,mime_type,bytes) SELECT ?3,?4,id,name,mime_type,bytes FROM draft_files WHERE account_id=?1 AND draft_id=?2",params![source,id,target,new]).map(|_|()).map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn recover_draft(
    app_handle: AppHandle,
    account_id: String,
    id: String,
    expected_revision: i64,
    payload: Payload,
) -> Result<(), String> {
    authorize(&app_handle, &account_id)?;
    let app = app_handle.clone();
    let account = account_id.clone();
    let result=tokio::task::spawn_blocking(move||{
        if store::receipt(&app,&account,&id)?.is_some(){return Ok(())}
        let current=store::get(&app,&account,&id).ok();
        if let Some(current)=&current{
            let mut wanted=serde_json::to_value(&payload).map_err(|e|e.to_string())?;
            if let Some(files)=wanted.get_mut("attachments").and_then(|v|v.as_array_mut()){for file in files{if let Some(file)=file.as_object_mut(){file.remove("handle");}}}
            if serde_json::to_value(&current.payload).map_err(|e|e.to_string())?==wanted{return Ok(())}
            if matches!(current.state.as_str(),"sending"|"send_unknown"|"deleting"){return Err("Recovery is paused for a draft that may have been sent or discarded. Check Gmail first.".into())}
        }
        let target=if current.as_ref().is_some_and(|d|d.revision!=expected_revision){uuid::Uuid::new_v4().to_string()}else{id.clone()};
        if target!=id{store::db(&app)?.execute("INSERT INTO draft_files SELECT account_id,?3,id,name,mime_type,bytes FROM draft_files WHERE account_id=?1 AND draft_id=?2",params![account,id,target]).map_err(|e|e.to_string())?;}
        if let Err(error)=store::recover(&app,&account,&target,if target==id{expected_revision}else{0},payload){if target!=id{let _=store::remove(&app,&account,&target);}return Err(error)}
        store::db(&app)?.execute("UPDATE compose_drafts SET editing=0,conflict=CASE WHEN ?3 THEN 1 ELSE conflict END WHERE account_id=?1 AND id=?2",params![account,target,target!=id]).map_err(|e|e.to_string())?;
        Ok(())
    }).await.map_err(|e|e.to_string())?;
    changed(&app_handle, &account_id);
    kick(&app_handle);
    result
}

#[cfg(test)]
mod sender_tests {
    use super::*;
    #[test] fn sender_copy_rejects_replies_uncertain_sends_and_stale_revisions(){
        assert!(validate_sender_copy(3,3,"queued",false,false).is_ok());
        assert!(validate_sender_copy(3,3,"synced",false,false).is_ok());
        for state in ["sending","send_unknown","checking","deleting","needs_attachments"]{assert!(validate_sender_copy(3,3,state,false,false).is_err());}
        assert!(validate_sender_copy(3,2,"queued",false,false).is_err());
        assert!(validate_sender_copy(3,3,"queued",true,false).is_err());
        assert!(validate_sender_copy(3,3,"queued",false,true).is_err());
    }
    #[test] fn sender_files_are_copied_to_new_ownership_without_mutating_originals(){
        let conn=rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE draft_files(account_id TEXT,draft_id TEXT,id TEXT,name TEXT,mime_type TEXT,bytes BLOB,PRIMARY KEY(account_id,draft_id,id)); INSERT INTO draft_files VALUES('a','source','file','photo.png','image/png',X'010203'); INSERT INTO draft_files VALUES('other','source','file','secret.png','image/png',X'FF');").unwrap();
        copy_sender_files(&conn,"a","source","b","copy").unwrap();
        let read=|account:&str,id:&str|conn.query_row("SELECT bytes FROM draft_files WHERE account_id=?1 AND draft_id=?2",params![account,id],|r|r.get::<_,Vec<u8>>(0)).unwrap();
        assert_eq!(read("b","copy"),vec![1,2,3]);
        conn.execute("DELETE FROM draft_files WHERE account_id='b'",[]).unwrap();
        assert_eq!(read("a","source"),vec![1,2,3]);assert_eq!(read("other","source"),vec![255]);
    }
}
