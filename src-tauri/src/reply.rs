use tauri::AppHandle;
use mailparse::MailHeaderMap;
#[tauri::command]
pub async fn prepare_reply(app_handle:AppHandle,account_id:String,folder:String,uid:u32,expected_uid_validity:u32,reply_all:Option<bool>)->Result<serde_json::Value,String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    let account=crate::auth::bootstrap::ensure_active_account(&app_handle).await?;
    if account.id!=account_id{return Err("Account changed. Reopen the message.".into());}
    let validity=crate::mail::database::message_uid_validity(&app_handle,&account_id,&folder,uid)?;
    if validity==0 || validity!=expected_uid_validity{return Err("Message identity changed. Reopen the message.".into());}
    let mailbox=crate::mail::message_actions::resolve_mailbox(&app_handle,&account,&folder)?;
    let own=account.email.clone();
    let reply=crate::mail::imap_session::execute_with_session(&account,crate::mail::imap_session::SessionKind::Body,move|session|{
        let selected=session.select(&mailbox).map_err(|e|e.to_string())?;
        if selected.uid_validity!=Some(validity){return Err("Mailbox identity changed. Reopen the message.".into());}
        let rows=session.uid_fetch(uid.to_string(),"BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO TO CC MESSAGE-ID REFERENCES)]").map_err(|e|e.to_string())?;
        let raw=rows.iter().find(|row|row.uid==Some(uid)).and_then(|row|row.header()).ok_or("Message headers unavailable")?;
        let (headers,_)=mailparse::parse_headers(raw).map_err(|e|e.to_string())?;
        let sender=headers.get_first_value("Reply-To").or_else(||headers.get_first_value("From")).ok_or("Message has no reply address")?;
        let (to,cc)=reply_recipients(&sender,&headers.get_first_value("To").unwrap_or_default(),&headers.get_first_value("Cc").unwrap_or_default(),&own,reply_all.unwrap_or(false))?;
        let ids=regex::Regex::new(r"<[^<>\s]+>").map_err(|e|e.to_string())?;
        let parent=headers.get_first_value("Message-ID").and_then(|raw|ids.find(&raw).map(|value|value.as_str().to_string()));
        let mut references=ids.find_iter(&headers.get_first_value("References").unwrap_or_default()).map(|value|value.as_str().to_string()).collect::<Vec<_>>();
        if let Some(id)=&parent{if !references.contains(id){references.push(id.clone());}}
        if references.len()>100{let first=references[0].clone();references=references.split_off(references.len()-99);references.insert(0,first);}
        Ok(serde_json::json!({"to":to,"cc":cc.join(", "),"in_reply_to":parent,"references":references}))
    }).await?;
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    if crate::auth::session::get_active_profile(&app_handle).map(|value|value.id)!=Some(account_id){return Err("Account changed. Try again.".into());}
    Ok(reply)
}

fn addresses(raw:&str)->Result<Vec<String>,String>{
    let parsed=mailparse::addrparse(raw).map_err(|_|"Invalid reply address")?;
    let mut result=Vec::new();for address in parsed.iter(){match address{mailparse::MailAddr::Single(info)=>result.push(info.addr.clone()),mailparse::MailAddr::Group(group)=>result.extend(group.addrs.iter().map(|info|info.addr.clone()))}}Ok(result)
}
fn reply_recipients(sender:&str,to:&str,cc:&str,own:&str,all:bool)->Result<(Vec<String>,Vec<String>),String>{
    let sender=addresses(sender)?;let original_to=addresses(to)?;let original_cc=if all{addresses(cc)?}else{Vec::new()};
    let own_sender=!sender.is_empty()&&sender.iter().all(|value|value.eq_ignore_ascii_case(own));
    let mut targets=if own_sender {original_to.clone()}else{sender};
    if all&&!own_sender {targets.extend(original_to);}
    let mut seen=std::collections::HashSet::new();seen.insert(own.to_ascii_lowercase());
    let mut unique=|values:Vec<String>|values.into_iter().filter(|value|seen.insert(value.to_ascii_lowercase())).collect::<Vec<_>>();
    let targets=unique(targets);let copies=if all{unique(original_cc)}else{Vec::new()};
    if targets.is_empty()&&copies.is_empty(){return Err("Message has no reply recipients".into());}
    if targets.is_empty(){return Ok((copies,Vec::new()));}
    Ok((targets,copies))
}
#[cfg(test)]mod tests{use super::*;
    #[test]fn reply_all_excludes_self_and_duplicates(){let (to,cc)=reply_recipients("Alice <alice@example.com>","me@example.com, BOB@example.com, alice@example.com","bob@example.com, carol@example.com, ME@example.com","me@example.com",true).unwrap();assert_eq!(to,vec!["alice@example.com","BOB@example.com"]);assert_eq!(cc,vec!["carol@example.com"]);}
    #[test]fn reply_to_own_sent_mail_keeps_original_to_and_cc(){let (to,cc)=reply_recipients("me@example.com","bob@example.com","carol@example.com","me@example.com",true).unwrap();assert_eq!(to,vec!["bob@example.com"]);assert_eq!(cc,vec!["carol@example.com"]);}
    #[test]fn reply_does_not_expand_other_recipients(){let (to,cc)=reply_recipients("reply@example.com","me@example.com, bob@example.com","carol@example.com","me@example.com",false).unwrap();assert_eq!(to,vec!["reply@example.com"]);assert!(cc.is_empty());}
}
