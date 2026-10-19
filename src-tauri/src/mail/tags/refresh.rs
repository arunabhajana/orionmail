use crate::auth::account::{Account, MailProvider};
use crate::mail::{
    database,
    imap_session::{execute_with_session, SessionKind},
    message_actions,
};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Deserialize)]
pub struct LabelTarget {
    pub folder: String,
    pub uid: u32,
}
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn visible(
    app: &AppHandle,
    account: &Account,
    requests: Vec<LabelTarget>,
) -> Result<(), String> {
    if !matches!(account.provider, MailProvider::Google)
        || crate::mail_preferences::load(app).sync_paused
    {
        return Ok(());
    }
    if requests.len() > 100 {
        return Err("Too many visible messages".into());
    }
    let Ok(_refresh) = REFRESH_LOCK.try_lock() else {
        return Ok(());
    };
    let state = database::get_global_sync_state(app, &account.id)?;
    if state.last_tag_sync_at.unwrap_or(0) + 60 < chrono::Utc::now().timestamp() {
        crate::mail::tags::sync_tags(app, account).await?;
    }
    let available = database::get_all_tags(app, &account.id)?;
    let labels = available
        .iter()
        .filter(|tag| tag.tag_type == "user")
        .map(|tag| Ok((tag.id.clone(), super::assignment::quote_label(&tag.name)?)))
        .collect::<Result<Vec<_>, String>>()?;
    let mut groups: BTreeMap<String, BTreeSet<u32>> = BTreeMap::new();
    for request in requests {
        if request.uid > 0 {
            groups
                .entry(request.folder)
                .or_default()
                .insert(request.uid);
        }
    }
    let mut changed = false;
    for (folder, uids) in groups {
        let cached = database::get_messages_by_uids(
            app,
            &account.id,
            &folder,
            &uids.iter().copied().collect::<Vec<_>>(),
        )?;
        let Some(first) = cached.first() else {
            continue;
        };
        let validity = first.uid_validity;
        let cached_uids: BTreeSet<_> = cached
            .iter()
            .filter(|m| m.uid_validity == validity)
            .map(|m| m.uid)
            .collect();
        let range = cached_uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mailbox = message_actions::resolve_mailbox(app, account, &folder)?;
        let labels = labels.clone();
        let fetch_fields=if cached.iter().all(|message|message.message_id.as_ref().is_some_and(|id|!id.is_empty())) {
            "(UID FLAGS)"
        } else { "(UID FLAGS BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])" };
        let generation = super::assignment::LABEL_GENERATION.load(Ordering::SeqCst);
        let (batch, missing, metadata) =
            execute_with_session(account, SessionKind::Labels, move |session| {
                let selected = session.select(&mailbox).map_err(|e| e.to_string())?;
                if selected.uid_validity != Some(validity) {
                    return Err("Mailbox changed during visible mail refresh".into());
                }
                let fetched = session
                    .uid_fetch(&range, fetch_fields)
                    .map_err(|e| e.to_string())?;
                let metadata = fetched
                    .iter()
                    .filter_map(|message| {
                        let uid = message.uid?;
                        if !cached_uids.contains(&uid) {
                            return None;
                        }
                        let id = message
                            .header()
                            .and_then(|bytes| mailparse::parse_mail(bytes).ok())
                            .and_then(|mail| {
                                use mailparse::MailHeaderMap;
                                mail.headers.get_first_value("Message-ID")
                            });
                        let seen = message
                            .flags()
                            .iter()
                            .any(|f| matches!(f, imap::types::Flag::Seen));
                        let starred = message
                            .flags()
                            .iter()
                            .any(|f| matches!(f, imap::types::Flag::Flagged));
                        Some((uid, id, seen, starred))
                    })
                    .collect::<Vec<_>>();
                let batch = super::assignment::fetch_memberships(session, &range, &labels)?;
                let existing: BTreeSet<_> = batch.iter().map(|(uid, _)| *uid).collect();
                let missing = cached_uids
                    .difference(&existing)
                    .copied()
                    .collect::<Vec<_>>();
                if session
                    .examine(&mailbox)
                    .map_err(|e| e.to_string())?
                    .uid_validity
                    != Some(validity)
                {
                    return Err("Mailbox changed during visible mail refresh".into());
                }
                Ok((batch, missing, metadata))
            })
            .await?;
        let _mutation = message_actions::MUTATION_LOCK.lock().await;
        if super::assignment::LABEL_GENERATION.load(Ordering::SeqCst) != generation {
            continue;
        }
        changed |= super::cache::apply_metadata(app, &account.id, &folder, validity, &metadata)?;
        changed |=
            super::cache::apply_snapshot(app, &account.id, &folder, validity, &batch, &missing)?;
    }
    if changed {
        crate::mail::notifications::schedule_refresh(app,&account.id);
        let _ = app.emit("mail:labels_changed", &account.id);
    }
    Ok(())
}
