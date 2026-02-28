use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::imap_session;
use imap_proto::types::BodyStructure;

use tauri::{AppHandle, Manager};
use mailparse::{parse_mail, ParsedMail};
use tokio::sync::Semaphore;
use std::sync::Arc;
use once_cell::sync::Lazy;
pub static CONCURRENT_FETCH_LIMIT: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(3)));

use std::collections::HashSet;
use std::fs;
use regex::Regex;

use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::OnceLock;

static SESSION_DIR_NAME: OnceLock<String> = OnceLock::new();

fn get_session_dir_name() -> &'static str {
    SESSION_DIR_NAME.get_or_init(|| {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        format!("session_{}_{}", now, std::process::id())
    })
}

struct CidCandidate {
    cid: String,
    part_index: usize,
    mime: String,
}

struct MimeParts {
    best_html: Option<String>,
    best_text: Option<String>,
    cid_candidates: Vec<CidCandidate>,
    all_parts: Vec<Vec<u8>>, // store raw body bytes instead of lifetimes
}

impl MimeParts {
    fn new() -> Self {
        Self {
            best_html: None,
            best_text: None,
            cid_candidates: Vec::new(),
            all_parts: Vec::new(),
        }
    }

    fn traverse(&mut self, part: &ParsedMail) {
        let current_index = self.all_parts.len();
        self.all_parts.push(part.get_body_raw().unwrap_or_default());

        let is_attachment = part.headers.iter()
            .find(|h| h.get_key().to_lowercase() == "content-disposition")
            .map(|h| h.get_value().to_lowercase().contains("attachment"))
            .unwrap_or(false);

        let ctype = part.ctype.mimetype.to_lowercase();

        // Check for CID Candidate
        if !is_attachment && ctype.starts_with("image/") {
            if let Some(cid_header) = part.headers.iter().find(|h| h.get_key().to_lowercase() == "content-id") {
                let mut cid_val = cid_header.get_value();
                if cid_val.starts_with('<') && cid_val.ends_with('>') {
                    cid_val = cid_val[1..cid_val.len() - 1].to_string();
                }
                
                self.cid_candidates.push(CidCandidate {
                    cid: cid_val,
                    part_index: current_index,
                    mime: ctype.clone(),
                });
            }
        }

        if part.subparts.is_empty() {
            if ctype == "text/html" {
                if let Ok(body) = part.get_body() {
                    if body.trim().len() >= 20 {
                        self.best_html = Some(body);
                    }
                }
            } else if ctype == "text/plain" {
                if let Ok(body) = part.get_body() {
                    if !body.trim().is_empty() {
                        self.best_text = Some(body);
                    }
                }
            }
        } else {
            for subpart in &part.subparts {
                self.traverse(subpart);
            }
        }
    }
}

fn rewrite_cid_images(
    app_handle: &AppHandle, 
    uid: u32, 
    mut html: String, 
    parts: &MimeParts
) -> String {
    if parts.cid_candidates.is_empty() {
        return html;
    }

    let Ok(re) = Regex::new(r#"(?i)src\s*=\s*["']?\s*cid:([^"'\s>]+)"#) else {
        return html;
    };

    let mut referenced_cids = HashSet::new();
    for cap in re.captures_iter(&html) {
        if let Some(m) = cap.get(1) {
            referenced_cids.insert(m.as_str().to_string());
        }
    }

    if referenced_cids.is_empty() {
        return html;
    }

    let Ok(cache_dir) = app_handle.path().app_cache_dir() else { return html };
    let inline_dir = cache_dir.join("orbitmail_inline").join(get_session_dir_name());
    let _ = fs::create_dir_all(&inline_dir);
    
    for candidate in &parts.cid_candidates {
        if referenced_cids.contains(&candidate.cid) {
            let safe_cid = candidate.cid.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
            let ext = match candidate.mime.as_str() {
                "image/png" => "png",
                "image/jpeg" | "image/jpg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                _ => "bin",
            };
            let file_name = format!("uid_{}_cid_{}.{}", uid, safe_cid, ext);
            let filepath = inline_dir.join(&file_name);

            // Write if missing and under 5MB
            if !filepath.exists() {
                let raw_bytes = &parts.all_parts[candidate.part_index];
                if raw_bytes.len() <= 5 * 1024 * 1024 {
                    let _ = fs::write(&filepath, raw_bytes);
                }
            }

            // Tauri asset replacement string
            let asset_url = format!("asset://localhost/{}", filepath.to_string_lossy().replace('\\', "/"));
            
            // String Rewrite
            let cid_pattern = format!("cid:{}", candidate.cid);
            html = html.replace(&cid_pattern, &asset_url);
        }
    }

    html
}

fn extract_displayable_body(app_handle: &AppHandle, uid: u32, raw_email: &[u8]) -> Result<String, String> {
    // If it's a full email or section with MIME prepended, parse_mail works.
    let parsed_res = parse_mail(raw_email);
    
    let base_html = if let Ok(parsed) = parsed_res {
        let mut parts = MimeParts::new();
        parts.traverse(&parsed);
        
        let mut html_content = if let Some(html) = parts.best_html.clone() {
            html
        } else if let Some(text) = parts.best_text.clone() {
            let escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
            format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
        } else {
            let fallback = parsed.get_body().unwrap_or_else(|_| String::from_utf8_lossy(raw_email).to_string());
            let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
            format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
        };
        rewrite_cid_images(app_handle, uid, html_content, &parts)
    } else {
        String::from_utf8_lossy(raw_email).to_string()
    };

    Ok(base_html)
}

fn find_best_part<'a>(bs: &'a BodyStructure<'a>, prefix: &str) -> Option<String> {
    match bs {
        BodyStructure::Text { common, .. } => {
            let subtype_str = format!("{:?}", common).to_lowercase();
            if subtype_str.contains("html") || subtype_str.contains("plain") {
                Some(prefix.to_string())
            } else {
                None
            }
        },
        BodyStructure::Multipart { bodies, .. } => {
            let mut best: Option<String> = None;
            for (i, part) in bodies.iter().enumerate() {
                let part_id = if prefix.is_empty() {
                    format!("{}", i + 1)
                } else {
                    format!("{}.{}", prefix, i + 1)
                };
                if let Some(res) = find_best_part(part, &part_id) {
                    best = Some(res); // Will end up capturing the last HTML/plain part, which matches multipart/alternative precedence
                }
            }
            best
        },
        _ => None,
    }
}


fn generate_preview(html: &str) -> String {
    let re_style = Regex::new(r"(?si)<style[^>]*>.*?</style>").unwrap();
    let re_script = Regex::new(r"(?si)<script[^>]*>.*?</script>").unwrap();
    let re_hidden = Regex::new(r"(?si)<[^>]*display\s*:\s*none[^>]*>.*?</[^>]+>").unwrap();
    let re_tags = Regex::new(r"(?si)<[^>]+>").unwrap();
    let re_boiler = Regex::new(r"(?i)\b(unsubscribe|subscribe|view in browser|click here)\b").unwrap();
    let re_space = Regex::new(r"\s+").unwrap();

    let mut stripped = re_style.replace_all(html, " ").to_string();
    stripped = re_script.replace_all(&stripped, " ").to_string();
    stripped = re_hidden.replace_all(&stripped, " ").to_string();
    stripped = re_tags.replace_all(&stripped, " ").to_string();
    
    // HTML Entities
    stripped = stripped.replace("&nbsp;", " ");
    stripped = stripped.replace("&amp;", "&");
    stripped = stripped.replace("&lt;", "<");
    stripped = stripped.replace("&gt;", ">");
    stripped = stripped.replace("&quot;", "\"");
    stripped = stripped.replace("&#39;", "'");

    // Boilerplate words
    stripped = re_boiler.replace_all(&stripped, "").to_string();

    // Clean whitespace
    stripped = re_space.replace_all(&stripped, " ").to_string();
    stripped = stripped.trim().to_string();

    if stripped.chars().count() > 160 {
        format!("{}...", stripped.chars().take(160).collect::<String>())
    } else {
        stripped
    }
}

pub async fn fetch_and_cache_body_internal(app_handle: &AppHandle, account: &Account, uid: u32) -> Result<String, String> {
    let app_handle_cache = app_handle.clone();
    
    // 1. Check caches in a blocking task
    let cache_result = tokio::task::spawn_blocking(move || {
        let stored_validity = database::get_mailbox_validity(&app_handle_cache, "INBOX")
            .unwrap_or_default()
            .ok_or_else(|| "No stored mailbox validity. Resync required.".to_string())?;

        if let Some(mem_body) = crate::mail::body_cache::get_cached_body(uid) {
            return Ok((Some(mem_body), stored_validity));
        }

        if let Ok(Some(cached_body)) = database::get_message_body_cache(&app_handle_cache, "INBOX", uid) {
            crate::mail::body_cache::insert_cached_body(uid, cached_body.clone());
            return Ok((Some(cached_body), stored_validity));
        }

        Ok::<_, String>((None, stored_validity))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let (cached_opt, _stored_validity) = cache_result;
    if let Some(body) = cached_opt {
        return Ok(body);
    }

    // Prepare variables for the raw fetch payload
    let mut fetched_target_part = String::new();
    let mut fetched_full_payload: Vec<u8> = Vec::new();

    // -- SEMAPHORE ACQUIRE (NETWORK BOUNDARY) --
    let _permit = CONCURRENT_FETCH_LIMIT.clone().acquire_owned().await.map_err(|e| e.to_string())?;
    log::debug!("IMAP fetch start: uid={}, active_permits={}", uid, 3 - CONCURRENT_FETCH_LIMIT.available_permits());
    
    let imap_result = imap_session::execute_with_session(&account, imap_session::SessionKind::Prefetch, move |session| {
        let mut target_part = String::new();
        let mut full_payload: Vec<u8> = Vec::new();
        
        let fetch_bs = session.uid_fetch(uid.to_string(), "(BODYSTRUCTURE)")
            .map_err(|e| format!("IMAP fetch_bs error: {}", e))?;

        if let Some(msg) = fetch_bs.iter().next() {
            if let Some(bs) = msg.bodystructure() {
                if let Some(part_id) = find_best_part(bs, "") {
                    target_part = part_id;
                }
            }
        }

        let fetch_query = if target_part.is_empty() {
            "(BODY.PEEK[TEXT] BODY.PEEK[HEADER])".to_string()
        } else {
            format!("(BODY.PEEK[{}.MIME] BODY.PEEK[{}])", target_part, target_part)
        };

        log::debug!("Fetching with IMAP Query: UID {}, {}", uid, fetch_query);
        let fetch_results = session.uid_fetch(uid.to_string(), &fetch_query)
            .map_err(|e| format!("IMAP fetch payload error: {}", e))?;

        if let Some(msg) = fetch_results.iter().next() {
            if target_part.is_empty() {
                if let Some(h) = msg.header() { full_payload.extend_from_slice(h); }
                if let Some(t) = msg.text() { full_payload.extend_from_slice(t); }
            } else {
                let parts: Vec<u32> = target_part.split('.').filter_map(|s| s.parse().ok()).collect();
                let section_path = imap_proto::types::SectionPath::Part(parts.clone(), None);
                let mime_path = imap_proto::types::SectionPath::Part(parts, Some(imap_proto::types::MessageSection::Mime));
                
                if let Some(b) = msg.section(&mime_path) { full_payload.extend_from_slice(b); }
                if let Some(b) = msg.section(&section_path) { full_payload.extend_from_slice(b); }
                if let Some(t) = msg.text() { full_payload.extend_from_slice(t); }
            };

            if full_payload.is_empty() {
                if let Some(b) = msg.body().or_else(|| msg.text()) {
                    full_payload.extend_from_slice(b);
                }
            }
        }
        Ok::<_, String>((target_part, full_payload))
    }).await;
    
    let (fetched_target_part, fetched_full_payload) = match imap_result {
        Ok(data) => data,
        Err(e) => return Err(format!("IMAP Execution Error: {:?}", e)),
    };

    // -- SEMAPHORE DROP (NETWORK COMPLETE) --
    drop(_permit);
    log::debug!("IMAP fetch complete: uid={}", uid);

    // -- CPU BOUNDARY (HTML PARSING & DB STORAGE) --
    if !fetched_full_payload.is_empty() {
        match extract_displayable_body(app_handle, uid, &fetched_full_payload) {
            Ok(parsed_body) => {
                let preview = generate_preview(&parsed_body);
                let _ = database::update_message_body(app_handle, "INBOX", uid, &parsed_body, &preview);
                crate::mail::body_cache::insert_cached_body(uid, parsed_body.clone());
                return Ok(parsed_body);
            }
            Err(_) => {
                let fallback = String::from_utf8_lossy(&fetched_full_payload).to_string();
                let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
                let formatted_fallback = format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped);
                let preview = generate_preview(&formatted_fallback);
                let _ = database::update_message_body(app_handle, "INBOX", uid, &formatted_fallback, &preview);
                crate::mail::body_cache::insert_cached_body(uid, formatted_fallback.clone());
                return Ok(formatted_fallback);
            }
        }
    }

    Err("Could not retrieve message body.".to_string())
}

pub async fn get_message_body(app_handle: &AppHandle, account: Account, uid: u32) -> Result<String, String> {
    fetch_and_cache_body_internal(app_handle, &account, uid).await
}
