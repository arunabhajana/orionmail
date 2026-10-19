use serde::{Deserialize, Serialize};

pub mod schema_org;
pub mod calendar;
pub mod links;
pub mod otp;
pub mod tracking;
pub mod invoice;
pub mod account;
pub mod provider_registry;
pub mod commerce;
pub(crate) mod content;

pub const CURRENT_EXTRACTOR_VERSION: u32 = 12;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ExtractionSource {
    SchemaOrg,
    Calendar,
    Html,
    PlainText,
    Regex,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum EntityType {
    Code,
    Link,
    CalendarEvent,
    TrackingNumber,
    InvoiceReference,
    ReceiptReference,
    OrderReference,
    TransactionReference,
    SubscriptionReference,
    SchemaOrgObject,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Provenance {
    pub source: ExtractionSource,
    pub extractor: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtractedEntity {
    pub id: String,
    #[serde(rename = "entityType")]
    pub entity_type: EntityType,
    pub provider: Option<String>,
    pub value: String,
    pub confidence: f32,
    pub provenance: Provenance,
    pub evidence: Option<String>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtractedData {
    pub version: u32,
    #[serde(rename = "extractedAt")]
    pub extracted_at: i64,
    pub entities: Vec<ExtractedEntity>,
}

pub fn run_with_context(html: &str, text: &str, subject: &str, sender: &str) -> ExtractedData {
    let _work = crate::performance::WorkSpan::new("smart-action extraction");
    let mut entities = Vec::new();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // Pre-compute clean visible text for extractors that need it.
    // This strips HTML/CSS so extractors don't match against invisible markup.
    let content = content::parse(html);
    // Body text has already been decoded by MIME processing. HTML wins when
    // present; raw MIME, CSS and encoded attachments never feed OTP matching.
    let best_clean = content.text.as_str();
    let envelope = format!("From: {}\nSubject: {}\n\n{}", sender.replace(['\r','\n'], " "), subject.replace(['\r','\n'], " "), best_clean);

    entities.extend(schema_org::extract(html, text));
    entities.extend(calendar::extract(html, text));
    entities.extend(links::from_content(&content));
    entities.extend(otp::extract_visible(best_clean, subject));
    entities.extend(tracking::extract(html, best_clean));
    entities.extend(commerce::extract_visible(best_clean, &envelope));
    entities.extend(invoice::extract(html, best_clean));
    entities.extend(account::extract(html, best_clean));

    ExtractedData {
        version: CURRENT_EXTRACTOR_VERSION,
        extracted_at: now,
        entities,
    }
}
