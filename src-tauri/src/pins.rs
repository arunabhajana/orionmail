use tauri::AppHandle;
use rusqlite::{params,OptionalExtension};
fn header_identity(message:&crate::mail::message_list::MessageHeader)->String {
    match message.message_id.as_deref().filter(|value|!value.is_empty()){Some(id)=>serde_json::json!(["id",id,message.date,message.from,message.subject]).to_string(),None=>serde_json::json!(["row",message.folder,message.uid,message.uid_validity]).to_string()}
}
const IDENTITY:&str="CASE WHEN NULLIF(message_id,'') IS NOT NULL THEN json_array('id',message_id,date,sender,subject) ELSE json_array('row',folder,uid,uid_validity) END";
const LIST_SQL:&str="SELECT m.folder,m.uid,p.identity FROM mail_pins p CROSS JOIN messages m WHERE p.account_id=?1 AND json_extract(p.identity,'$[0]')='id' AND m.account_id=p.account_id AND m.message_id=json_extract(p.identity,'$[1]') AND m.date=json_extract(p.identity,'$[2]') AND m.sender=json_extract(p.identity,'$[3]') AND m.subject=json_extract(p.identity,'$[4]') UNION ALL SELECT m.folder,m.uid,p.identity FROM mail_pins p CROSS JOIN messages m WHERE p.account_id=?1 AND json_extract(p.identity,'$[0]')='row' AND m.account_id=p.account_id AND m.folder=json_extract(p.identity,'$[1]') AND m.uid=json_extract(p.identity,'$[2]') AND m.uid_validity=json_extract(p.identity,'$[3]') AND NULLIF(m.message_id,'') IS NULL";
fn db(app:&AppHandle,account:&str)->Result<rusqlite::Connection,String>{
    crate::auth::app_lock::require_unlocked(app)?;
    if crate::auth::session::get_active_profile(app).map(|value|value.id)!=Some(account.into()){return Err("Account changed. Reopen the mailbox.".into());}
    let conn=crate::mail::database::open_connection(app)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS mail_pins(account_id TEXT NOT NULL,identity TEXT NOT NULL,PRIMARY KEY(account_id,identity));").map_err(|e|e.to_string())?;Ok(conn)
}
#[tauri::command]
pub async fn list_mail_pins(app_handle:AppHandle,account_id:String)->Result<Vec<crate::mail::message_list::MessageHeader>,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let conn=db(&app_handle,&account_id)?;
        let sql=format!("{LIST_SQL} LIMIT 1000");
        let mut stmt=conn.prepare(&sql).map_err(|e|e.to_string())?;
        let rows=stmt.query_map([&account_id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,u32>(1)?,row.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
        let mut identities=std::collections::HashSet::new();
        let mut folders=std::collections::HashMap::<String,Vec<u32>>::new();for row in rows {let (folder,uid,identity)=row.map_err(|e|e.to_string())?;identities.insert(identity);folders.entry(folder).or_default().push(uid);}
        let mut result=Vec::new();for (folder,uids) in folders{for chunk in uids.chunks(200){result.extend(crate::mail::database::get_messages_by_uids(&app_handle,&account_id,&folder,chunk)?);}}
        result.retain(|message|identities.contains(&header_identity(message)));
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn set_mail_pin(app_handle:AppHandle,account_id:String,folder:String,uid:u32,expected_uid_validity:u32,pinned:bool)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        if expected_uid_validity==0{return Err("Sync this message before pinning it.".into());}
        let mut conn=db(&app_handle,&account_id)?;let tx=conn.transaction().map_err(|e|e.to_string())?;
        let sql=format!("SELECT {IDENTITY} FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3 AND uid_validity=?4");
        let identity:Option<String>=tx.query_row(&sql,params![account_id,folder,uid,expected_uid_validity],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        let identity=identity.ok_or("Message changed. Reopen it before pinning.")?;
        if pinned {
            let cleanup=format!("DELETE FROM mail_pins WHERE account_id=?1 AND identity NOT IN(SELECT identity FROM({LIST_SQL}))");tx.execute(&cleanup,[&account_id]).map_err(|e|e.to_string())?;
            let count:i64=tx.query_row("SELECT COUNT(*) FROM mail_pins WHERE account_id=?1",[&account_id],|row|row.get(0)).map_err(|e|e.to_string())?;
            if count>=100{let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM mail_pins WHERE account_id=?1 AND identity=?2)",params![account_id,identity],|row|row.get(0)).map_err(|e|e.to_string())?;if !exists{return Err("You can pin up to 100 messages per account. Unpin one first.".into());}}
            tx.execute("INSERT OR IGNORE INTO mail_pins VALUES(?1,?2)",params![account_id,identity]).map_err(|e|e.to_string())?;
        }else{tx.execute("DELETE FROM mail_pins WHERE account_id=?1 AND identity=?2",params![account_id,identity]).map_err(|e|e.to_string())?;}
        tx.commit().map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn pins_are_account_scoped_and_uid_reuse_does_not_inherit_them(){
        let conn=rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,uid_validity INTEGER,message_id TEXT,date INTEGER,sender TEXT,subject TEXT);CREATE TABLE mail_pins(account_id TEXT,identity TEXT,PRIMARY KEY(account_id,identity));INSERT INTO messages VALUES('a','inbox',1,9,NULL,1,'sender','subject'),('b','inbox',1,9,NULL,1,'sender','subject');").unwrap();
        conn.execute(&format!("INSERT INTO mail_pins SELECT account_id,({IDENTITY}) FROM messages WHERE account_id='a'"),[]).unwrap();
        let count=|account:&str|conn.query_row(&format!("SELECT COUNT(*) FROM({LIST_SQL})"),[account],|row|row.get::<_,i64>(0)).unwrap();
        assert_eq!(count("a"),1);assert_eq!(count("b"),0);
        conn.execute("UPDATE messages SET uid_validity=10 WHERE account_id='a'",[]).unwrap();assert_eq!(count("a"),0);
    }
}
