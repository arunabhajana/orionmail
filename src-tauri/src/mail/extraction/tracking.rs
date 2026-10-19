use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use crate::mail::patterns::regex as cached_regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    
    let patterns = vec![
        (r"\b(1Z[0-9A-Z]{16})\b", "UPS"),
        (r"\b([0-9]{12,15})\b", "FedEx"), // simplified
        (r"\b([0-9]{20,22})\b", "USPS"),
    ];

    let mut id_counter = 0;
    for (p, provider) in patterns {
        if let Ok(re) = cached_regex(p) {
            for cap in re.captures_iter(text) {
                if let Some(m) = cap.get(1) {
                    // Only match if tracking words are nearby
                    let raw_start = cap.get(0).unwrap().start().saturating_sub(50);
                    let raw_end = std::cmp::min(cap.get(0).unwrap().end() + 50, text.len());

                    // Adjust to valid UTF-8 char boundaries to prevent panics
                    let mut context_start = raw_start;
                    while context_start > 0 && !text.is_char_boundary(context_start) {
                        context_start -= 1;
                    }
                    let mut context_end = raw_end;
                    while context_end < text.len() && !text.is_char_boundary(context_end) {
                        context_end += 1;
                    }
                    let context = &text[context_start..context_end];
                    
                    let context_lower = context.to_lowercase();
                    let carrier_context = context_lower.contains(&provider.to_lowercase());
                    if (carrier_context || provider == "UPS") && (context_lower.contains("track") || context_lower.contains("ship") || context_lower.contains("deliver")) {
                        entities.push(ExtractedEntity {
                            id: format!("tracking:{}:{}", provider.to_lowercase(), id_counter),
                            entity_type: EntityType::TrackingNumber,
                            provider: Some(provider.to_string()),
                            value: m.as_str().to_string(),
                            confidence: 0.9,
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
