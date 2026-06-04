use crate::auth::account::{Account, MailProvider};
use crate::auth::oauth::refresh_google_token;
use crate::auth::session::save_account;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use lettre::message::{MultiPart, header::MessageId};
use tauri::AppHandle;
use chrono::Utc;
use std::time::Duration;
use tokio::time::timeout;

#[derive(Debug)]
pub enum SendError {
    Authentication,
    Network,
    Timeout,
    InvalidRecipient,
    Other(String),
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendError::Authentication => write!(f, "Failed to authenticate with the SMTP server. Please try logging in again."),
            SendError::Network => write!(f, "Network error occurred while connecting to the SMTP server."),
            SendError::Timeout => write!(f, "The request timed out. Please check your internet connection."),
            SendError::InvalidRecipient => write!(f, "One or more recipient addresses are invalid."),
            SendError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl From<anyhow::Error> for SendError {
    fn from(err: anyhow::Error) -> Self {
        SendError::Other(err.to_string())
    }
}

pub async fn send_email(
    app_handle: &AppHandle,
    account: &mut Account,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    reply_to: Option<String>,
    subject: &str,
    plain_body: &str,
    html_body: &str,
    attachments: Vec<String>,
) -> Result<(), SendError> {
    // 1. Check if token needs refreshing (buffer of 5 minutes)
    if account.expires_at < Utc::now().timestamp() + 300 {
        if let Err(e) = refresh_google_token(account).await {
            return Err(SendError::Other(format!("Failed to refresh token: {}", e)));
        }
        // Save the updated account
        let _ = save_account(app_handle, account.clone(), true);
    }

    // 2. Build the message
    let mut builder = Message::builder()
        .from(account.email.parse().map_err(|_| SendError::InvalidRecipient)?)
        .subject(subject)
        .header(MessageId::from(format!("<{}@orionmail>", uuid::Uuid::new_v4())));

    for recipient in &to {
        builder = builder.to(recipient.parse().map_err(|_| SendError::InvalidRecipient)?);
    }
    for recipient in &cc {
        builder = builder.cc(recipient.parse().map_err(|_| SendError::InvalidRecipient)?);
    }
    for recipient in &bcc {
        builder = builder.bcc(recipient.parse().map_err(|_| SendError::InvalidRecipient)?);
    }
    if let Some(rt) = reply_to {
        builder = builder.reply_to(rt.parse().map_err(|_| SendError::InvalidRecipient)?);
    }

    let mut multipart = MultiPart::mixed().multipart(
        MultiPart::alternative_plain_html(
            String::from(plain_body),
            String::from(html_body),
        )
    );

    for path in attachments {
        let path_obj = std::path::Path::new(&path);
        let filename = path_obj.file_name().unwrap_or_default().to_string_lossy().into_owned();
        
        let file_bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(_) => return Err(SendError::Other(format!("Could not read attachment: {}. The file may have been moved or deleted.", filename))),
        };
        
        let content_type = mime_guess::from_path(&path).first_or_octet_stream();
        let lettre_content_type = content_type.to_string().parse().unwrap_or_else(|_| "application/octet-stream".parse().unwrap());
        
        let attachment = lettre::message::Attachment::new(filename)
            .body(file_bytes, lettre_content_type);
            
        multipart = multipart.singlepart(attachment);
    }
    
    let email = builder.multipart(multipart).map_err(|e| SendError::Other(e.to_string()))?;

    // 3. Configure SMTP
    let smtp_config = account.provider.smtp_config();
    
    // For Google, we use XOAUTH2
    let creds = Credentials::new(account.email.clone(), account.access_token.clone());
    
    // Note: If lettre's built-in Mechanism::Xoauth2 fails, we might need a custom SASL mechanism.
    // For lettre 0.11, Mechanism::Xoauth2 is fully supported.
    
    let mut transport_builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp_config.host)
        .map_err(|_| SendError::Network)?
        .port(smtp_config.port);
        
    match account.provider {
        MailProvider::Google => {
            transport_builder = transport_builder
                .credentials(creds)
                .authentication(vec![Mechanism::Xoauth2]);
        },
        _ => {
            // For other providers, use standard login if supported or adapt as needed
            transport_builder = transport_builder.credentials(creds);
        }
    }

    let mailer = transport_builder.build();

    // 4. Send with timeout (increased to 120s for large attachments)
    match timeout(Duration::from_secs(120), mailer.send(email)).await {
        Ok(Ok(_)) => {
            let mut all_recipients = to;
            all_recipients.extend(cc);
            all_recipients.extend(bcc);
            
            if !all_recipients.is_empty() {
                if let Err(e) = crate::contacts::contact_indexer::record_sent_emails(app_handle, all_recipients) {
                    log::warn!("Failed to record sent emails for contacts index: {}", e);
                }
            }
            
            Ok(())
        },
        Ok(Err(e)) => {
            if e.is_client() || e.is_transient() || e.is_permanent() {
                Err(SendError::Authentication)
            } else {
                Err(SendError::Other(e.to_string()))
            }
        },
        Err(_) => Err(SendError::Timeout),
    }
}
