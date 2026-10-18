//! Reconcile cached UIDs only, using bounded explicit UID FETCH batches. A tagged
//! successful FETCH may omit expunged UIDs. Never prune after a partial scan.
use super::{database, message_actions::MUTATION_LOCK};
use rusqlite::{params, Connection, TransactionBehavior};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Emitter};

pub const INTERVAL_SECONDS: i64 = 300;
const BATCH_SIZE: usize = 200;

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Flags {
    pub uid: u32,
    pub seen: bool,
    pub flagged: bool,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct Changes {
    pub updated: usize,
    pub removed: usize,
    pub conflicts: Vec<u32>,
    pub updated_flags: Vec<Flags>,
    pub removed_uids: Vec<u32>,
}

pub fn is_due(last_scan: i64, now: i64, force: bool) -> bool {
    force || last_scan == 0 || now < last_scan || now.saturating_sub(last_scan) >= INTERVAL_SECONDS
}

pub fn reconcile(
    app: &AppHandle,
    account: &str,
    folder: &str,
    mailbox: &str,
    validity: u32,
    session: &mut imap::Session<native_tls::TlsStream<std::net::TcpStream>>,
    deadline: std::time::Instant,
) -> Result<Changes, String> {
    // Message actions use the same lock, preventing a snapshot taken before an
    // action from overwriting its confirmed result during the final commit.
    let _mutation = MUTATION_LOCK.blocking_lock();
    if std::time::Instant::now() >= deadline {
        return Err("Reconciliation timed out; cache was preserved".into());
    }
    let mut conn = database::open_connection(app)?;
    let cached: Vec<u32> = {
        let mut stmt = conn.prepare("SELECT uid FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid_validity = ?3 ORDER BY uid").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![account, folder, validity], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?
    };
    let remote = collect_batches(&cached, |batch| {
        if std::time::Instant::now() >= deadline {
            return Err("Reconciliation timed out; cache was preserved".into());
        }
        let range = batch
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let results = session
            .uid_fetch(range, "(UID FLAGS)")
            .map_err(|e| format!("Reconciliation flag scan failed: {e}"))?;
        let mut flags = Vec::new();
        for message in results.iter() {
            let uid = message
                .uid
                .ok_or("Reconciliation received a FETCH without UID")?;
            // Ignore unrelated unsolicited flag updates; only scan requested UIDs.
            if batch.binary_search(&uid).is_err() {
                continue;
            }
            flags.push(Flags {
                uid,
                seen: message
                    .flags()
                    .iter()
                    .any(|f| matches!(f, imap::types::Flag::Seen)),
                flagged: message
                    .flags()
                    .iter()
                    .any(|f| matches!(f, imap::types::Flag::Flagged)),
            });
        }
        Ok(flags)
    })?;
    // A mailbox epoch change invalidates every UID. Do not apply this snapshot.
    let final_mailbox = session
        .examine(mailbox)
        .map_err(|e| format!("Could not validate reconciliation mailbox: {e}"))?;
    if final_mailbox.uid_validity != Some(validity) {
        return Err(
            "Mailbox UIDVALIDITY changed during reconciliation; cache was preserved. Retry sync."
                .into(),
        );
    }
    let now = chrono::Utc::now().timestamp();
    if std::time::Instant::now() >= deadline {
        return Err("Reconciliation timed out; cache was preserved".into());
    }
    let changes = apply_snapshot(
        &mut conn, account, folder, mailbox, validity, &cached, &remote, now,
    )?;
    if changes.updated > 0 || changes.removed > 0 {
        super::search::SEARCH_CACHE.retain(|_, entry| {
            entry.account_id != account
                || (entry.folder != folder && entry.folder != "all" && entry.folder != "starred")
        });
        let _ = app.emit("mail:reconciled", serde_json::json!({"account_id":account,"folder":folder,"updated_flags":changes.updated_flags,"removed_uids":changes.removed_uids}));
    }
    if !changes.conflicts.is_empty() {
        let _ = app.emit("mail:action_conflict", serde_json::json!({ "account_id": account, "folder": folder, "uids": changes.conflicts,
            "error": format!("{} queued message action(s) could not be applied because the messages were removed at the provider.", changes.conflicts.len()) }));
    }
    log::info!(
        "Reconciled account {} folder {}: {} flags changed, {} removed, {} conflicts",
        account,
        folder,
        changes.updated,
        changes.removed,
        changes.conflicts.len()
    );
    Ok(changes)
}

fn collect_batches(
    cached: &[u32],
    mut fetch: impl FnMut(&[u32]) -> Result<Vec<Flags>, String>,
) -> Result<Vec<Flags>, String> {
    let mut remote = Vec::with_capacity(cached.len());
    for batch in cached.chunks(BATCH_SIZE) {
        remote.extend(fetch(batch)?);
    }
    Ok(remote)
}

fn apply_snapshot(
    conn: &mut Connection,
    account: &str,
    folder: &str,
    mailbox: &str,
    validity: u32,
    cached: &[u32],
    remote: &[Flags],
    now: i64,
) -> Result<Changes, String> {
    let cached_set: HashSet<_> = cached.iter().copied().collect();
    if cached_set.len() != cached.len() {
        return Err("Duplicate UID in reconciliation snapshot".into());
    }
    let mut flags = HashMap::new();
    for entry in remote {
        if !cached_set.contains(&entry.uid) || flags.insert(entry.uid, entry).is_some() {
            return Err("Invalid or duplicate UID in reconciliation response".into());
        }
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current: u32 = tx
        .query_row(
            "SELECT uid_validity FROM mailbox_state WHERE account_id = ?1 AND mailbox = ?2",
            params![account, mailbox],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if current != validity {
        return Err("Cached mailbox epoch changed; reconciliation was not committed".into());
    }
    let mut changes = Changes::default();
    for uid in cached {
        if let Some(remote) = flags.get(uid) {
            let updated = tx.execute("UPDATE messages SET seen = ?1, flagged = ?2
                WHERE account_id = ?3 AND folder = ?4 AND uid = ?5 AND uid_validity = ?6
                AND (seen != ?1 OR flagged != ?2)
                AND NOT EXISTS (SELECT 1 FROM pending_message_actions p WHERE p.account_id = ?3 AND p.folder = ?4 AND p.uid = ?5 AND (p.last_error IS NULL OR p.last_error NOT LIKE 'CONFLICT:%'))",
                params![remote.seen, remote.flagged, account, folder, uid, validity]).map_err(|e| e.to_string())?;
            changes.updated += updated;
            if updated > 0 {
                changes.updated_flags.push(**remote);
            }
        } else {
            // A delete already confirmed by the provider is complete. Other queued
            // actions now have an explicit conflict rather than retrying forever.
            tx.execute("DELETE FROM pending_message_actions WHERE account_id = ?1 AND folder = ?2 AND uid = ?3 AND action = 'delete'",
                params![account, folder, uid]).map_err(|e| e.to_string())?;
            let conflicts = tx.execute("UPDATE pending_message_actions SET last_error = 'CONFLICT: Message was removed at the provider'
                WHERE account_id = ?1 AND folder = ?2 AND uid = ?3 AND (last_error IS NULL OR last_error NOT LIKE 'CONFLICT:%')",
                params![account, folder, uid]).map_err(|e| e.to_string())?;
            if conflicts > 0 {
                changes.conflicts.push(*uid);
            }
            let removed = tx.execute("DELETE FROM messages WHERE account_id = ?1 AND folder = ?2 AND uid = ?3 AND uid_validity = ?4",
                params![account, folder, uid, validity]).map_err(|e| e.to_string())?;
            changes.removed += removed;
            if removed > 0 {
                changes.removed_uids.push(*uid);
            }
        }
    }
    tx.execute(
        "UPDATE folder_sync_state SET last_full_sync_at = ?1 WHERE account_id = ?2 AND folder = ?3",
        params![now, account, folder],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_later_batch_cannot_prune_from_an_incomplete_snapshot() {
        let mut conn = fixture();
        let cached: Vec<u32> = (1..=201).collect();
        let mut calls = 0;
        let result = collect_batches(&cached, |_| {
            calls += 1;
            if calls == 2 {
                Err("simulated connection loss".into())
            } else {
                Ok(vec![Flags {
                    uid: 1,
                    seen: true,
                    flagged: true,
                }])
            }
        })
        .and_then(|remote| {
            apply_snapshot(&mut conn, "a", "inbox", "INBOX", 9, &cached, &remote, 123)
        });
        assert!(result.is_err());
        assert_eq!(calls, 2);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            conn.query_row("SELECT last_full_sync_at FROM folder_sync_state", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE messages(account_id TEXT, folder TEXT, uid INTEGER, uid_validity INTEGER, seen INTEGER, flagged INTEGER, body TEXT, PRIMARY KEY(account_id,folder,uid));
            CREATE TABLE mailbox_state(account_id TEXT, mailbox TEXT, uid_validity INTEGER);
            CREATE TABLE folder_sync_state(account_id TEXT,folder TEXT,last_full_sync_at INTEGER);
            CREATE TABLE pending_message_actions(account_id TEXT,folder TEXT,uid INTEGER,action TEXT,last_error TEXT);
            CREATE TABLE message_tags(account_id TEXT,folder TEXT,uid INTEGER, FOREIGN KEY(account_id,folder,uid) REFERENCES messages(account_id,folder,uid) ON DELETE CASCADE);
            INSERT INTO mailbox_state VALUES ('a','INBOX',9);
            INSERT INTO folder_sync_state VALUES ('a','inbox',0);
            INSERT INTO messages VALUES ('a','inbox',1,9,0,0,'cached body'),('a','inbox',2,9,0,0,'deleted'),('b','inbox',2,9,0,0,'other account'),('a','sent',2,9,0,0,'other folder');
            INSERT INTO message_tags VALUES ('a','inbox',2);").unwrap();
        conn
    }
    #[test]
    fn updates_flags_preserves_bodies_and_only_removes_scanned_account_folder() {
        let mut conn = fixture();
        let result = apply_snapshot(
            &mut conn,
            "a",
            "inbox",
            "INBOX",
            9,
            &[1, 2],
            &[Flags {
                uid: 1,
                seen: true,
                flagged: true,
            }],
            123,
        )
        .unwrap();
        assert_eq!((result.updated, result.removed), (1, 1));
        assert_eq!(
            conn.query_row(
                "SELECT body FROM messages WHERE account_id='a' AND folder='inbox'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "cached body"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM message_tags", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT last_full_sync_at FROM folder_sync_state", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            123
        );
    }
    #[test]
    fn invalid_epoch_or_snapshot_never_prunes_or_advances_watermark() {
        let mut conn = fixture();
        assert!(apply_snapshot(&mut conn, "a", "inbox", "INBOX", 10, &[1, 2], &[], 123).is_err());
        assert!(apply_snapshot(
            &mut conn,
            "a",
            "inbox",
            "INBOX",
            9,
            &[1, 2],
            &[Flags {
                uid: 99,
                seen: true,
                flagged: false
            }],
            123
        )
        .is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            conn.query_row("SELECT last_full_sync_at FROM folder_sync_state", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn pending_intent_is_preserved_and_missing_message_becomes_conflict() {
        let mut conn = fixture();
        conn.execute_batch("INSERT INTO pending_message_actions VALUES ('a','inbox',1,'seen',NULL),('a','inbox',2,'flagged',NULL);").unwrap();
        let result = apply_snapshot(
            &mut conn,
            "a",
            "inbox",
            "INBOX",
            9,
            &[1, 2],
            &[Flags {
                uid: 1,
                seen: true,
                flagged: false,
            }],
            123,
        )
        .unwrap();
        assert_eq!(result.updated, 0);
        assert_eq!(result.conflicts, vec![2]);
        let error: String = conn
            .query_row(
                "SELECT last_error FROM pending_message_actions WHERE uid=2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(error.starts_with("CONFLICT:"));
    }
    #[test]
    fn manual_refresh_bypasses_reconciliation_interval() {
        assert!(!is_due(100, 101, false));
        assert!(is_due(100, 101, true));
        assert!(is_due(100, 400, false));
    }
    #[test]
    fn database_failure_rolls_back_flags_deletions_and_watermark() {
        let mut conn = fixture();
        conn.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(FAIL,'simulated write failure'); END;").unwrap();
        assert!(apply_snapshot(
            &mut conn,
            "a",
            "inbox",
            "INBOX",
            9,
            &[1, 2],
            &[Flags {
                uid: 1,
                seen: true,
                flagged: true
            }],
            123
        )
        .is_err());
        assert_eq!(
            conn.query_row(
                "SELECT seen FROM messages WHERE account_id='a' AND folder='inbox' AND uid=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert_eq!(
            conn.query_row("SELECT last_full_sync_at FROM folder_sync_state", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn successful_empty_remote_snapshot_removes_only_this_folder() {
        let mut conn = fixture();
        let result =
            apply_snapshot(&mut conn, "a", "inbox", "INBOX", 9, &[1, 2], &[], 123).unwrap();
        assert_eq!(result.removed, 2);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
