use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use regex::Regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    
    let patterns = vec![
        (r"\b(1Z[0-9A-Z]{16})\b", "UPS"),
        (r"\b([0-9]{12,15})\b", "FedEx"), // simplified
        (r"\b([0-9]{20,22})\b", "USPS"),
    ];

    let mut id_counter = 0;
    for (p, provider) in patterns {
        if let Ok(re) = Regex::new(p) {
            for cap in re.captures_iter(text) {
                if let Some(m) = cap.get(1) {
                    // Only match if tracking words are nearby
                    let context_start = cap.get(0).unwrap().start().saturating_sub(50);
                    let context_end = std::cmp::min(cap.get(0).unwrap().end() + 50, text.len());
                    let context = &text[context_start..context_end];
                    
                    if context.to_lowercase().contains("track") || context.to_lowercase().contains("ship") || context.to_lowercase().contains("deliver") {
                        entities.push(ExtractedEntity {
                            id: format!("tracking:{}:{}", provider.to_lowercase(), id_counter),
                            entity_type: EntityType::TrackingNumber,
                            provider: Some(provider.to_string()),
                            value: m.as_str().to_string(),
                            confidence: 0.7,
                            provenance: Provenance {
                                source: ExtractionSource::Regex,
                                extractor: "tracking.rs".to_string(),
                            },
                            evidence: Some(context.to_string()),
                            metadata: serde_json::json!({ "carrier": provider }),
                        });
                        id_counter += 1;
                    }
                }
            }
        }
    }

    entities
}
