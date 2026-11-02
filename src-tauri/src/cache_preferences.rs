//! Cache policy never removes message headers, provider mail, drafts, or downloads.
use tauri::{AppHandle, Manager};
use rusqlite::{Connection,params};
use std::sync::atomic::{AtomicBool,AtomicI64,Ordering};
static RUNNING: AtomicBool=AtomicBool::new(false);
static LAST_RUN: AtomicI64=AtomicI64::new(0);
// Decoding bodies may share this lock; clearing image assets is exclusive.
pub(crate) static INLINE_ASSET_LOCK: std::sync::RwLock<()> = std::sync::RwLock::new(());

pub fn init(conn:&Connection)->Result<(),String>{
    let columns=conn.prepare("PRAGMA table_info(messages)").map_err(|e|e.to_string())?.query_map([],|row|row.get::<_,String>(1)).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    if !columns.iter().any(|column|column=="body_cached_at") {
        conn.execute_batch("ALTER TABLE messages ADD COLUMN body_cached_at INTEGER; UPDATE messages SET body_cached_at=strftime('%s','now') WHERE body_fetched=1;").map_err(|e|e.to_string())?;
    }
    Ok(())
}

fn pending(conn:&Connection,account:&str)->Result<bool,String>{
    conn.query_row("SELECT EXISTS(SELECT 1 FROM pending_message_actions WHERE account_id=?1 UNION ALL SELECT 1 FROM pending_tag_edits WHERE account_id=?1 UNION ALL SELECT 1 FROM pending_trash_actions WHERE account_id=?1 UNION ALL SELECT 1 FROM mail_location_intents WHERE account_id=?1 AND phase<>'settled')",[account],|r|r.get(0)).map_err(|e|e.to_string())
}

const CLEAR_BODY:&str="UPDATE messages SET processed_html=NULL,body=NULL,body_fetched=0,body_cached_at=NULL,extracted_data=NULL,attachments_json=NULL WHERE account_id=?1 AND body_fetched=1";
fn evict(conn:&Connection,account:&str,days:i64,budget:i64,now:i64)->Result<(),String>{
    if days>0 {
        let sql=format!("{CLEAR_BODY} AND body_cached_at IS NOT NULL AND body_cached_at<?2");
        conn.execute(&sql,params![account,now-days*86400]).map_err(|e|e.to_string())?;
    }
    if budget>0 {
        let sql=format!("{CLEAR_BODY} AND rowid IN(SELECT rowid FROM (SELECT rowid,SUM(length(CAST(COALESCE(processed_html,'') AS BLOB))+length(CAST(COALESCE(body,'') AS BLOB))) OVER(ORDER BY body_cached_at DESC,rowid DESC) AS bytes FROM messages WHERE account_id=?1 AND body_fetched=1) WHERE bytes>?2)");
        conn.execute(&sql,params![account,budget]).map_err(|e|e.to_string())?;
    }
    Ok(())
}

pub fn kick(app:&AppHandle,force:bool){
    let now=chrono::Utc::now().timestamp();
    if !force&&now-LAST_RUN.load(Ordering::Relaxed)<3600{return;}
    if RUNNING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Relaxed).is_err(){return;}
    let app=app.clone();
    tauri::async_runtime::spawn_blocking(move||{
        struct Guard;
        impl Drop for Guard{fn drop(&mut self){RUNNING.store(false,Ordering::Release);}}
        let _running=Guard;
        let result=(||->Result<(),String>{
            crate::auth::app_lock::require_unlocked(&app)?;
            let _mutation=crate::mail::message_actions::MUTATION_LOCK.blocking_lock();
            let prefs=crate::mail_preferences::load(&app);
            let mut conn=crate::mail::database::open_connection(&app)?;
            let tx=conn.transaction().map_err(|e|e.to_string())?;
            for profile in crate::auth::session::load_profile_metadata(&app).0 {
                if pending(&tx,&profile.id)?{continue;}
                evict(&tx,&profile.id,prefs.cache_retention.parse().unwrap_or(0),prefs.cache_budget.parse::<i64>().unwrap_or(0)*1024*1024,now)?;
            }
            tx.commit().map_err(|e|e.to_string())?;
            LAST_RUN.store(now,Ordering::Relaxed);
            Ok(())
        })();
        if let Err(error)=result{log::debug!("Cache maintenance deferred: {}",error);}
    });
}

#[tauri::command]
pub async fn clear_body_cache(app_handle:AppHandle)->Result<(),String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account=crate::auth::session::get_active_profile(&app_handle).ok_or("No active account")?.id;
    let _mutation=crate::mail::message_actions::MUTATION_LOCK.lock().await;
    tokio::task::spawn_blocking(move||{
        let mut conn=crate::mail::database::open_connection(&app_handle)?;
        let tx=conn.transaction().map_err(|e|e.to_string())?;
        if pending(&tx,&account)?{return Err("Sync pending message actions before clearing bodies".into());}
        tx.execute(CLEAR_BODY,[&account]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn clear_inline_cache(app_handle:AppHandle)->Result<(),String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let _mutation=crate::mail::message_actions::MUTATION_LOCK.lock().await;
    tokio::task::spawn_blocking(move||{
        let _assets=INLINE_ASSET_LOCK.write().map_err(|_|"Inline image cache unavailable")?;
        let conn=crate::mail::database::open_connection(&app_handle)?;
        for profile in crate::auth::session::load_profile_metadata(&app_handle).0{
            if pending(&conn,&profile.id)?{return Err("Sync pending message actions before clearing inline images".into());}
        }
        let base=app_handle.path().app_cache_dir().map_err(|e|e.to_string())?;
        let target=base.join("orbitmail_inline_v2");
        if !base.is_absolute()||target.parent()!=Some(base.as_path()){return Err("Invalid inline cache directory".into());}
        // Invalidate referencing bodies before removing their app-owned assets.
        conn.execute("UPDATE messages SET processed_html=NULL,body_fetched=0,body_cached_at=NULL WHERE processed_html LIKE '%/orbitmail_inline_v2/%'",[]).map_err(|e|e.to_string())?;
        if target.exists(){std::fs::remove_dir_all(&target).map_err(|e|e.to_string())?;}
        Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn migration_does_not_age_existing_bodies_or_reset_timestamps(){
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(body_fetched INTEGER); INSERT INTO messages VALUES(1),(0);").unwrap();
        init(&conn).unwrap();
        assert!(conn.query_row("SELECT body_cached_at FROM messages WHERE body_fetched=1",[],|r|r.get::<_,i64>(0)).unwrap()>0);
        conn.execute("UPDATE messages SET body_cached_at=42 WHERE body_fetched=1",[]).unwrap();init(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT body_cached_at FROM messages WHERE body_fetched=1",[],|r|r.get::<_,i64>(0)).unwrap(),42);
    }
    #[test]fn pending_actions_protect_their_account(){
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE pending_message_actions(account_id TEXT);CREATE TABLE pending_tag_edits(account_id TEXT);CREATE TABLE pending_trash_actions(account_id TEXT);CREATE TABLE mail_location_intents(account_id TEXT,phase TEXT);INSERT INTO pending_trash_actions VALUES('a');INSERT INTO mail_location_intents VALUES('b','settled');").unwrap();
        assert!(pending(&conn,"a").unwrap());assert!(!pending(&conn,"b").unwrap());
        conn.execute("INSERT INTO pending_tag_edits VALUES('b')",[]).unwrap();assert!(pending(&conn,"b").unwrap());
    }
    #[test]
    fn retention_and_budget_preserve_headers_and_other_accounts(){
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(account_id TEXT,uid INTEGER,processed_html TEXT,body TEXT,body_fetched INTEGER,body_cached_at INTEGER,extracted_data TEXT,attachments_json TEXT); INSERT INTO messages VALUES('a',1,'old body',NULL,1,1,NULL,NULL),('a',2,'new body',NULL,1,999999,NULL,NULL),('b',1,'private',NULL,1,1,NULL,NULL);").unwrap();
        evict(&conn,"a",7,0,1000000).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM messages",[],|r|r.get::<_,u32>(0)).unwrap(),3);
        assert_eq!(conn.query_row("SELECT body_fetched FROM messages WHERE account_id='a' AND uid=1",[],|r|r.get::<_,u32>(0)).unwrap(),0);
        assert_eq!(conn.query_row("SELECT processed_html FROM messages WHERE account_id='b'",[],|r|r.get::<_,String>(0)).unwrap(),"private");
        evict(&conn,"a",0,1,1000000).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM messages WHERE account_id='a' AND body_fetched=1",[],|r|r.get::<_,u32>(0)).unwrap(),0);
    }
}
