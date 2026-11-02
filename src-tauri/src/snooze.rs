use tauri::{AppHandle,Emitter};
use rusqlite::params;
use crate::mail::message_list::MessageHeader;
#[derive(serde::Serialize)]pub struct Snoozed{key:String,until:i64,message:MessageHeader}
fn db(app:&AppHandle)->Result<rusqlite::Connection,String>{
 let conn=crate::mail::database::open_connection(app)?;init(&conn)?;Ok(conn)
}
pub(crate) fn init(conn:&rusqlite::Connection)->Result<(),String>{
 conn.execute_batch("CREATE TABLE IF NOT EXISTS mail_snoozes(account_id TEXT NOT NULL,key TEXT NOT NULL,wake_at INTEGER NOT NULL,snapshot TEXT NOT NULL,cutoff INTEGER NOT NULL,state INTEGER NOT NULL DEFAULT 0,seen_uid INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,key));").map_err(|e|e.to_string())?;
 let (has_state,has_uid)={let mut stmt=conn.prepare("PRAGMA table_info(mail_snoozes)").map_err(|e|e.to_string())?;let columns=stmt.query_map([],|row|row.get::<_,String>(1)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;(columns.iter().any(|name|name=="state"),columns.iter().any(|name|name=="seen_uid"))};
 if !has_state {conn.execute("ALTER TABLE mail_snoozes ADD COLUMN state INTEGER NOT NULL DEFAULT 0",[]).map_err(|e|e.to_string())?;}
 if !has_uid{conn.execute_batch("ALTER TABLE mail_snoozes ADD COLUMN seen_uid INTEGER NOT NULL DEFAULT 0;UPDATE mail_snoozes SET seen_uid=COALESCE((SELECT MAX(uid) FROM messages WHERE account_id=mail_snoozes.account_id AND folder='inbox'),0);").map_err(|e|e.to_string())?;}
 conn.execute_batch("CREATE INDEX IF NOT EXISTS mail_snoozes_state_due ON mail_snoozes(state,wake_at);").map_err(|e|e.to_string())?;Ok(())
}
fn authorize(app:&AppHandle,account:&str)->Result<(),String>{crate::auth::app_lock::require_unlocked(app)?;if crate::auth::session::get_active_profile(app).map(|value|value.id)!=Some(account.into()){return Err("Account changed. Reopen the mailbox.".into());}Ok(())}
fn root(message:&MessageHeader)->Option<&str>{message.thread_id.as_deref().filter(|s|!s.is_empty()).or(message.message_id.as_deref().filter(|s|!s.is_empty()))}
fn key(message:&MessageHeader)->String{if let Some(root)=root(message){serde_json::json!(["thread",root]).to_string()}else{serde_json::json!(["source",message.folder,message.uid,message.uid_validity]).to_string()}}
fn newer(conn:&rusqlite::Connection,account:&str,message:&MessageHeader,cutoff:i64,seen_uid:i64)->Result<bool,String>{if let Some(root)=root(message){conn.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND folder='inbox' AND (date>?3 OR uid>?4) AND (thread_id=?2 OR message_id=?2))",params![account,root,cutoff,seen_uid],|row|row.get(0)).map_err(|e|e.to_string())}else{Ok(false)}}
#[tauri::command]pub async fn snooze_mail(app_handle:AppHandle,account_id:String,folder:String,uid:u32,expected_uid_validity:u32,until:i64)->Result<String,String>{tauri::async_runtime::spawn_blocking(move||{
 authorize(&app_handle,&account_id)?;let now=chrono::Utc::now().timestamp();if until<=now+30||until>now+366*86400{return Err("Choose a future time within the next year.".into());}
 if folder!="inbox"{return Err("Snooze is available for Inbox messages.".into());}
 let message=crate::mail::database::get_messages_by_uids(&app_handle,&account_id,&folder,&[uid])?.into_iter().find(|message|message.uid_validity==expected_uid_validity&&expected_uid_validity>0).ok_or("Message changed. Reopen it.")?;
 let mut conn=db(&app_handle)?;let tx=conn.transaction().map_err(|e|e.to_string())?;let key=key(&message);
 tx.execute("DELETE FROM mail_snoozes WHERE account_id=?1 AND json_extract(snapshot,'$.folder')=?2 AND json_extract(snapshot,'$.uid')=?3 AND json_extract(snapshot,'$.uid_validity')=?4",params![account_id,folder,uid,expected_uid_validity]).map_err(|e|e.to_string())?;
 let seen_uid:i64=tx.query_row("SELECT COALESCE(MAX(uid),0) FROM messages WHERE account_id=?1 AND folder='inbox'",[&account_id],|row|row.get(0)).map_err(|e|e.to_string())?;
 let count:i64=tx.query_row("SELECT COUNT(*) FROM mail_snoozes WHERE account_id=?1 AND key<>?2 AND state=0",params![account_id,key],|row|row.get(0)).map_err(|e|e.to_string())?;if count>=100{return Err("You can snooze up to 100 conversations per account.".into());}
 let cutoff=if let Some(root)=root(&message){tx.query_row("SELECT COALESCE(MAX(date),?3) FROM messages WHERE account_id=?1 AND (thread_id=?2 OR message_id=?2)",params![account_id,root,message.date],|row|row.get::<_,i64>(0)).map_err(|e|e.to_string())?}else{message.date};
 tx.execute("INSERT OR REPLACE INTO mail_snoozes(account_id,key,wake_at,snapshot,cutoff,state,seen_uid) VALUES(?1,?2,?3,?4,?5,0,?6)",params![account_id,key,until,serde_json::to_string(&message).map_err(|e|e.to_string())?,cutoff,seen_uid]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;crate::mail::notifications::refresh_policy(&app_handle);let _=app_handle.emit("mail:snoozes_changed",account_id);Ok(key)
}).await.map_err(|e|e.to_string())?}
#[tauri::command]pub async fn unsnooze_mail(app_handle:AppHandle,account_id:String,key:String)->Result<(),String>{tauri::async_runtime::spawn_blocking(move||{authorize(&app_handle,&account_id)?;db(&app_handle)?.execute("UPDATE mail_snoozes SET state=1,wake_at=?3 WHERE account_id=?1 AND key=?2",params![account_id,key,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;crate::mail::notifications::refresh_policy(&app_handle);let _=app_handle.emit("mail:snoozes_changed",account_id);Ok(())}).await.map_err(|e|e.to_string())?}
#[tauri::command]pub async fn list_snoozed_mail(app_handle:AppHandle,account_id:String)->Result<serde_json::Value,String>{tauri::async_runtime::spawn_blocking(move||{
 authorize(&app_handle,&account_id)?;tick(&app_handle);
 let conn=db(&app_handle)?;let now=chrono::Utc::now().timestamp();conn.execute("DELETE FROM mail_snoozes WHERE account_id=?1 AND state=1 AND wake_at<?2",params![account_id,now-7*86400]).map_err(|e|e.to_string())?;
 let rows={let mut stmt=conn.prepare("SELECT key,wake_at,snapshot,cutoff,state,seen_uid FROM mail_snoozes WHERE account_id=?1 ORDER BY state,wake_at DESC LIMIT 200").map_err(|e|e.to_string())?;let mapped=stmt.query_map([&account_id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,String>(2)?,row.get::<_,i64>(3)?,row.get::<_,i64>(4)?,row.get::<_,i64>(5)?))).map_err(|e|e.to_string())?;mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?};
 let mut active=Vec::new();let mut returned=Vec::new();
 for (key,until,snapshot,cutoff,state,seen_uid) in rows {
  let saved:MessageHeader=serde_json::from_str(&snapshot).map_err(|e|e.to_string())?;
  let message=crate::mail::database::get_messages_by_uids(&app_handle,&account_id,&saved.folder,&[saved.uid])?.into_iter().find(|message|message.uid_validity==saved.uid_validity&&message.message_id==saved.message_id);
  if let Some(message)=message {if state==0&&newer(&conn,&account_id,&message,cutoff,seen_uid)?{conn.execute("UPDATE mail_snoozes SET state=1,wake_at=?3 WHERE account_id=?1 AND key=?2",params![account_id,key,now]).map_err(|e|e.to_string())?;returned.push(Snoozed{key,until:now,message});}else if state==0&&until>now{active.push(Snoozed{key,until,message});}else{returned.push(Snoozed{key,until,message});}}
  else{conn.execute("DELETE FROM mail_snoozes WHERE account_id=?1 AND key=?2",params![account_id,key]).map_err(|e|e.to_string())?;}
 }
 Ok(serde_json::json!({"active":active,"returned":returned}))
}).await.map_err(|e|e.to_string())?}
static TICK:std::sync::Mutex<()>=std::sync::Mutex::new(());
pub fn tick(app:&AppHandle){
 let Ok(_guard)=TICK.try_lock() else{return};
 let run=||->Result<(),String>{let mut conn=db(app)?;let now=chrono::Utc::now().timestamp();let tx=conn.transaction().map_err(|e|e.to_string())?;
 let accounts={let mut stmt=tx.prepare("SELECT DISTINCT account_id FROM mail_snoozes s WHERE state=0 AND wake_at<=?1 AND EXISTS(SELECT 1 FROM messages m WHERE m.account_id=s.account_id AND m.folder=json_extract(s.snapshot,'$.folder') AND m.uid=json_extract(s.snapshot,'$.uid') AND m.uid_validity=json_extract(s.snapshot,'$.uid_validity'))").map_err(|e|e.to_string())?;let mapped=stmt.query_map([now],|row|row.get::<_,String>(0)).map_err(|e|e.to_string())?;mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?};
 tx.execute("UPDATE mail_snoozes SET state=1,wake_at=?1 WHERE state=0 AND wake_at<=?1",[now]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;
 for account in accounts{let _=app.emit("mail:snoozes_changed",&account);crate::mail::notifications::snooze_returned(app,&account);}Ok(())};if let Err(error)=run(){log::debug!("Snooze wake check: {}",error);}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn a_same_second_new_reply_wakes_only_the_matching_account_thread(){
  let conn=rusqlite::Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,date INTEGER,thread_id TEXT,message_id TEXT);INSERT INTO messages VALUES('a','inbox',1,100,'<root>','<old>'),('b','inbox',99,100,'<root>','<other>');").unwrap();
  let message:MessageHeader=serde_json::from_value(serde_json::json!({"folder":"inbox","uid":1,"uid_validity":7,"subject":"test","from":"a@example.com","date":100,"seen":false,"flagged":false,"has_attachments":false,"thread_id":"<root>","snippet":null,"to":null,"message_id":"<old>"})).unwrap();
  assert!(!newer(&conn,"a",&message,100,1).unwrap());
  conn.execute("INSERT INTO messages VALUES('a','inbox',2,100,'<root>','<new>')",[]).unwrap();assert!(newer(&conn,"a",&message,100,1).unwrap());
 }
 #[test]fn snooze_state_can_return_once_without_touching_other_accounts(){
  let conn=rusqlite::Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE mail_snoozes(account_id TEXT,key TEXT,wake_at INTEGER,state INTEGER);INSERT INTO mail_snoozes VALUES('a','one',100,0),('b','two',200,0);").unwrap();
  assert_eq!(conn.execute("UPDATE mail_snoozes SET state=1,wake_at=?1 WHERE state=0 AND wake_at<=?1",[150]).unwrap(),1);
  assert_eq!(conn.execute("UPDATE mail_snoozes SET state=1,wake_at=?1 WHERE state=0 AND wake_at<=?1",[150]).unwrap(),0);
  assert_eq!(conn.query_row("SELECT state FROM mail_snoozes WHERE account_id='b'",[],|row|row.get::<_,i64>(0)).unwrap(),0);
 }
}
