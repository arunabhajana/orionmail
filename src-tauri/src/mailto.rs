use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle,Emitter,Manager};

#[derive(Clone,Serialize)]
pub struct Mailto { pub id:String, pub to:Vec<String>, pub cc:String, pub bcc:String, pub subject:String, pub body:String }
static PENDING:Lazy<Mutex<VecDeque<Mailto>>>=Lazy::new(||Mutex::new(VecDeque::new()));
fn addresses(raw:&str)->Result<Vec<String>,String>{
    let mut values=Vec::new();
    for value in raw.split(',').map(str::trim).filter(|v|!v.is_empty()) {
        if value.len()>512 || value.chars().any(char::is_control) || !email_address::EmailAddress::is_valid(value){return Err("Invalid mail link recipient".into());}
        if !values.iter().any(|s:&String|s.eq_ignore_ascii_case(value)){values.push(value.to_string());}
    }
    if values.len()>25{return Err("Too many mail link recipients".into());} Ok(values)
}
fn parse(raw:&str)->Result<Mailto,String>{
    if raw.len()>8192 || raw.trim()!=raw || raw.chars().any(char::is_control){return Err("Invalid mail link".into());}
    let url=url::Url::parse(raw).map_err(|_|"Invalid mail link")?;
    if url.scheme()!="mailto" || url.host_str().is_some() || url.fragment().is_some(){return Err("Invalid mail link".into());}
    let encoded=format!("address={}",url.path().replace('+',"%2B"));
    let recipient=url::form_urlencoded::parse(encoded.as_bytes()).next().map(|(_,v)|v.into_owned()).unwrap_or_default();
    let mut result=Mailto{id:uuid::Uuid::new_v4().to_string(),to:addresses(&recipient)?,cc:String::new(),bcc:String::new(),subject:String::new(),body:String::new()};
    let mut seen=std::collections::HashSet::new();
    for (key,value) in url.query_pairs(){
        let key=key.to_ascii_lowercase();
        if !["to","cc","bcc","subject","body"].contains(&key.as_str()){continue;}
        if !seen.insert(key.clone()){return Err("Duplicate fields in mail link".into());}
        match key.as_str(){
            "to"=>{result.to.extend(addresses(&value)?);},"cc"=>result.cc=addresses(&value)?.join(", "),"bcc"=>result.bcc=addresses(&value)?.join(", "),
            "subject"=>{if value.len()>2000 || value.chars().any(char::is_control){return Err("Invalid mail link subject".into());}result.subject=value.into_owned();},
            "body"=>result.body=value.into_owned(),_=>()
        }
    }
    result.to=addresses(&result.to.join(","))?; Ok(result)
}
pub fn receive(app:&AppHandle,raw:&str)->Result<(),String>{
    let request=parse(raw)?;
    {let mut queue=PENDING.lock().map_err(|_|"Mail links unavailable")?;if queue.len()>=16{return Err("Too many pending mail links".into());}queue.push_back(request);}
    let _=app.emit("mailto:pending",());
    let handle=app.clone();let _=app.run_on_main_thread(move||{if let Some(window)=handle.get_webview_window("main"){let _=window.show();let _=window.unminimize();let _=window.set_focus();crate::window_activity::refresh(&window);}});
    Ok(())
}
#[tauri::command]
pub fn pending_mailto(app_handle:AppHandle)->Result<Option<Mailto>,String>{crate::auth::app_lock::require_unlocked(&app_handle)?;Ok(PENDING.lock().map_err(|_|"Mail links unavailable")?.front().cloned())}
#[tauri::command]
pub fn ack_mailto(app_handle:AppHandle,id:String)->Result<(),String>{crate::auth::app_lock::require_unlocked(&app_handle)?;let mut queue=PENDING.lock().map_err(|_|"Mail links unavailable")?;if queue.front().is_some_and(|item|item.id==id){queue.pop_front();}Ok(())}
#[cfg(target_os="windows")]
pub fn register()->Result<(),String>{
    use winreg::{RegKey,enums::HKEY_CURRENT_USER};
    let root=RegKey::predef(HKEY_CURRENT_USER);
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;
    let name=if cfg!(debug_assertions){"OrionMail Dev"}else{"OrionMail"};
    let prog=if cfg!(debug_assertions){"OrionMail.Dev.Mailto"}else{"OrionMail.Mailto"};
    let capability=format!("Software\\Clients\\Mail\\{name}\\Capabilities");
    let set=|path:&str,key:&str,value:&str|->Result<(),String>{root.create_subkey(path).and_then(|(entry,_)|entry.set_value(key,&value)).map_err(|e|e.to_string())};
    let class=format!("Software\\Classes\\{prog}");
    set(&class,"",&format!("{name} mail link"))?;set(&class,"URL Protocol","")?;
    set(&format!("{class}\\DefaultIcon"),"",&format!("\"{}\",0",exe.display()))?;
    set(&format!("{class}\\shell\\open\\command"),"",&format!("\"{}\" --mailto \"%1\"",exe.display()))?;
    set(&capability,"ApplicationName",name)?;set(&capability,"ApplicationDescription","Read and write email with OrionMail")?;
    set(&format!("{capability}\\URLAssociations"),"mailto",prog)?;
    set("Software\\RegisteredApplications",name,&capability)?;
    Ok(())
}
#[tauri::command]
pub async fn open_default_mail_settings(app_handle:AppHandle)->Result<(),String>{
    crate::auth::app_lock::require_unlocked(&app_handle)?;
    #[cfg(target_os="windows")]
    {tauri::async_runtime::spawn_blocking(||{register()?;open::that("ms-settings:defaultapps").map_err(|e|e.to_string())}).await.map_err(|e|e.to_string())?}
    #[cfg(not(target_os="windows"))]
    {Err("Use your operating system’s default mail settings.".into())}
}
#[cfg(test)]mod tests{use super::*;
    #[test]fn mailto_decodes_supported_fields_as_plain_text(){let m=parse("mailto:alex%2Btest@example.com?subject=Hello%20there&body=%3Cb%3EHi%3C%2Fb%3E%0D%0AHello&cc=team%40example.com&attach=C:/secret").unwrap();assert_eq!(m.to,vec!["alex+test@example.com"]);assert_eq!(m.subject,"Hello there");assert_eq!(m.body,"<b>Hi</b>\r\nHello");assert_eq!(m.cc,"team@example.com");}
    #[test]fn rejects_header_injection_and_ambiguous_parameters(){for raw in ["https://example.com","mailto:a@example.com?subject=x%0D%0ABcc:bad","mailto:a@example.com?cc=x%0Ay@example.com","mailto:a@example.com?subject=a&subject=b","mailto://host/a@example.com"]{assert!(parse(raw).is_err(),"{raw}");}}
}
