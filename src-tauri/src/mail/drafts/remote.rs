use super::{changed, store, Draft, DraftFile, Payload, SYNC_LOCK};
use crate::auth::account::Account;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures::{stream, StreamExt};
use mailparse::MailHeaderMap;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::AppHandle;

static CLIENT: once_cell::sync::Lazy<reqwest::Client> = once_cell::sync::Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("Gmail HTTP client")
});
#[derive(Debug)]
pub(super) struct ApiError {
    pub message: String,
    pub uncertain: bool,
    pub missing: bool,
    pub forbidden: bool,
}
async fn api(
    account: &Account,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let mutation = method != reqwest::Method::GET;
    let mut request = CLIENT
        .request(
            method,
            format!("https://gmail.googleapis.com/gmail/v1/users/me/{path}"),
        )
        .bearer_auth(&account.access_token);
    if let Some(body) = body {
        request = request.json(&body)
    }
    let mut response = request.send().await.map_err(|e| ApiError {
        message: "Gmail is unavailable. Your draft is saved on this device.".into(),
        uncertain: mutation && !e.is_connect(),
        missing: false,
        forbidden: false,
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError{message:match status.as_u16(){401=>"Sign in again to sync your saved drafts.",403=>"Gmail denied draft access. Enable the Gmail API for your OAuth project and check permissions.",429=>"Gmail is busy. Draft sync will retry.",_=>"Gmail could not sync this draft. Your local copy is safe."}.into(),uncertain:mutation&&status.is_server_error(),missing:status.as_u16()==404,forbidden:status.as_u16()==403});
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ApiError {
        message: "Could not confirm Gmail's response. Checking before retrying.".into(),
        uncertain: mutation,
        missing: false,
        forbidden: false,
    })? {
        if bytes.len() + chunk.len() > 36 * 1024 * 1024 {
            return Err(ApiError {
                message: "Gmail draft exceeds supported size limits.".into(),
                uncertain: mutation,
                missing: false,
                forbidden: false,
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError {
        message: "Invalid Gmail response. Your local copy is safe.".into(),
        uncertain: mutation,
        missing: false,
        forbidden: false,
    })
}
fn resource_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        Err("Invalid Gmail draft identity".into())
    } else {
        Ok(id)
    }
}
fn version(value: &Value) -> Result<&str, String> {
    value
        .pointer("/message/id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Gmail returned no draft message identity".into())
}
fn marker(draft: &Draft) -> String {
    format!("<orion.{}.{}@orionmail.local>", draft.id, draft.revision)
}
fn origin(headers: &[mailparse::MailHeader<'_>]) -> Option<(String, i64)> {
    let value = headers.get_first_value("Message-ID")?;
    let value = value
        .trim()
        .strip_prefix("<orion.")?
        .strip_suffix("@orionmail.local>")?;
    let (id, revision) = value.rsplit_once('.')?;
    uuid::Uuid::parse_str(id).ok()?;
    Some((id.into(), revision.parse().ok()?))
}
fn addresses(value: &str) -> Result<Vec<String>, String> {
    if value.trim().is_empty() {
        return Ok(vec![]);
    }
    mailparse::addrparse(value)
        .map_err(|_| "Fix the recipient addresses to sync this draft to Gmail.".into())
        .map(|list| {
            list.iter()
                .flat_map(|address| match address {
                    mailparse::MailAddr::Single(info) => vec![info.addr.clone()],
                    mailparse::MailAddr::Group(group) => {
                        group.addrs.iter().map(|info| info.addr.clone()).collect()
                    }
                })
                .collect()
        })
}
fn fingerprint(
    payload: &Payload,
    files: &[crate::mail::attachments::AttachmentData],
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let normalize = |value: &str| {
        value
            .replace("\r\n", "\n")
            .trim_end_matches('\n')
            .to_string()
    };
    let mut digest = Sha256::new();
    let fields = json!({"to":payload.to,"cc":addresses(&payload.cc)?,"bcc":addresses(&payload.bcc)?,"subject":payload.subject,
        "html":normalize(&payload.html),"plain":normalize(&payload.plain)});
    digest.update(serde_json::to_vec(&fields).map_err(|e| e.to_string())?);
    for file in files {
        let metadata = serde_json::to_vec(&json!([file.name, file.mime_type.to_ascii_lowercase()]))
            .map_err(|e| e.to_string())?;
        digest.update((metadata.len() as u64).to_le_bytes());
        digest.update(metadata);
        digest.update((file.bytes.len() as u64).to_le_bytes());
        digest.update(file.bytes.as_slice());
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn mime(app: &AppHandle, account: &Account, draft: &Draft) -> Result<(String, String), String> {
    use lettre::{
        address::Envelope,
        message::{header::MessageId, Attachment, MultiPart},
        Message,
    };
    let payload = &draft.payload;
    let mut builder = Message::builder()
        .from(
            account
                .email
                .parse()
                .map_err(|_| "Invalid account address")?,
        )
        .subject(&payload.subject)
        .header(MessageId::from(marker(draft)))
        .keep_bcc()
        .envelope(
            Envelope::new(
                None,
                vec![account
                    .email
                    .parse()
                    .map_err(|_| "Invalid account address")?],
            )
            .map_err(|e| e.to_string())?,
        );
    for address in &payload.to {
        builder = builder.to(address
            .parse()
            .map_err(|_| "Fix the To addresses before Gmail sync")?)
    }
    for address in addresses(&payload.cc)? {
        builder = builder.cc(address
            .parse()
            .map_err(|_| "Fix the Cc addresses before Gmail sync")?)
    }
    for address in addresses(&payload.bcc)? {
        builder = builder.bcc(
            address
                .parse()
                .map_err(|_| "Fix the Bcc addresses before Gmail sync")?,
        )
    }
    let mut parts = MultiPart::mixed().multipart(MultiPart::alternative_plain_html(
        payload.plain.clone(),
        payload.html.clone(),
    ));
    let files = store::files(app, &account.id, draft)?;
    let fingerprint = fingerprint(payload, &files)?;
    for file in files {
        parts = parts.singlepart(
            Attachment::new(file.name).body(
                file.bytes.as_ref().clone(),
                file.mime_type
                    .parse()
                    .map_err(|_| "Invalid attachment MIME type")?,
            ),
        );
    }
    let email = builder.multipart(parts).map_err(|e| e.to_string())?;
    Ok((URL_SAFE_NO_PAD.encode(email.formatted()), fingerprint))
}
fn decode(
    value: &Value,
) -> Result<
    (
        Payload,
        Vec<crate::mail::attachments::AttachmentData>,
        Option<(String, i64)>,
    ),
    String,
> {
    let raw = value
        .pointer("/message/raw")
        .and_then(Value::as_str)
        .ok_or("Gmail returned no draft content")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(raw.trim_end_matches('='))
        .map_err(|_| "Invalid Gmail MIME encoding")?;
    let parsed = mailparse::parse_mail(&bytes).map_err(|e| e.to_string())?;
    let mut payload = Payload {
        to: addresses(&parsed.headers.get_first_value("To").unwrap_or_default())?,
        cc: parsed.headers.get_first_value("Cc").unwrap_or_default(),
        bcc: parsed.headers.get_first_value("Bcc").unwrap_or_default(),
        subject: parsed
            .headers
            .get_first_value("Subject")
            .unwrap_or_default(),
        ..Payload::default()
    };
    let mut files = Vec::new();
    fn visit(
        part: &mailparse::ParsedMail<'_>,
        payload: &mut Payload,
        files: &mut Vec<crate::mail::attachments::AttachmentData>,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 30 {
            return Err("Draft MIME nesting exceeds supported limits".into());
        }
        let disposition = part.get_content_disposition();
        let name = disposition
            .params
            .get("filename")
            .or_else(|| part.ctype.params.get("name"));
        if matches!(
            part.ctype.mimetype.as_str(),
            "multipart/encrypted" | "multipart/signed"
        ) {
            return Err(
                "This draft is encrypted or signed. Edit it in Gmail to preserve it.".into(),
            );
        }
        if name.is_some()
            || disposition.disposition == mailparse::DispositionType::Attachment
            || part.subparts.is_empty()
                && !matches!(
                    part.ctype.mimetype.as_str(),
                    "text/html" | "text/plain" | "message/rfc822"
                )
        {
            let bytes = part.get_body_raw().map_err(|e| e.to_string())?;
            if files.len() >= 25
                || files.iter().map(|f| f.bytes.len()).sum::<usize>() + bytes.len()
                    > 18 * 1024 * 1024
            {
                return Err(
                    "Gmail draft attachments exceed 18 MB or 25 files; edit this draft in Gmail."
                        .into(),
                );
            }
            let name = name.cloned().unwrap_or_else(|| "inline-image".into());
            payload.attachments.push(DraftFile {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.clone(),
                size: bytes.len(),
                mime_type: part.ctype.mimetype.clone(),
                handle: String::new(),
            });
            files.push(crate::mail::attachments::AttachmentData {
                name,
                mime_type: part.ctype.mimetype.clone(),
                bytes: std::sync::Arc::new(bytes),
            });
        } else if part.ctype.mimetype == "text/html" && payload.html.is_empty() {
            payload.html = part.get_body().map_err(|e| e.to_string())?
        } else if part.ctype.mimetype == "text/plain" && payload.plain.is_empty() {
            payload.plain = part.get_body().map_err(|e| e.to_string())?
        } else if part.ctype.mimetype == "message/rfc822" {
            return Err(
                "This draft has an attached email. Edit it in Gmail to preserve its content."
                    .into(),
            );
        }
        for child in &part.subparts {
            visit(child, payload, files, depth + 1)?
        }
        Ok(())
    }
    visit(&parsed, &mut payload, &mut files, 0)?;
    // Inline CID media cannot be faithfully rewritten by the composer yet.
    if payload.html.to_ascii_lowercase().contains("cid:") {
        return Err(
            "This draft contains embedded images. Edit it in Gmail to preserve them.".into(),
        );
    }
    if payload.html.is_empty() {
        payload.html = format!(
            "<p>{}</p>",
            payload
                .plain
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('\n', "<br>")
        );
    }
    if payload.plain.is_empty() {
        payload.plain = crate::mail::extraction::content::parse(&payload.html).text;
    }
    payload.validate()?;
    Ok((payload, files, origin(&parsed.headers)))
}
async fn list(account: &Account) -> Result<Vec<(String, String)>, String> {
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut pages = std::collections::HashSet::new();
    let mut page = String::new();
    loop {
        let path = format!(
            "drafts?maxResults=100{}",
            if page.is_empty() {
                String::new()
            } else {
                format!(
                    "&pageToken={}",
                    url::form_urlencoded::byte_serialize(page.as_bytes()).collect::<String>()
                )
            }
        );
        let result = api(account, reqwest::Method::GET, &path, None)
            .await
            .map_err(|e| e.message)?;
        if let Some(drafts) = result.get("drafts").and_then(Value::as_array) {
            for draft in drafts {
                let id = draft
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or("Invalid Gmail draft list")?;
                resource_id(id)?;
                if seen.insert(id.to_string()) {
                    entries.push((id.into(), version(draft)?.into()));
                }
            }
        }
        page = result
            .get("nextPageToken")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into();
        if page.is_empty() {
            break;
        }
        if !pages.insert(page.clone()) {
            return Err("Gmail returned a repeated draft page. No drafts were removed.".into());
        }
        if entries.len() > 10_000 {
            return Err("Too many Gmail drafts to reconcile safely.".into());
        }
    }
    Ok(entries)
}
pub async fn sync(app: &AppHandle, account: &Account) -> Result<(), String> {
    let _lock = SYNC_LOCK.lock().await;
    crate::auth::app_lock::require_unlocked(app)?;
    let entries = list(account).await?;
    let local = store::all(app, &account.id)?;
    for draft in local.iter().filter(|draft| draft.state == "send_unknown") {
        let query = url::form_urlencoded::byte_serialize(
            format!("rfc822msgid:{}", marker(draft)).as_bytes(),
        )
        .collect::<String>();
        if let Ok(result) = api(
            account,
            reqwest::Method::GET,
            &format!("messages?labelIds=SENT&maxResults=2&q={query}"),
            None,
        )
        .await
        {
            if result
                .get("messages")
                .and_then(Value::as_array)
                .is_some_and(|messages| !messages.is_empty())
            {
                store::sent(app, &account.id, draft)?;
            }
        }
    }
    let downloads: Vec<_> = entries
        .iter()
        .filter(|(id, ver)| {
            !local
                .iter()
                .any(|d| d.remote_id.as_ref() == Some(id) && d.remote_version.as_ref() == Some(ver))
        })
        .cloned()
        .collect();
    let mut work = stream::iter(downloads.into_iter().map(|(id, ver)| async move {
        let result = api(
            account,
            reqwest::Method::GET,
            &format!("drafts/{id}?format=raw"),
            None,
        )
        .await;
        (id, ver, result)
    }))
    .buffer_unordered(2);
    let mut import_error = None;
    while let Some((id, ver, result)) = work.next().await {
        let value = match result {
            Ok(value) => value,
            Err(error) => {
                import_error = Some(error.message);
                continue;
            }
        };
        // List and fetch can observe different provider revisions; the GET is authoritative.
        let ver = version(&value).unwrap_or(&ver).to_string();
        let (payload, files, origin) = match decode(&value) {
            Ok(decoded) => decoded,
            Err(error) => {
                // Unsupported MIME remains visible and linked to Gmail, rather than
                // becoming an empty editable draft which would lose attachments.
                let mut payload = Payload::default();
                if let Some(raw) = value
                    .pointer("/message/raw")
                    .and_then(Value::as_str)
                    .and_then(|raw| URL_SAFE_NO_PAD.decode(raw.trim_end_matches('=')).ok())
                {
                    if let Ok(parsed) = mailparse::parse_mail(&raw) {
                        payload.subject = parsed
                            .headers
                            .get_first_value("Subject")
                            .unwrap_or_default();
                        payload.to =
                            addresses(&parsed.headers.get_first_value("To").unwrap_or_default())
                                .unwrap_or_default();
                    }
                }
                payload.plain = error.clone();
                let existing = store::by_remote(app, &account.id, &id)?;
                if existing
                    .as_ref()
                    .is_some_and(|draft| draft.dirty || draft.editing)
                {
                    import_error = Some(error);
                    continue;
                }
                let existing_id = existing.as_ref().map(|draft| draft.id.as_str());
                store::import(app, &account.id, &id, &ver, payload, vec![], existing_id)?;
                if let Some(draft) = store::by_remote(app, &account.id, &id)? {
                    store::status(app, &account.id, &draft.id, "unsupported", Some(&error))?;
                }
                continue;
            }
        };
        if let Some((own, revision)) = origin {
            if let Ok(draft) = store::get(app, &account.id, &own) {
                if draft.upload_revision == Some(revision)
                    && draft.upload_fingerprint.as_deref()
                        == Some(fingerprint(&payload, &files)?.as_str())
                {
                    store::acknowledge(app, &account.id, &own, revision, &id, &ver)?;
                    continue;
                }
            }
        }
        let current = store::by_remote(app, &account.id, &id)?;
        if let Some(draft) = current {
            if matches!(draft.state.as_str(), "sending" | "send_unknown") {
                continue;
            }
            if draft.dirty
                || draft.editing
                || !draft.payload.pending_to.trim().is_empty()
                || draft.state == "deleting"
            {
                store::detach(app, &account.id, &draft.id)?;
                store::import(app, &account.id, &id, &ver, payload, files, None)?;
            } else {
                let _ = store::import(app, &account.id, &id, &ver, payload, files, Some(&draft.id));
            }
        } else {
            store::import(app, &account.id, &id, &ver, payload, files, None)?;
        }
    }
    for draft in store::all(app, &account.id)? {
        if draft
            .remote_id
            .as_ref()
            .is_some_and(|id| !entries.iter().any(|(remote, _)| id == remote))
        {
            if draft.state == "send_unknown" || draft.state == "sending" {
                continue;
            }
            if draft.state == "deleting" {
                store::remove(app, &account.id, &draft.id)?;
                continue;
            }
            if !draft.dirty && !draft.editing && draft.payload.pending_to.trim().is_empty() {
                store::remove_clean(app, &account.id, &draft)?;
                continue;
            }
            store::detach(app, &account.id, &draft.id)?;
        }
    }
    for draft in store::all(app, &account.id)? {
        if matches!(
            draft.state.as_str(),
            "checking" | "sending" | "send_unknown" | "needs_attachments"
        ) {
            continue;
        }
        if draft.state == "deleting" {
            // A timed-out create might still be committed by Gmail. Keep the
            // tombstone until its stable request marker can be reconciled.
            if draft.remote_id.is_none() && draft.upload_revision.is_some() {
                continue;
            }
            if let Some(remote) = &draft.remote_id {
                // Recheck immediately before deletion. A changed Gmail draft is preserved.
                let value = api(
                    account,
                    reqwest::Method::GET,
                    &format!("drafts/{}?format=minimal", resource_id(remote)?),
                    None,
                )
                .await;
                match value {
                    Err(error) if error.missing => {
                        store::remove(app, &account.id, &draft.id)?;
                        continue;
                    }
                    Err(error) => {
                        store::status(
                            app,
                            &account.id,
                            &draft.id,
                            "deleting",
                            Some(&error.message),
                        )?;
                        continue;
                    }
                    Ok(value) if Some(version(&value)?) != draft.remote_version.as_deref() => {
                        store::detach(app, &account.id, &draft.id)?;
                        store::remove(app, &account.id, &draft.id)?;
                        continue;
                    }
                    _ => (),
                }
                if let Err(error) = api(
                    account,
                    reqwest::Method::DELETE,
                    &format!("drafts/{remote}"),
                    None,
                )
                .await
                {
                    if !error.missing {
                        store::status(
                            app,
                            &account.id,
                            &draft.id,
                            "deleting",
                            Some(&error.message),
                        )?;
                        continue;
                    }
                }
            }
            store::remove(app, &account.id, &draft.id)?;
            continue;
        }
        if !draft.dirty {
            continue;
        }
        if let Err(error) = upload(app, account, &draft).await {
            if !error.uncertain {
                store::db(app)?.execute("UPDATE compose_drafts SET upload_revision=NULL WHERE account_id=?1 AND id=?2",params![account.id,draft.id]).map_err(|e|e.to_string())?;
            }
            // Do not undo a discard which arrived during the HTTP request.
            if store::get(app, &account.id, &draft.id)?.state != "deleting" {
                store::status(
                    app,
                    &account.id,
                    &draft.id,
                    if error.uncertain {
                        "checking"
                    } else {
                        "queued"
                    },
                    Some(&error.message),
                )?;
            }
        }
    }
    changed(app, &account.id);
    if let Some(error) = import_error {
        return Err(error);
    }
    Ok(())
}
async fn upload(app: &AppHandle, account: &Account, draft: &Draft) -> Result<(), ApiError> {
    let local_error = |message: String| ApiError {
        message,
        uncertain: false,
        missing: false,
        forbidden: false,
    };
    let (raw, fingerprint) = mime(app, account, draft).map_err(local_error)?;
    let (method, path) = if let Some(remote) = &draft.remote_id {
        resource_id(remote).map_err(local_error)?;
        let current = api(
            account,
            reqwest::Method::GET,
            &format!("drafts/{remote}?format=minimal"),
            None,
        )
        .await?;
        if version(&current).map_err(local_error)? != draft.remote_version.as_deref().unwrap_or("")
        {
            return Err(local_error(
                "Gmail changed this draft. Refresh Drafts to preserve both versions.".into(),
            ));
        }
        (reqwest::Method::PUT, format!("drafts/{remote}"))
    } else {
        (reqwest::Method::POST, "drafts".into())
    };
    // Persist request identity before the network call. An uncertain create/update
    // is recovered by Message-ID instead of blindly creating duplicate drafts.
    store::db(app)
        .map_err(local_error)?
        .execute(
            "UPDATE compose_drafts SET upload_revision=?3,upload_fingerprint=?4 WHERE account_id=?1 AND id=?2",
            params![account.id, draft.id, draft.revision,fingerprint],
        )
        .map_err(|e| local_error(e.to_string()))?;
    let response = api(account, method, &path, Some(json!({"message":{"raw":raw}}))).await?;
    let id = response
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError {
            message: "Gmail saved the draft but returned no identity. Checking before retrying."
                .into(),
            uncertain: true,
            missing: false,
            forbidden: false,
        })?;
    let ver = version(&response).map_err(|message| ApiError {
        message,
        uncertain: true,
        missing: false,
        forbidden: false,
    })?;
    store::acknowledge(app, &account.id, &draft.id, draft.revision, id, ver).map_err(|message| {
        ApiError {
            message,
            uncertain: true,
            missing: false,
            forbidden: false,
        }
    })
}
pub async fn send(
    app: &AppHandle,
    account: &Account,
    id: &str,
    revision: i64,
) -> Result<String, String> {
    let _lock = SYNC_LOCK.lock().await;
    if let Some(receipt) = store::receipt(app, &account.id, id)? {
        return Ok(receipt);
    }
    let mut draft = store::get(app, &account.id, id)?;
    if draft.revision != revision {
        return Err("The draft changed. Review it before sending.".into());
    }
    if matches!(
        draft.state.as_str(),
        "send_unknown" | "sending" | "checking" | "deleting"
    ) {
        return Err(
            "Gmail has not confirmed the previous operation. Check Gmail before sending again."
                .into(),
        );
    }
    if draft.payload.to.is_empty()
        || !draft.payload.pending_to.trim().is_empty()
        || draft.payload.plain.trim().is_empty()
    {
        return Err("Add recipients and a message before sending.".into());
    }
    let claimed=store::db(app)?.execute("UPDATE compose_drafts SET state='sending',error=NULL WHERE account_id=?1 AND id=?2 AND revision=?3 AND state NOT IN ('sending','send_unknown','checking','deleting','needs_attachments','unsupported')",params![account.id,id,revision]).map_err(|e|e.to_string())?;
    if claimed != 1 {
        return Err("The draft changed or needs attention. Review it before sending.".into());
    }
    changed(app, &account.id);
    let mut sent_confirmed = false;
    let result=async {
    if draft.dirty{
        if let Err(error)=upload(app,account,&draft).await{
            if error.forbidden && draft.remote_id.is_none() && !error.uncertain {
                // API configuration must not break the existing SMTP send path.
                // This fallback is only safe for a wholly local draft whose
                // Gmail create was definitively rejected, never an uncertain upload.
                let mut sender=account.clone();
                let result=crate::mail::smtp_client::send_email(app,&mut sender,draft.payload.to.clone(),addresses(&draft.payload.cc)?,addresses(&draft.payload.bcc)?,None,
                    &draft.payload.subject,&draft.payload.plain,&draft.payload.html,store::files(app,&account.id,&draft)?,Some(marker(&draft))).await;
                match result {
                    Ok(message)=>{sent_confirmed=true;store::sent(app,&account.id,&draft)?;return Ok(message)},
                    Err(_)=>{let message="SMTP did not confirm sending. Check Sent before attempting another send.";
                        store::status(app,&account.id,id,"send_unknown",Some(message))?;return Err(message.into())}
                }
            }
            if !error.uncertain{store::db(app)?.execute("UPDATE compose_drafts SET upload_revision=NULL WHERE account_id=?1 AND id=?2",params![account.id,id]).map_err(|e|e.to_string())?;}
            store::status(app,&account.id,id,if error.uncertain{"checking"}else{"queued"},Some(&error.message))?;return Err(error.message)
        }
        draft=store::get(app,&account.id,id)?;
    }
    let remote=draft.remote_id.as_ref().ok_or("Draft is not synced yet")?;
    let current=api(account,reqwest::Method::GET,&format!("drafts/{}?format=minimal",resource_id(remote)?),None).await.map_err(|e|e.message)?;
    if version(&current)?!=draft.remote_version.as_deref().unwrap_or(""){return Err("Gmail changed this draft. Reopen Drafts and review both versions before sending.".into())}
    // Send the reviewed local snapshot, even if another Gmail editor changes
    // the container between our version check and the send request.
    let (reviewed,_)=mime(app,account,&draft)?;
    match api(account,reqwest::Method::POST,"drafts/send",Some(json!({"id":remote,"message":{"raw":reviewed}}))).await{
        Ok(value)=>{
            sent_confirmed=true;
            if value.get("id").and_then(Value::as_str).is_none(){
                let message="Gmail may have sent this message. Check Sent before attempting another send.";
                store::status(app,&account.id,id,"send_unknown",Some(message))?;return Err(message.into())
            }
            let message=marker(&draft);
            store::sent(app,&account.id,&draft)?;changed(app,&account.id);
            let mut recipients=draft.payload.to.clone();recipients.extend(addresses(&draft.payload.cc).unwrap_or_default());recipients.extend(addresses(&draft.payload.bcc).unwrap_or_default());
            let _=crate::contacts::contact_indexer::record_sent_emails(app,recipients);Ok(message)},
        Err(error)=>{let uncertain=error.uncertain||error.missing;let message=if uncertain{"Gmail may have sent this message. Check Sent before attempting another send.".to_string()}else{error.message};
            store::status(app,&account.id,id,if uncertain{"send_unknown"}else{"synced"},Some(&message))?;changed(app,&account.id);Err(message)}
    }
    }.await;
    if let Err(error) = &result {
        // Pre-send validation/network errors are safe to retry. A POST with an
        // uncertain outcome has already set send_unknown and is never retried.
        if let Ok(current) = store::get(app, &account.id, id) {
            if current.state == "sending" {
                store::status(
                    app,
                    &account.id,
                    id,
                    if sent_confirmed {
                        "send_unknown"
                    } else if current.dirty {
                        "queued"
                    } else {
                        "synced"
                    },
                    Some(error),
                )?;
            }
        }
    }
    changed(app, &account.id);
    result
}
