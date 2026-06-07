use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use regex::Regex;
use std::collections::HashSet;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    let mut seen = HashSet::new();

    if let Ok(re) = Regex::new(r#"(?i)https?://[^\s<>"']+|www\.[^\s<>"']+"#) {
        for (i, cap) in re.captures_iter(text).enumerate() {
            if let Some(m) = cap.get(0) {
                let url = m.as_str().trim_end_matches(|c: char| {
                    c == '.' || c == ',' || c == ';' || c == ')' || c == '"' || c == '\'' || c == ']'
                }).to_string();
                if seen.insert(url.clone()) {
                    entities.push(ExtractedEntity {
                        id: format!("link:{}", i),
                        entity_type: EntityType::Link,
                        provider: None,
                        value: url.clone(),
                        confidence: 1.0,
                        provenance: Provenance {
                            source: ExtractionSource::Regex,
                            extractor: "links.rs".to_string(),
                        },
                        evidence: Some(url.clone()),
                        metadata: serde_json::json!({ "url": url }),
                    });
                }
            }
        }
    }
    entities
}
