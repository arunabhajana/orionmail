use mailparse::{addrparse, MailAddr};
use std::collections::HashSet;
use tauri::AppHandle;
use crate::contacts::contact_store::{upsert_contacts, ContactEntry};

pub fn extract_and_store_contacts(app_handle: &AppHandle, headers_list: &[String]) -> Result<(), String> {
    let mut unique_emails = HashSet::new();
    let mut contacts = Vec::new();

    for header_val in headers_list {
        if let Ok(addrs) = addrparse(header_val) {
            // Try formatting first to see what it is
            for addr in addrs.iter() {
                match addr {
                    MailAddr::Single(info) => {
                        let email = info.addr.trim().to_lowercase();
                        // Lightweight validation
                        if !email.is_empty() && email.contains('@') && !unique_emails.contains(&email) {
                            unique_emails.insert(email.clone());
                            
                            // Prefer not to store empty display names if possible, but keep Option
                            let display_name = info.display_name.clone().map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
                            
                            contacts.push(ContactEntry {
                                email,
                                display_name,
                                source: "IMAP".to_string(),
                            });
                        }
                    }
                    MailAddr::Group(info) => {
                        for single in &info.addrs {
                            let email = single.addr.trim().to_lowercase();
                            if !email.is_empty() && email.contains('@') && !unique_emails.contains(&email) {
                                unique_emails.insert(email.clone());
                                let display_name = single.display_name.clone().map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
                                contacts.push(ContactEntry {
                                    email,
                                    display_name,
                                    source: "IMAP".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    upsert_contacts(app_handle, &contacts)?;

    Ok(())
}

pub fn record_sent_emails(app_handle: &AppHandle, emails: Vec<String>) -> Result<(), String> {
    let mut contacts = Vec::new();
    let mut clean_emails = Vec::new();
    
    for email in emails {
        let e = email.trim().to_lowercase();
        if !e.is_empty() && e.contains('@') {
            contacts.push(ContactEntry {
                email: e.clone(),
                display_name: None,
                source: "SMTP".to_string(),
            });
            clean_emails.push(e);
        }
    }
    
    // Ensure they exist
    upsert_contacts(app_handle, &contacts)?;
    
    // Increment usage
    crate::contacts::contact_store::record_usage(app_handle, &clean_emails)?;
    
    Ok(())
}
