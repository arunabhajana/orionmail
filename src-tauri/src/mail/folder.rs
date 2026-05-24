use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MailFolder {
    Inbox,
    Sent,
    Starred,
}

impl fmt::Display for MailFolder {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MailFolder::Inbox => write!(f, "inbox"),
            MailFolder::Sent => write!(f, "sent"),
            MailFolder::Starred => write!(f, "starred"),
        }
    }
}

impl FromStr for MailFolder {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "inbox" => Ok(MailFolder::Inbox),
            "sent" => Ok(MailFolder::Sent),
            "starred" => Ok(MailFolder::Starred),
            _ => Err(format!("Unknown MailFolder: {}", s)),
        }
    }
}

impl MailFolder {
    /// Returns the corresponding IMAP mailbox name for the folder.
    /// Returns None for local virtual folders (e.g. Starred).
    pub fn to_imap_mailbox(&self) -> Option<&'static str> {
        match self {
            MailFolder::Inbox => Some("INBOX"),
            // Default mapping for Gmail
            MailFolder::Sent => Some("[Gmail]/Sent Mail"),
            MailFolder::Starred => None,
        }
    }
}
