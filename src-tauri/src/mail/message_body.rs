use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::imap_session;
use tauri::{AppHandle, Manager};
use mailparse::{parse_mail, ParsedMail};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static PREFETCH_RUNNING: AtomicBool = AtomicBool::new(false);

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

fn extract_displayable_body(app_handle: &AppHandle, uid: u32, raw_email: &[u8]) -> Result<String, String> {
    let parsed = parse_mail(raw_email)
        .map_err(|e| format!("Parsing error: {}", e))?;

    let mut best_html: Option<String> = None;
    let mut best_text: Option<String> = None;
    let mut cid_candidates: Vec<CidCandidate> = Vec::new();
    let mut all_parts: Vec<&ParsedMail> = Vec::new();

    fn traverse<'a>(
        part: &'a ParsedMail<'a>, 
        parts: &mut Vec<&'a ParsedMail<'a>>,
        best_html: &mut Option<String>, 
        best_text: &mut Option<String>,
        cids: &mut Vec<CidCandidate>
    ) {
        let current_index = parts.len();
        parts.push(part);

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
                
                cids.push(CidCandidate {
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
                        *best_html = Some(body);
                    }
                }
            } else if ctype == "text/plain" {
                if let Ok(body) = part.get_body() {
                    if !body.trim().is_empty() {
                        *best_text = Some(body);
                    }
                }
            }
        } else {
            for subpart in &part.subparts {
                traverse(subpart, parts, best_html, best_text, cids);
            }
        }
    }

    traverse(&parsed, &mut all_parts, &mut best_html, &mut best_text, &mut cid_candidates);

    let mut final_html = if let Some(html) = best_html {
        html
    } else if let Some(text) = best_text {
        let escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
    } else {
        let fallback = parsed.get_body().unwrap_or_else(|_| String::from_utf8_lossy(raw_email).to_string());
        let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
    };

    // Lazy Extraction of CID images
    if !cid_candidates.is_empty() {
        if let Ok(re) = Regex::new(r#"(?i)src\s*=\s*["']?\s*cid:([^"'\s>]+)"#) {
            let mut referenced_cids = HashSet::new();
            for cap in re.captures_iter(&final_html) {
                if let Some(m) = cap.get(1) {
                    referenced_cids.insert(m.as_str().to_string());
                }
            }

            if !referenced_cids.is_empty() {
                if let Ok(cache_dir) = app_handle.path().app_cache_dir() {
                    let inline_dir = cache_dir.join("orbitmail_inline").join(get_session_dir_name());
                    let _ = fs::create_dir_all(&inline_dir);
                    
                    for candidate in cid_candidates {
                        if referenced_cids.contains(&candidate.cid) {
                            let part = all_parts[candidate.part_index];
                            let safe_cid = candidate.cid.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
                            let ext = match candidate.mime.as_str() {
                                "image/png" => "png",
                                "image/jpeg" => "jpg",
                                "image/jpg" => "jpg",
                                "image/gif" => "gif",
                                "image/webp" => "webp",
                                _ => "bin",
                            };
                            let file_name = format!("uid_{}_cid_{}.{}", uid, safe_cid, ext);
                            let filepath = inline_dir.join(&file_name);

                            // Write if missing and under 5MB
                            if !filepath.exists() {
                                if let Ok(raw_bytes) = part.get_body_raw() {
                                    if raw_bytes.len() <= 5 * 1024 * 1024 {
                                        let _ = fs::write(&filepath, raw_bytes);
                                    }
                                }
                            }

                            // Tauri asset replacement string
                            let asset_url = format!("asset://localhost/{}", filepath.to_string_lossy().replace('\\', "/"));
                            
                            // String Rewrite
                            let cid_pattern = format!("cid:{}", candidate.cid);
                            final_html = final_html.replace(&cid_pattern, &asset_url);
                        }
                    }
                }
            }
        }
    }

    Ok(final_html)
}

fn generate_preview(html: &str) -> String {
    let re_hidden = Regex::new(r"(?si)<[^>]*display\s*:\s*none[^>]*>.*?</[^>]+>").unwrap();
    let re_tags = Regex::new(r"(?i)<[^>]+>").unwrap();
    let re_space = Regex::new(r"\s+").unwrap();

    let stripped = re_hidden.replace_all(html, " ").to_string();
    let stripped = re_tags.replace_all(&stripped, " ").to_string();
    let stripped = re_space.replace_all(&stripped, " ").to_string();
    let stripped = stripped.trim();

    if stripped.chars().count() > 160 {
        format!("{}...", stripped.chars().take(160).collect::<String>())
    } else {
        stripped.to_string()
    }
}

pub async fn get_message_body(app_handle: &AppHandle, account: Account, uid: u32) -> Result<String, String> {
    let app_handle_clone = app_handle.clone();
    let account_clone = account.clone();

    tokio::task::spawn_blocking(move || {
        // 1. Get the current mailbox validity to query cache properly
        let stored_validity = database::get_mailbox_validity(&app_handle_clone, "INBOX")
            .unwrap_or(None)
            .ok_or_else(|| "No stored mailbox validity. Resync required.".to_string())?;

        // 1.5 Check Memory Cache Primary
        if let Some(mem_body) = crate::mail::body_cache::get_cached_body(uid) {
            return Ok(mem_body);
        }

        // 2. Check SQLite Cache Secondary
        if let Ok(Some(cached_body)) = database::get_message_body_cache(&app_handle_clone, uid, stored_validity) {
            crate::mail::body_cache::insert_cached_body(uid, cached_body.clone());
            return Ok(cached_body);
        }

        // 3. Connect to IMAP
        imap_session::execute_with_session(&account_clone, |session| {
            // 4. CRITICAL: Fetch the full message
            let fetch_results = session.uid_fetch(
                uid.to_string(),
                "(BODY.PEEK[])"
            ).map_err(|e| format!("IMAP Body Fetch Error: {}", e))?;

            if let Some(msg) = fetch_results.iter().next() {
                let body_bytes_opt = msg.body().or_else(|| msg.text());
                
                if let Some(body_bytes) = body_bytes_opt {
                    match extract_displayable_body(&app_handle_clone, uid, body_bytes) {
                        Ok(parsed_body) => {
                            let preview = generate_preview(&parsed_body);
                            let _ = database::update_message_body(&app_handle_clone, uid, stored_validity, &parsed_body, &preview);
                            crate::mail::body_cache::insert_cached_body(uid, parsed_body.clone());
                            return Ok(parsed_body);
                        }
                        Err(_) => {
                            let fallback = String::from_utf8_lossy(body_bytes).to_string();
                            let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
                            let formatted_fallback = format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped);
                            let preview = generate_preview(&formatted_fallback);
                            let _ = database::update_message_body(&app_handle_clone, uid, stored_validity, &formatted_fallback, &preview);
                            crate::mail::body_cache::insert_cached_body(uid, formatted_fallback.clone());
                            return Ok(formatted_fallback);
                        }
                    }
                }
            }

            Err("Could not retrieve message body.".to_string())
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

pub async fn prefetch_recent_bodies(app_handle: AppHandle, account: Account) {
    if PREFETCH_RUNNING.swap(true, Ordering::SeqCst) {
        log::info!("Prefetch already running, skipping.");
        return;
    }

    struct PrefetchGuard;
    impl Drop for PrefetchGuard {
        fn drop(&mut self) {
            PREFETCH_RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _guard = PrefetchGuard;

    let uids = match database::get_unfetched_recent_uids(&app_handle, 10) {
        Ok(res) => res,
        Err(e) => {
            log::warn!("Prefetch query failed: {}", e);
            return;
        }
    };

    if uids.is_empty() {
        return;
    }

    log::info!("Starting background prefetch for {} emails.", uids.len());

    for (uid, uid_validity) in uids {
        // Double check cache in case user clicked it
        if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, uid, uid_validity) {
            continue;
        }

        log::info!("Prefetching body UID {}", uid);
        
        let _ = get_message_body(&app_handle, account.clone(), uid).await;
        
        // Let other tokio tasks run and avoid IMAP blasting throttle limits
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    log::info!("Finished background prefetch.");
}
