use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
pub struct SmartAction { pub label: String, pub value: String, pub link: bool, pub created_at: i64 }
pub fn enrich(current: &mut Option<SmartAction>, subject: &str, text: &str) -> bool {
    if current.is_some() { return false; }
    *current = detect(subject, text);
    current.is_some()
}
pub fn detect(subject: &str, text: &str) -> Option<SmartAction> {
    let codes = crate::mail::extraction::otp::extract_visible(text, subject);
    if codes.len() == 1 { return Some(SmartAction { label: "Copy code".into(), value: codes[0].value.clone(), link: false, created_at: chrono::Utc::now().timestamp() }); }
    let tracking = crate::mail::extraction::tracking::extract("", text);
    if tracking.len() == 1 { return Some(SmartAction { label: "Copy tracking number".into(), value: tracking[0].value.clone(), link: false, created_at: chrono::Utc::now().timestamp() }); }
    if let Ok(pattern)=crate::mail::patterns::regex(r#"https://[^\s<>"']+"#) {
      for found in pattern.find_iter(text).take(20) {
       let raw=found.as_str().trim_end_matches(['.',',',')']);
       if meeting_url(raw) {return Some(SmartAction {label:"Open meeting".into(),value:raw.into(),link:true,created_at:chrono::Utc::now().timestamp()});}
      }
    }
    None
}
pub fn meeting_url(raw: &str)->bool {
 let Ok(url)=url::Url::parse(raw)else{return false;};
 url.scheme()=="https" && url.username().is_empty() && url.password().is_none() && url.port().is_none() && raw.len()<2048 && matches!(url.host_str(),Some("meet.google.com"|"teams.microsoft.com"|"teams.live.com"|"zoom.us"|"us02web.zoom.us"|"us04web.zoom.us")) && url.path().len()>1
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn delayed_preview_adds_action_without_replacing_existing_code() {
  let mut action=None;
  assert!(!enrich(&mut action,"OrionMail test verification code",""));
  assert!(enrich(&mut action,"OrionMail test verification code","Your verification code is 012345. Use this code to finish signing in. This code expires in 10 minutes."));
  assert_eq!(action.as_ref().unwrap().value,"012345");
  assert!(!enrich(&mut action,"Verification code","Your verification code is 654321"));
  assert_eq!(action.unwrap().value,"012345");
 }
 #[test] fn links_reject_lookalikes_and_credentials(){assert!(meeting_url("https://meet.google.com/abc-defg-hij"));assert!(!meeting_url("https://meet.google.com.evil.test/abc"));assert!(!meeting_url("https://user@meet.google.com/abc"));assert!(!meeting_url("http://meet.google.com/abc"));}
 #[test] fn codes_require_authentication_context() {
  assert!(detect("Your order", "Order 123456 is on its way").is_none());
  let action=detect("Verification code", "Your verification code is 012345").unwrap();
  assert_eq!(action.value,"012345");assert!(!action.link);
 }
}
