use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use regex::Regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();

    // Simplify OTP detection for Rust side. We can extract basic patterns.
    let patterns = vec![
        r"\b(G-\d{4,8})\b",
        r"(?is)\b(?:code|otp|pin|verification)\b.{0,60}?\b([A-Z0-9]{4,8})\b",
    ];

    let mut i = 0;
    for p in patterns {
        if let Ok(re) = Regex::new(p) {
            for cap in re.captures_iter(text) {
                if let Some(m) = cap.get(1) {
                    let code = m.as_str().to_uppercase();
                    if code.chars().any(|c| c.is_ascii_digit()) {
                        entities.push(ExtractedEntity {
                            id: format!("code:{}", i),
                            entity_type: EntityType::Code,
                            provider: None,
                            value: code.clone(),
                            confidence: 0.8,
                            provenance: Provenance {
                                source: ExtractionSource::Regex,
                                extractor: "otp.rs".to_string(),
                            },
                            evidence: Some(cap.get(0).map_or(code.clone(), |m| m.as_str().to_string())),
                            metadata: serde_json::json!({}),
                        });
                        i += 1;
                    }
                }
            }
        }
    }
    
    entities
}
