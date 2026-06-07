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

pub const CURRENT_EXTRACTOR_VERSION: u32 = 9;

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

pub fn run_extraction_pipeline(html: &str, text: &str) -> ExtractedData {
    let mut entities = Vec::new();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    entities.extend(schema_org::extract(html, text));
    entities.extend(calendar::extract(html, text));
    entities.extend(links::extract(html, text));
    entities.extend(otp::extract(html, text));
    entities.extend(tracking::extract(html, text));
    entities.extend(commerce::extract(html, text));
    entities.extend(invoice::extract(html, text));
    entities.extend(account::extract(html, text));

    ExtractedData {
        version: CURRENT_EXTRACTOR_VERSION,
        extracted_at: now,
        entities,
    }
}
