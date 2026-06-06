use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub starttls: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum MailProvider {
    Google,
    Outlook,
    Custom(SmtpConfig),
}

impl MailProvider {
    pub fn smtp_config(&self) -> SmtpConfig {
        match self {
            MailProvider::Google => SmtpConfig {
                host: "smtp.gmail.com".to_string(),
                port: 587,
                starttls: true,
            },
            MailProvider::Outlook => SmtpConfig {
                host: "smtp-mail.outlook.com".to_string(),
                port: 587,
                starttls: true,
            },
            MailProvider::Custom(config) => config.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub provider: MailProvider,
    #[serde(default)]
    #[serde(skip_serializing)]
    pub access_token: String,
    #[serde(default)]
    #[serde(skip_serializing)]
    pub refresh_token: String,
    #[serde(default)]
    pub needs_reauth: bool,
    pub expires_at: i64,
    pub last_sync: Option<i64>,
    pub profile_name: String,
    pub profile_picture: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserProfile {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: String,
    pub provider: MailProvider,
}

impl From<Account> for UserProfile {
    fn from(account: Account) -> Self {
        Self {
            id: account.id,
            email: account.email,
            name: account.profile_name,
            picture: account.profile_picture,
            provider: account.provider,
        }
    }
}
