use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use crate::auth::account::MailProvider;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MailFolder {
    Inbox,
    Sent,
    Starred,
    Trash,
    #[serde(untagged)]
    Tag(String),
}

impl fmt::Display for MailFolder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MailFolder::Inbox => write!(f, "inbox"),
            MailFolder::Sent => write!(f, "sent"),
            MailFolder::Starred => write!(f, "starred"),
            MailFolder::Trash => write!(f, "trash"),
            MailFolder::Tag(tag_id) => write!(f, "tag:{}", tag_id),
        }
    }
}

impl FromStr for MailFolder {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s_lower = s.to_lowercase();
        if s_lower.starts_with("tag:") {
            let tag_id = s[4..].to_string(); // Preserve case of tag ID
            return Ok(MailFolder::Tag(tag_id));
        }

        match s_lower.as_str() {
            "inbox" => Ok(MailFolder::Inbox),
            "sent" => Ok(MailFolder::Sent),
            "starred" => Ok(MailFolder::Starred),
            "trash" => Ok(MailFolder::Trash),
            _ => Err(format!("Unknown MailFolder: {}", s)),
        }
    }
}

impl MailFolder {
    /// Returns the corresponding IMAP mailbox name for the folder.
    /// Returns None for local virtual folders (e.g. Starred).
    pub fn to_imap_mailbox(&self, provider: &MailProvider) -> Option<&'static str> {
        match self {
            MailFolder::Inbox => Some("INBOX"),
            MailFolder::Sent => match provider {
                MailProvider::Google => Some("[Gmail]/Sent Mail"),
                MailProvider::Outlook => Some("Sent Items"),
                MailProvider::Custom { .. } => Some("Sent"),
            },
            MailFolder::Starred => None,
            MailFolder::Trash => Some(match provider { MailProvider::Google => "[Gmail]/Trash", MailProvider::Outlook => "Deleted Items", MailProvider::Custom { .. } => "Trash" }),
            MailFolder::Tag(_) => None, // Handled dynamically in sync.rs
        }
    }
}
