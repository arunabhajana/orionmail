use crate::auth::account::Account;
use crate::mail::database;
use crate::mail::imap_session;
use tauri::{AppHandle, Manager};
use mailparse::{parse_mail, ParsedMail};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Semaphore;
use std::sync::Arc;
use once_cell::sync::Lazy;

static PREFETCH_RUNNING: AtomicBool = AtomicBool::new(false);
static PREFETCH_LIMIT: Lazy<Arc<Semaphore>> = Lazy::new(|| Arc::new(Semaphore::new(2)));

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
    let parsed = parse_mail(raw_email)
        .map_err(|e| format!("Parsing error: {}", e))?;

    let mut parts = MimeParts::new();
    parts.traverse(&parsed);

    // 1. Determine best viewing payload
    let base_html = if let Some(html) = parts.best_html.clone() {
        html
    } else if let Some(text) = parts.best_text.clone() {
        let escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
    } else {
        let fallback = parsed.get_body().unwrap_or_else(|_| String::from_utf8_lossy(raw_email).to_string());
        let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped)
    };

    // 2. Extensively parse and replace inline CID images
    Ok(rewrite_cid_images(app_handle, uid, base_html, &parts))
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

pub async fn get_message_body(app_handle: &AppHandle, account: Account, uid: u32) -> Result<String, String> {
    let app_handle_clone = app_handle.clone();
    let account_clone = account.clone();

    // 1. Check caches in a blocking task
    let cache_result = tokio::task::spawn_blocking(move || {
        // 1. Get the current mailbox validity to query cache properly
        let stored_validity = database::get_mailbox_validity(&app_handle_clone, "INBOX")
            .unwrap_or_default()
            .ok_or_else(|| "No stored mailbox validity. Resync required.".to_string())?;

        // 1.5 Check Memory Cache Primary
        if let Some(mem_body) = crate::mail::body_cache::get_cached_body(uid) {
            return Ok((Some(mem_body), stored_validity));
        }

        // 2. Check SQLite Cache Secondary
        if let Ok(Some(cached_body)) = database::get_message_body_cache(&app_handle_clone, "INBOX", uid) {
            crate::mail::body_cache::insert_cached_body(uid, cached_body.clone());
            return Ok((Some(cached_body), stored_validity));
        }

        Ok::<_, String>((None, stored_validity))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    let (cached_opt, stored_validity) = cache_result;
    if let Some(body) = cached_opt {
        return Ok(body);
    }

    // 3. Connect to IMAP and execute fetch asynchronously (it handles its own spawn_blocking)
    let app_handle_clone = app_handle.clone();
    
    imap_session::execute_with_session(&account_clone, imap_session::SessionKind::Prefetch, move |session| {
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
                        let _ = database::update_message_body(&app_handle_clone, "INBOX", uid, &parsed_body, &preview);
                        crate::mail::body_cache::insert_cached_body(uid, parsed_body.clone());
                        return Ok(parsed_body);
                    }
                    Err(_) => {
                        let fallback = String::from_utf8_lossy(body_bytes).to_string();
                        let escaped = fallback.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
                        let formatted_fallback = format!("<pre style=\"white-space:pre-wrap;font-family:system-ui\">{}</pre>", escaped);
                        let preview = generate_preview(&formatted_fallback);
                        let _ = database::update_message_body(&app_handle_clone, "INBOX", uid, &formatted_fallback, &preview);
                        crate::mail::body_cache::insert_cached_body(uid, formatted_fallback.clone());
                        return Ok(formatted_fallback);
                    }
                }
            }
        }

        Err("Could not retrieve message body.".to_string())
    }).await
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

    let uids = match database::get_unfetched_recent_uids(&app_handle, "INBOX", 10) {
        Ok(res) => res,
        Err(e) => {
            log::warn!("Prefetch query failed: {}", e);
            return;
        }
    };

    if uids.is_empty() {
        return;
    }

    log::info!(
        "Starting background prefetch for {} emails. Production Architecture Note: \
        IMAP servers aggressively terminate unbounded parallel connections. We specifically use a Tokio \
        Semaphore to limit prefetch concurrency to exactly 2 active background tasks. This ensures 1-2 concurrent \
        body fetches, which is fast enough for background Sync while preventing IMAP Session pool starvation, \
        safeguarding the primary IDLE connection, and maintaining connection stability naturally.",
        uids.len()
    );

    for uid in uids {
        // Double check cache in case user clicked it
        if let Ok(Some(_)) = database::get_message_body_cache(&app_handle, "INBOX", uid) {
            continue;
        }

        log::info!("Prefetch queueing body UID {}", uid);
        
        let permit = match PREFETCH_LIMIT.clone().acquire_owned().await {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Prefetch semaphore closed: {}", e);
                break;
            }
        };

        let app_handle_clone = app_handle.clone();
        let account_clone = account.clone();

        tokio::spawn(async move {
            let _permit = permit;
            log::info!("Prefetch actively fetching body UID {}", uid);
            let _ = get_message_body(&app_handle_clone, account_clone, uid).await;
        });
        
        // Yield to allow other tasks (including the spawned fetch) to progress
        tokio::task::yield_now().await;
        // Minor pacing to avoid hammering the disk or Tokio executor locally
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    log::info!("Finished background prefetch.");
}
