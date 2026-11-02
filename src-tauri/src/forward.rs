use tauri::AppHandle;
use mailparse::MailHeaderMap;
use crate::mail::{attachments::{AttachmentData,MAX_ATTACHMENT_BYTES},imap_session::{execute_with_session,SessionKind}};
use std::sync::Arc;
#[tauri::command]
pub async fn prepare_forward(app_handle:AppHandle,account_id:String,folder:String,uid:u32,expected_uid_validity:u32)->Result<serde_json::Value,String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let validity=crate::mail::database::message_uid_validity(&app_handle,&account_id,&folder,uid)?;
    if validity==0 || validity!=expected_uid_validity{return Err("Message identity changed. Reopen it.".into());}
    let mailbox=crate::mail::message_actions::resolve_mailbox(&app_handle,&account,&folder)?;
    let bytes=execute_with_session(&account,SessionKind::Body,move|session|{
        let selected=session.select(&mailbox).map_err(|e|e.to_string())?;
        if selected.uid_validity!=Some(validity){return Err("Mailbox identity changed.".into());}
        let sizes=session.uid_fetch(uid.to_string(),"RFC822.SIZE").map_err(|e|e.to_string())?;
        let size=sizes.iter().find(|row|row.uid==Some(uid)).and_then(|row|row.size).ok_or("Message size unavailable")? as usize;
        if size>26*1024*1024{return Err("This message is too large to forward in OrionMail (26 MB MIME limit).".into());}
        let rows=session.uid_fetch(uid.to_string(),"BODY.PEEK[]").map_err(|e|e.to_string())?;
        let body=rows.iter().find(|row|row.uid==Some(uid)).and_then(|row|row.body()).ok_or("Message is no longer available")?;
        if body.len()>26*1024*1024{return Err("Message exceeds forwarding size limit.".into());}Ok(body.to_vec())
    }).await?;
    let account_check=account_id.clone();let handle=app_handle.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        let parsed=mailparse::parse_mail(&bytes).map_err(|e|e.to_string())?;
        let mut text=String::new();let mut html=String::new();let mut files=Vec::new();
        if let Err(error)=visit(&parsed,0,&mut text,&mut html,&mut files){
            if parsed.ctype.mimetype=="multipart/signed"||parsed.ctype.mimetype=="multipart/encrypted"{
                if bytes.len()>MAX_ATTACHMENT_BYTES{return Err(error);}
                files=vec![AttachmentData{name:"original-message.eml".into(),mime_type:"message/rfc822".into(),bytes:Arc::new(bytes.clone())}];text="The original signed or encrypted message is attached.".into();html.clear();
            }else{return Err(error);}
        }
        if text.len()>2*1024*1024||html.len()>2*1024*1024{return Err("Forwarded message text exceeds the 2 MB draft limit.".into());}
        crate::auth::app_lock::require_unlocked(&handle)?;
        if crate::auth::session::get_active_profile(&handle).map(|value|value.id)!=Some(account_check.clone()){return Err("Account changed. Try again.".into());}
        let attachments=crate::mail::attachments::snapshot_forwarded(&account_check,files)?;
        Ok(serde_json::json!({"plain":text,"html":html,"from":parsed.headers.get_first_value("From").unwrap_or_default(),"to":parsed.headers.get_first_value("To").unwrap_or_default(),"cc":parsed.headers.get_first_value("Cc").unwrap_or_default(),"date":parsed.headers.get_first_value("Date").unwrap_or_default(),"subject":parsed.headers.get_first_value("Subject").unwrap_or_default(),"attachments":attachments}))
    }).await.map_err(|e|e.to_string())?;
    result
}

        fn visit(part:&mailparse::ParsedMail<'_>,depth:usize,text:&mut String,html:&mut String,files:&mut Vec<AttachmentData>)->Result<(),String>{
            if depth>30{return Err("Message nesting is too deep to forward.".into());}
            let disposition=part.get_content_disposition();let name=disposition.params.get("filename").or_else(||part.ctype.params.get("name"));
            if part.ctype.mimetype=="multipart/signed"||part.ctype.mimetype=="multipart/encrypted"{return Err("Signed or encrypted mail must be forwarded as an original email attachment.".into());}
            if part.subparts.is_empty()&&(name.is_some()||disposition.disposition==mailparse::DispositionType::Attachment||!matches!(part.ctype.mimetype.as_str(),"text/plain"|"text/html")){
                let bytes=part.get_body_raw().map_err(|e|e.to_string())?;
                if files.len()>=25||files.iter().map(|file|file.bytes.len()).sum::<usize>()+bytes.len()>MAX_ATTACHMENT_BYTES{return Err("Forwarded attachments exceed 25 files or 18 MB.".into());}
                files.push(AttachmentData{name:name.cloned().unwrap_or_else(||"forwarded-attachment".into()),mime_type:part.ctype.mimetype.clone(),bytes:Arc::new(bytes)});
                return Ok(());
            }else if part.ctype.mimetype=="text/plain"&&text.is_empty(){*text=part.get_body().map_err(|e|e.to_string())?;}else if part.ctype.mimetype=="text/html"&&html.is_empty(){*html=part.get_body().map_err(|e|e.to_string())?;}
            for child in &part.subparts{visit(child,depth+1,text,html,files)?;}Ok(())
        }

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn forward_extracts_readable_body_and_original_attachment_bytes(){
        let raw=b"From: a@example.com\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nHello forward\r\n--x\r\nContent-Type: text/plain; name=note.txt\r\nContent-Disposition: attachment; filename=note.txt\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n--x--\r\n";
        let parsed=mailparse::parse_mail(raw).unwrap();let mut text=String::new();let mut html=String::new();let mut files=Vec::new();
        visit(&parsed,0,&mut text,&mut html,&mut files).unwrap();
        assert!(text.contains("Hello forward"));assert_eq!(files.len(),1);assert_eq!(files[0].name,"note.txt");assert_eq!(files[0].bytes.as_slice(),b"Hello");
    }
    #[test]fn forwarded_attachment_handles_remain_account_scoped(){
        let owner=uuid::Uuid::new_v4().to_string();
        let files=crate::mail::attachments::snapshot_forwarded(&owner,vec![AttachmentData{name:"note.txt".into(),mime_type:"text/plain".into(),bytes:Arc::new(b"hello".to_vec())}]).unwrap();
        let handles=vec![files[0].handle.clone()];assert!(crate::mail::attachments::load_for_send("other-account",&handles).is_err());
        assert_eq!(crate::mail::attachments::load_for_send(&owner,&handles).unwrap()[0].bytes.as_slice(),b"hello");
        crate::mail::attachments::release_handles(&owner,&handles);
    }
}
