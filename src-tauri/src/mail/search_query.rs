//! A bounded search language shared by local mailbox and unified searches.
//! Renderer text is always bound data, never executable SQL or FTS syntax.
use super::message_list::MessageHeader;
use rusqlite::{params_from_iter, types::Value, Connection};

#[derive(Clone, Debug)]
pub struct Term {
    pub field: String,
    pub value: String,
    pub negative: bool,
    pub phrase: bool,
}
pub fn parse(query: &str) -> Result<Vec<Term>, String> {
    if query.len() > 2048 || query.chars().any(char::is_control) {
        return Err("Search supports up to 2,048 bytes without control characters.".into());
    }
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quoted = false;
    let mut escaped = false;
    for ch in query.chars() {
        if escaped {
            token.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && quoted {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
            token.push(ch);
            continue;
        }
        if ch.is_whitespace() && !quoted {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
        } else {
            token.push(ch);
        }
    }
    if quoted || escaped {
        return Err("Close the quotation marks to search a phrase.".into());
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    if tokens.len() > 32 {
        return Err("Use up to 32 search terms and filters.".into());
    }
    tokens.into_iter().map(|token|{
        let negative=token.starts_with('-');let raw=if negative{&token[1..]}else{&token};
        let (field,value)=if !raw.starts_with('"')&&!raw.contains("://"){raw.split_once(':').unwrap_or(("",raw))}else{("",raw)};
        let field=field.to_ascii_lowercase();let phrase=value.starts_with('"');let value=value.trim_matches('"').to_string();
        if value.is_empty(){return Err("Add a value after each search filter.".into());}
        if !["","from","to","subject","body","filename","tag","is","has","after","before","in"].contains(&field.as_str()){return Err(format!("Unknown filter {field}:. Use from:, to:, subject:, tag:, is:, has:, after:, before: or in:."));}
        Ok(Term{field,value,negative,phrase})
    }).collect()
}
pub struct Compiled {
    pub sql: String,
    pub values: Vec<Value>,
    pub overrides_folder: bool,
}
pub fn gmail_query(query: &str) -> String {
    let Ok(terms) = parse(query) else {
        return query.into();
    };
    terms
        .into_iter()
        .map(|term| {
            let mut value = term.value;
            if matches!(term.field.as_str(), "after" | "before") {
                if let Ok(date) = chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d") {
                    // Gmail date strings use PST. Unix seconds preserve our UTC days.
                    // https://developers.google.com/workspace/gmail/api/guides/filtering
                    let seconds = date.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp();
                    value = (if term.field == "after" {
                        seconds.saturating_sub(1)
                    } else {
                        seconds
                    })
                    .to_string();
                }
            } else if term.phrase {
                value = format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
            }
            format!(
                "{}{}{}",
                if term.negative { "-" } else { "" },
                if term.field.is_empty() {
                    String::new()
                } else {
                    format!("{}:", term.field)
                },
                value
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}
fn bind(values: &mut Vec<Value>, start: usize, value: impl Into<Value>) -> String {
    values.push(value.into());
    format!("?{}", start + values.len() - 1)
}
fn fts(value: &str, phrase: bool, column: &str) -> Result<String, String> {
    let words = value
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .take(64)
        .collect::<Vec<_>>();
    if words.is_empty() {
        return Err("Add a word or a search filter.".into());
    }
    let text = if phrase {
        format!("\"{}\"", words.join(" "))
    } else {
        words
            .iter()
            .map(|word| format!("\"{word}\"*"))
            .collect::<Vec<_>>()
            .join(" AND ")
    };
    Ok(if column.is_empty() {
        format!("({text})")
    } else {
        format!("{column} : ({text})")
    })
}
pub fn compile(query: &str, folder: &str, start: usize) -> Result<Compiled, String> {
    let terms = parse(query)?;
    let mut values = Vec::new();
    let mut conditions = Vec::new();
    let overrides_folder = terms
        .iter()
        .any(|term| term.field == "in" && !term.negative);
    let folder_filter = |folder: &str, values: &mut Vec<Value>| -> Result<String, String> {
        Ok(match folder {
            "anywhere" => "1".into(),
            "all" => "m.folder<>'trash'".into(),
            "starred" => "m.flagged=1 AND m.folder<>'trash'".into(),
            value if value.starts_with("tag:") => {
                let id = bind(values, start, value[4..].to_string());
                format!("m.folder<>'trash' AND EXISTS(SELECT 1 FROM message_tags mt WHERE mt.account_id=m.account_id AND mt.folder=m.folder AND mt.message_uid=m.uid AND mt.tag_id={id})")
            }
            value => {
                let value = bind(values, start, value.to_lowercase());
                format!("m.folder={value}")
            }
        })
    };
    if !overrides_folder {
        conditions.push(folder_filter(folder, &mut values)?);
    }
    for term in terms {
        let clause = match term.field.as_str() {
            "is" => match term.value.to_ascii_lowercase().as_str() {
                "unread" => "m.seen=0".into(),
                "read" => "m.seen=1".into(),
                "starred" => "m.flagged=1".into(),
                _ => return Err("Use is:unread, is:read or is:starred.".into()),
            },
            "has" => {
                if !["attachment", "attachments"]
                    .contains(&term.value.to_ascii_lowercase().as_str())
                {
                    return Err("Use has:attachment.".into());
                }
                "m.has_attachments=1".into()
            }
            "after" | "before" => {
                let date = chrono::NaiveDate::parse_from_str(&term.value, "%Y-%m-%d")
                    .map_err(|_| "Use dates in YYYY-MM-DD format.")?;
                let seconds = date
                    .and_hms_opt(0, 0, 0)
                    .ok_or("Invalid date")?
                    .and_utc()
                    .timestamp();
                let value = bind(&mut values, start, seconds);
                format!(
                    "m.date {} {value}",
                    if term.field == "after" { ">=" } else { "<" }
                )
            }
            "in" => {
                if !["all", "anywhere", "inbox", "sent", "trash", "starred"]
                    .contains(&term.value.to_ascii_lowercase().as_str())
                {
                    return Err(
                        "Use in:all, in:anywhere, in:inbox, in:sent, in:trash or in:starred."
                            .into(),
                    );
                }
                folder_filter(&term.value.to_ascii_lowercase(), &mut values)?
            }
            "tag" => {
                let value = bind(&mut values, start, term.value);
                format!("EXISTS(SELECT 1 FROM message_tags mt JOIN tags t ON t.account_id=mt.account_id AND t.id=mt.tag_id WHERE mt.account_id=m.account_id AND mt.folder=m.folder AND mt.message_uid=m.uid AND (t.id={value} OR t.name={value} COLLATE NOCASE))")
            }
            field => {
                let column = match field {
                    "from" => "sender",
                    "to" => "recipient",
                    "subject" => "subject",
                    "body" => "body",
                    "filename" => "attachment_names",
                    _ => "",
                };
                let expression = fts(&term.value, term.phrase, column)?;
                let value = bind(&mut values, start, expression);
                format!(
                    "m.rowid IN(SELECT rowid FROM messages_fts WHERE messages_fts MATCH {value})"
                )
            }
        };
        conditions.push(if term.negative {
            format!("NOT ({clause})")
        } else {
            format!("({clause})")
        });
    }
    Ok(Compiled {
        sql: conditions.join(" AND "),
        values,
        overrides_folder,
    })
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Cursor {
    pub date: i64,
    pub folder: String,
    pub uid: u32,
    pub validity: u32,
}
impl Cursor {
    pub fn from_header(header: &MessageHeader) -> Self {
        Self {
            date: header.date,
            folder: header.folder.clone(),
            uid: header.uid,
            validity: header.uid_validity,
        }
    }
}
// Gmail can still report the old flags while an offline change is queued.
// Preserve provider-verified body matches while respecting our local flags.
pub fn filter_live_flags(query: &str, mut headers: Vec<MessageHeader>) -> Vec<MessageHeader> {
    if let Ok(terms) = parse(query) {
        headers.retain(|header| {
            terms.iter().filter(|term| term.field == "is").all(|term| {
                let matched = match term.value.to_ascii_lowercase().as_str() {
                    "unread" => !header.seen,
                    "read" => header.seen,
                    "starred" => header.flagged,
                    _ => false,
                };
                matched != term.negative
            })
        });
    }
    headers
}
pub fn local_page(
    conn: &Connection,
    account: &str,
    folder: &str,
    query: &str,
    cursor: Option<Cursor>,
    limit: u32,
) -> Result<(Vec<MessageHeader>, Option<Cursor>), String> {
    let compiled = compile(query, folder, 2)?;
    let mut values = vec![Value::Text(account.into())];
    values.extend(compiled.values);
    let mut predicate = compiled.sql;
    if let Some(cursor) = cursor {
        let date = bind(&mut values, 1, cursor.date);
        let folder = bind(&mut values, 1, cursor.folder);
        let uid = bind(&mut values, 1, cursor.uid as i64);
        let validity = bind(&mut values, 1, cursor.validity as i64);
        predicate.push_str(&format!(
            " AND (m.date,m.folder,m.uid,m.uid_validity)<({date},{folder},{uid},{validity})"
        ));
    }
    let limit = limit.clamp(1, 101);
    let cap = bind(&mut values, 1, (limit + 1) as i64);
    let sql=format!("SELECT m.uid,m.uid_validity,m.subject,m.sender,m.date,m.seen,m.flagged,m.snippet,m.folder,m.has_attachments,m.thread_id,m.recipient,m.message_id FROM messages m WHERE m.account_id=?1 AND {predicate} AND NOT EXISTS(SELECT 1 FROM mail_location_intents p WHERE p.account_id=m.account_id AND p.optimistic=1 AND p.identity=CASE WHEN NULLIF(m.message_id,'') IS NOT NULL THEN json_array('id',m.message_id,m.date,m.sender,m.subject) ELSE json_array('row',m.folder,m.uid,m.uid_validity) END) ORDER BY m.date DESC,m.folder DESC,m.uid DESC,m.uid_validity DESC LIMIT {cap}");
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params_from_iter(values), |r| {
            Ok(MessageHeader {
                uid: r.get(0)?,
                uid_validity: r.get(1)?,
                subject: r.get(2)?,
                from: r.get(3)?,
                date: r.get(4)?,
                seen: r.get(5)?,
                flagged: r.get(6)?,
                snippet: r.get(7)?,
                folder: r.get(8)?,
                has_attachments: r.get(9)?,
                thread_id: r.get(10)?,
                to: r.get(11)?,
                message_id: r.get(12)?,
                tags: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut rows = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let mut tags=conn.prepare_cached("SELECT tag_id FROM message_tags WHERE account_id=?1 AND folder=?2 AND message_uid=?3 ORDER BY tag_id").map_err(|e|e.to_string())?;
    for row in &mut rows {
        row.tags = tags
            .query_map(rusqlite::params![account, row.folder, row.uid], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
    }
    let cursor = if more {
        rows.last().map(Cursor::from_header)
    } else {
        None
    };
    Ok((rows, cursor))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(account_id TEXT,folder TEXT,uid INTEGER,uid_validity INTEGER DEFAULT 9,date INTEGER,subject TEXT,sender TEXT,recipient TEXT,body TEXT,snippet TEXT,seen INTEGER DEFAULT 0,flagged INTEGER DEFAULT 0,has_attachments INTEGER DEFAULT 0,thread_id TEXT,message_id TEXT);CREATE TABLE message_tags(account_id TEXT,folder TEXT,message_uid INTEGER,tag_id TEXT);CREATE TABLE tags(account_id TEXT,id TEXT,name TEXT);CREATE TABLE mail_location_intents(account_id TEXT,identity TEXT,optimistic INTEGER);CREATE VIRTUAL TABLE messages_fts USING fts5(subject,sender,recipient,body,attachment_names);CREATE INDEX search_test_account_date ON messages(account_id,date DESC);
 INSERT INTO messages(account_id,folder,uid,date,subject,sender,recipient,body,snippet,has_attachments) VALUES('a','inbox',1,1793664000,'Quarterly report','Alice <alice@example.com>','me@example.com','budget forecast','Preview',1),('a','sent',2,1793577600,'Invoice','Me <me@example.com>','bob@example.com','Paid invoice','Preview',0),('b','inbox',1,1793664000,'Private report','Alice <alice@example.com>','other@example.com','budget forecast','Preview',1),('a','trash',3,1793664000,'Discarded report','Alice <alice@example.com>','me@example.com','budget forecast','Preview',0);
 INSERT INTO messages_fts(rowid,subject,sender,recipient,body) SELECT rowid,subject,sender,recipient,body FROM messages;INSERT INTO tags VALUES('a','same','Work'),('b','same','Personal');INSERT INTO message_tags VALUES('a','inbox',1,'same'),('b','inbox',1,'same');").unwrap();
        conn
    }
    #[test]
    fn parses_quoted_filters_negation_and_dates_without_executing_input() {
        let terms =
            parse(r#"from:alice subject:"quarterly report" -tag:Personal after:2026-01-01"#)
                .unwrap();
        assert_eq!(terms.len(), 4);
        assert_eq!(terms[1].value, "quarterly report");
        assert!(terms[2].negative);
        let plan = compile("subject:\"x' OR 1=1 --\"", "inbox", 1).unwrap();
        assert!(!plan.sql.contains("OR 1=1"));
        assert!(compile("after:2026-99-99", "inbox", 1).is_err());
        assert!(parse("subject:\"unfinished").is_err());
        assert!(compile("is:deleted", "inbox", 1).is_err());
    }
    #[test]
    fn fts_operators_are_quoted_and_scopes_are_explicit() {
        let plan = compile("NEAR* -is:read has:attachment in:sent", "inbox", 6).unwrap();
        assert!(plan.overrides_folder);
        assert!(plan.sql.contains("?6"));
        assert!(!plan.sql.contains("m.folder='inbox'"));
        assert!(plan
            .values
            .iter()
            .any(|value| matches!(value,Value::Text(text) if text.contains("\"NEAR\"*"))));
    }
    #[test]
    fn combines_indexed_body_sender_tag_and_status_filters_without_crossing_accounts() {
        let conn = fixture();
        let (rows, _) = local_page(
            &conn,
            "a",
            "inbox",
            "from:alice body:forecast tag:Work is:unread has:attachment",
            None,
            50,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uid, 1);
        assert_eq!(rows[0].tags, vec!["same"]);
        assert!(local_page(&conn, "b", "all", "tag:Work", None, 50)
            .unwrap()
            .0
            .is_empty());
        assert!(local_page(&conn, "a", "inbox", "-from:alice", None, 50)
            .unwrap()
            .0
            .is_empty());
        assert_eq!(
            local_page(&conn, "a", "inbox", "in:sent to:bob", None, 50)
                .unwrap()
                .0[0]
                .uid,
            2
        );
    }
    #[test]
    fn quoted_subjects_dates_and_trash_scope_are_predictable() {
        let conn = fixture();
        assert_eq!(
            local_page(
                &conn,
                "a",
                "all",
                r#"subject:"Quarterly report" after:2026-11-03 before:2026-11-04"#,
                None,
                50
            )
            .unwrap()
            .0
            .len(),
            1
        );
        assert!(local_page(
            &conn,
            "a",
            "all",
            "before:2026-11-03 subject:Quarterly",
            None,
            50
        )
        .unwrap()
        .0
        .is_empty());
        assert_eq!(
            local_page(&conn, "a", "all", "in:anywhere report", None, 50)
                .unwrap()
                .0
                .len(),
            2
        );
    }
    #[test]
    fn keyset_pages_cover_all_cached_matches_and_use_the_fts_index() {
        let conn = fixture();
        for uid in 10..270 {
            conn.execute("INSERT INTO messages(account_id,folder,uid,date,subject,sender,body,snippet) VALUES('a','inbox',?1,100,'Pagination','Sender','Body','Preview')",[uid]).unwrap();
            let rowid = conn.last_insert_rowid();
            conn.execute("INSERT INTO messages_fts(rowid,subject,sender,body) VALUES(?1,'Pagination','Sender','Body')",[rowid]).unwrap();
        }
        let mut cursor = None;
        let mut found = std::collections::HashSet::new();
        loop {
            let (rows, next) = local_page(&conn, "a", "inbox", "Pagination", cursor, 50).unwrap();
            for row in rows {
                assert!(found.insert(row.uid));
            }
            cursor = next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(found.len(), 260);
        let compiled = compile("Pagination", "inbox", 2).unwrap();
        let mut values = vec![Value::Text("a".into())];
        values.extend(compiled.values);
        let plan = conn
            .prepare(&format!(
                "EXPLAIN QUERY PLAN SELECT m.uid FROM messages m WHERE m.account_id=?1 AND {}",
                compiled.sql
            ))
            .unwrap()
            .query_map(params_from_iter(values), |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(plan.iter().any(|line| line.contains("VIRTUAL TABLE INDEX")));
    }
}
