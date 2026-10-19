use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use crate::mail::patterns::regex as cached_regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    
    if let Ok(re) = cached_regex(r"(?i)\b(?:invoice|receipt|order)(?:\s+(?:no|number|#))?\s*:?-?\s*([A-Z0-9-]{4,15})\b") {
        for (i, cap) in re.captures_iter(text).enumerate() {
            if let Some(m) = cap.get(1) {
                entities.push(ExtractedEntity {
                    id: format!("invoice:{}", i),
                    entity_type: EntityType::InvoiceReference,
                    provider: None,
                    value: m.as_str().to_string(),
                    confidence: 0.6,
                    provenance: Provenance {
                        source: ExtractionSource::Regex,
                        extractor: "invoice.rs".to_string(),
                    },
                    evidence: Some(cap.get(0).map_or(m.as_str().to_string(), |x| x.as_str().to_string())),
                    metadata: serde_json::json!({}),
                });
            }
        }
    }

    entities
}
