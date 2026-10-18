use crate::mail::database;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeSet;
use tauri::AppHandle;

#[derive(Clone)]
struct CopyKey {
    folder: String,
    uid: u32,
}

fn copies(
    tx: &Transaction<'_>,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
) -> Result<Vec<CopyKey>, String> {
    let identity = tx.query_row("SELECT message_id,date,sender,subject,uid_validity FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3", params![account,folder,uid], |r| {
        Ok((r.get::<_, Option<String>>(0)?,r.get::<_, i64>(1)?,r.get::<_, String>(2)?,r.get::<_, String>(3)?,r.get::<_, u32>(4)?))
    }).optional().map_err(|e| e.to_string())?;
    let Some((id, date, sender, subject, epoch)) = identity else {
        return Ok(Vec::new());
    };
    if epoch != validity {
        return Err("Mailbox identity changed while updating tags".into());
    }
    let mut stmt = tx.prepare("SELECT folder,uid FROM messages WHERE account_id=?1 AND ((folder=?2 AND uid=?3) OR (NULLIF(message_id,'')=?4 AND date=?5 AND sender=?6 AND subject=?7))").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![account, folder, uid, id, date, sender, subject],
            |r| {
                Ok(CopyKey {
                    folder: r.get(0)?,
                    uid: r.get(1)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

fn tags(tx: &Transaction<'_>, account: &str, key: &CopyKey) -> Result<BTreeSet<String>, String> {
    let mut stmt = tx
        .prepare(
            "SELECT tag_id FROM message_tags WHERE account_id=?1 AND folder=?2 AND message_uid=?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![account, key.folder, key.uid], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

fn write_delta(
    tx: &Transaction<'_>,
    account: &str,
    keys: &[CopyKey],
    added: &[String],
    removed: &[String],
) -> Result<bool, String> {
    let mut changed = 0;
    for key in keys {
        for id in removed {
            changed+=tx.execute("DELETE FROM message_tags WHERE account_id=?1 AND folder=?2 AND message_uid=?3 AND tag_id=?4",params![account,key.folder,key.uid,id]).map_err(|e|e.to_string())?;
        }
        for id in added {
            changed+=tx.execute("INSERT OR IGNORE INTO message_tags(account_id,folder,message_uid,tag_id) VALUES(?1,?2,?3,?4)",params![account,key.folder,key.uid,id]).map_err(|e|e.to_string())?;
        }
        if key
            .folder
            .strip_prefix("tag:")
            .is_some_and(|own| removed.iter().any(|id| id == own))
        {
            // This UID no longer belongs to its label mailbox. Other cached
            // copies keep their own valid identities and bodies.
            changed += tx
                .execute(
                    "DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
                    params![account, key.folder, key.uid],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(changed > 0)
}

pub fn apply_delta(
    app: &AppHandle,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
    message_id: Option<&str>,
    added: &[String],
    removed: &[String],
) -> Result<Vec<String>, String> {
    let mut conn = database::open_connection(app)?;
    apply_delta_conn(
        &mut conn, account, folder, uid, validity, message_id, added, removed,
    )
}

fn apply_delta_conn(
    conn: &mut Connection,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
    message_id: Option<&str>,
    added: &[String],
    removed: &[String],
) -> Result<Vec<String>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let updated=tx.execute("UPDATE messages SET message_id=COALESCE(?4,message_id) WHERE account_id=?1 AND folder=?2 AND uid=?3 AND uid_validity=?5",params![account,folder,uid,message_id,validity]).map_err(|e|e.to_string())?;
    if updated != 1 {
        return Err("Message changed while saving tags. Refresh and retry.".into());
    }
    let keys = copies(&tx, account, folder, uid, validity)?;
    let mut assigned = BTreeSet::new();
    for key in &keys {
        assigned.extend(tags(&tx, account, key)?);
    }
    if let Some(own) = folder.strip_prefix("tag:") {
        assigned.insert(own.into());
    }
    assigned.extend(added.iter().cloned());
    for id in removed {
        assigned.remove(id);
    }
    write_delta(&tx, account, &keys, added, removed)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(assigned.into_iter().collect())
}

pub fn apply_snapshot(
    app: &AppHandle,
    account: &str,
    folder: &str,
    validity: u32,
    batch: &[(u32, Vec<String>)],
    missing: &[u32],
) -> Result<bool, String> {
    let mut conn = database::open_connection(app)?;
    apply_snapshot_conn(&mut conn, account, folder, validity, batch, missing)
}

pub fn apply_metadata(
    app: &AppHandle,
    account: &str,
    folder: &str,
    validity: u32,
    metadata: &[(u32, Option<String>, bool, bool)],
) -> Result<bool, String> {
    let mut conn = database::open_connection(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut changed = 0;
    for (uid, id, seen, starred) in metadata {
        if let Some(id) = id {
            changed+=tx.execute("UPDATE messages SET message_id=?4 WHERE account_id=?1 AND folder=?2 AND uid=?3 AND uid_validity=?5 AND (message_id IS NULL OR message_id='')",params![account,folder,uid,id,validity]).map_err(|e|e.to_string())?;
        }
        for key in copies(&tx, account, folder, *uid, validity)? {
            changed+=tx.execute("UPDATE messages SET seen=?4,flagged=?5 WHERE account_id=?1 AND folder=?2 AND uid=?3 AND (seen!=?4 OR flagged!=?5) AND NOT EXISTS(SELECT 1 FROM pending_message_actions p WHERE p.account_id=?1 AND p.folder=?2 AND p.uid=?3 AND p.action IN('seen','flagged') AND (p.last_error IS NULL OR p.last_error NOT LIKE 'CONFLICT:%'))",params![account,key.folder,key.uid,seen,starred]).map_err(|e|e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

pub fn apply_message_action(
    app: &AppHandle,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
    action: &str,
    desired: Option<bool>,
) -> Result<(), String> {
    let mut conn = database::open_connection(app)?;
    apply_message_action_conn(&mut conn, account, folder, uid, validity, action, desired)
}
fn apply_message_action_conn(
    conn: &mut Connection,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
    action: &str,
    desired: Option<bool>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let keys = copies(&tx, account, folder, uid, validity)?;
    for key in keys {
        let sql = match action {
            "seen" => "UPDATE messages SET seen=?4 WHERE account_id=?1 AND folder=?2 AND uid=?3",
            "flagged" => {
                "UPDATE messages SET flagged=?4 WHERE account_id=?1 AND folder=?2 AND uid=?3"
            }
            "delete" => "DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3",
            _ => return Err("Unknown message action".into()),
        };
        if action == "delete" {
            tx.execute(sql, params![account, key.folder, key.uid])
                .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                sql,
                params![
                    account,
                    key.folder,
                    key.uid,
                    desired.ok_or("Missing flag value")?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn supersede_flags_in_tx(
    tx: &Transaction<'_>,
    account: &str,
    folder: &str,
    uid: u32,
    validity: u32,
    action: &str,
) -> Result<(), String> {
    if !matches!(action, "seen" | "flagged") {
        return Ok(());
    }
    for key in copies(tx, account, folder, uid, validity)? {
        tx.execute("DELETE FROM pending_message_actions WHERE account_id=?1 AND folder=?2 AND uid=?3 AND action=?4",params![account,key.folder,key.uid,action]).map_err(|e|e.to_string())?;
    }
    Ok(())
}

fn apply_snapshot_conn(
    conn: &mut Connection,
    account: &str,
    folder: &str,
    validity: u32,
    batch: &[(u32, Vec<String>)],
    missing: &[u32],
) -> Result<bool, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let user_ids: BTreeSet<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM tags WHERE account_id=?1 AND type='user'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([account], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?
    };
    let mut changed = false;
    for (uid, assigned) in batch {
        let keys = copies(&tx, account, folder, *uid, validity)?;
        let wanted: BTreeSet<_> = assigned
            .iter()
            .filter(|id| user_ids.contains(*id))
            .cloned()
            .collect();
        for key in &keys {
            let existing = tags(&tx, account, key)?;
            let mut removed: Vec<_> = existing
                .intersection(&user_ids)
                .filter(|id| !wanted.contains(*id))
                .cloned()
                .collect();
            if let Some(own) = key.folder.strip_prefix("tag:") {
                if user_ids.contains(own)
                    && !wanted.contains(own)
                    && !removed.iter().any(|id| id == own)
                {
                    removed.push(own.into());
                }
            }
            let added: Vec<_> = wanted.difference(&existing).cloned().collect();
            changed |= write_delta(&tx, account, std::slice::from_ref(key), &added, &removed)?;
        }
    }
    for uid in missing {
        let keys = copies(&tx, account, folder, *uid, validity)?;
        if let Some(own) = folder.strip_prefix("tag:") {
            changed |= write_delta(&tx, account, &keys, &[], &[own.into()])?;
        }
        changed|=tx.execute("DELETE FROM messages WHERE account_id=?1 AND folder=?2 AND uid=?3 AND uid_validity=?4",params![account,folder,uid,validity]).map_err(|e|e.to_string())?>0;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,uid_validity INTEGER DEFAULT 9,message_id TEXT,date INTEGER DEFAULT 1,sender TEXT DEFAULT 'sender',subject TEXT DEFAULT 'subject',seen INTEGER DEFAULT 0,flagged INTEGER DEFAULT 1,PRIMARY KEY(account_id,folder,uid));CREATE TABLE tags(account_id TEXT,id TEXT,type TEXT);CREATE TABLE pending_message_actions(account_id TEXT,folder TEXT,uid INTEGER,action TEXT,last_error TEXT);CREATE TABLE message_tags(account_id TEXT,folder TEXT,message_uid INTEGER,tag_id TEXT,PRIMARY KEY(account_id,folder,message_uid,tag_id),FOREIGN KEY(account_id,folder,message_uid) REFERENCES messages(account_id,folder,uid) ON DELETE CASCADE);
        INSERT INTO tags VALUES('a','paper','user'),('a','work','user');INSERT INTO messages(account_id,folder,uid,message_id) VALUES('a','inbox',1,'same'),('a','tag:paper',8,'same'),('b','inbox',1,'same');INSERT INTO message_tags VALUES('a','inbox',1,'paper'),('a','tag:paper',8,'paper'),('b','inbox',1,'paper');").unwrap();
        conn
    }
    #[test]
    fn removing_label_updates_copies_without_deleting_inbox_or_other_account() {
        let mut c = fixture();
        let assigned = apply_delta_conn(
            &mut c,
            "a",
            "tag:paper",
            8,
            9,
            Some("same"),
            &["work".into()],
            &["paper".into()],
        )
        .unwrap();
        assert_eq!(assigned, vec!["work"]);
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            c.query_row(
                "SELECT tag_id FROM message_tags WHERE account_id='a'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "work"
        );
        assert_eq!(
            c.query_row(
                "SELECT tag_id FROM message_tags WHERE account_id='b'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "paper"
        );
    }
    #[test]
    fn authoritative_empty_labels_remove_stale_membership_and_source_label_copy() {
        let mut c = fixture();
        assert!(apply_snapshot_conn(&mut c, "a", "inbox", 9, &[(1, vec![])], &[]).unwrap());
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM message_tags WHERE account_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert!(!apply_snapshot_conn(&mut c, "a", "inbox", 9, &[(1, vec![])], &[]).unwrap());
    }
    #[test]
    fn epoch_conflict_rolls_back_and_reused_message_id_does_not_cross_content() {
        let mut c = fixture();
        assert!(
            apply_delta_conn(&mut c, "a", "inbox", 1, 10, None, &[], &["paper".into()]).is_err()
        );
        c.execute(
            "UPDATE messages SET subject='different' WHERE folder='tag:paper'",
            [],
        )
        .unwrap();
        apply_delta_conn(&mut c, "a", "inbox", 1, 9, None, &[], &["paper".into()]).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM message_tags WHERE account_id='a' AND folder='tag:paper'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn confirmed_flags_update_every_cached_copy_and_keep_other_accounts_isolated() {
        let mut c = fixture();
        apply_message_action_conn(&mut c, "a", "inbox", 1, 9, "flagged", Some(false)).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT SUM(flagged) FROM messages WHERE account_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            c.query_row(
                "SELECT flagged FROM messages WHERE account_id='b'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        apply_message_action_conn(&mut c, "a", "tag:paper", 8, 9, "delete", None).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM messages WHERE account_id='a'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
    #[test]
    fn a_missing_label_uid_clears_only_that_label_and_keeps_other_memberships() {
        let mut c = fixture();
        c.execute("INSERT INTO message_tags VALUES('a','inbox',1,'work')", [])
            .unwrap();
        assert!(apply_snapshot_conn(&mut c, "a", "tag:paper", 9, &[], &[8]).unwrap());
        assert_eq!(
            c.query_row(
                "SELECT tag_id FROM message_tags WHERE account_id='a'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "work"
        );
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM messages WHERE account_id='a' AND folder='inbox'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn superseding_alias_intent_is_rolled_back_if_replacement_fails() {
        let mut c = fixture();
        c.execute_batch("INSERT INTO pending_message_actions VALUES('a','inbox',1,'seen',NULL),('a','tag:paper',8,'seen',NULL),('b','inbox',1,'seen',NULL);").unwrap();
        {
            let tx = c.transaction().unwrap();
            supersede_flags_in_tx(&tx, "a", "inbox", 1, 9, "seen").unwrap();
            assert_eq!(
                tx.query_row("SELECT COUNT(*) FROM pending_message_actions", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert!(tx
                .execute("INSERT INTO missing_table VALUES(1)", [])
                .is_err());
        }
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM pending_message_actions", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
}
