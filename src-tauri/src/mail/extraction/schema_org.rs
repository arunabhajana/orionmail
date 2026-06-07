use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use regex::Regex;

pub fn extract(html: &str, _text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    if let Ok(re) = Regex::new(r#"(?si)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>"#) {
        for (i, cap) in re.captures_iter(html).enumerate() {
            if let Some(m) = cap.get(1) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(m.as_str()) {
                    let id = format!("schema_org:{}", i);
                    entities.push(ExtractedEntity {
                        id,
                        entity_type: EntityType::SchemaOrgObject,
                        provider: None,
                        value: "schema".to_string(),
                        confidence: 1.0,
                        provenance: Provenance {
                            source: ExtractionSource::SchemaOrg,
                            extractor: "schema_org.rs".to_string(),
                        },
                        evidence: Some(m.as_str().to_string()),
                        metadata: json,
                    });
                }
            }
        }
    }
    entities
}
