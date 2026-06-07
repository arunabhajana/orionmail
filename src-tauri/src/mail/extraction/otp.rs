use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use regex::Regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    let mut i = 0;

    // Pattern 1: Explicit G-Codes
    if let Ok(re) = Regex::new(r"\b(G-\d{4,8})\b") {
        for cap in re.captures_iter(text) {
            if let Some(m) = cap.get(1) {
                entities.push(ExtractedEntity {
                    id: format!("code:{}", i),
                    entity_type: EntityType::Code,
                    provider: None,
                    value: m.as_str().to_uppercase(),
                    confidence: 0.9,
                    provenance: Provenance {
                        source: ExtractionSource::Regex,
                        extractor: "otp.rs".to_string(),
                    },
                    evidence: Some(m.as_str().to_string()),
                    metadata: serde_json::json!({}),
                });
                i += 1;
            }
        }
    }

    // Pattern 2: Contextual search (look for trigger word, then scan next 80 chars for a code)
    if let Ok(trigger_re) = Regex::new(r"(?i)\b(?:code|otp|pin|verification)\b") {
        if let Ok(code_re) = Regex::new(r"(?i)\b[A-Z0-9]{4,8}\b") {
            for cap in trigger_re.captures_iter(text) {
                let m = cap.get(0).unwrap();
                let start = m.end();
                let end = std::cmp::min(start + 80, text.len());
                let window = &text[start..end];

                // Find the first valid code in the window that contains at least one digit
                for code_cap in code_re.captures_iter(window) {
                    let code_str = code_cap.get(0).unwrap().as_str();
                    let code_upper = code_str.to_uppercase();
                    
                    // Must contain at least one digit, and ignore if it's a common false positive (like a year)
                    if code_upper.chars().any(|c| c.is_ascii_digit()) {
                        entities.push(ExtractedEntity {
                            id: format!("code:{}", i),
                            entity_type: EntityType::Code,
                            provider: None,
                            value: code_upper.clone(),
                            confidence: 0.8,
                            provenance: Provenance {
                                source: ExtractionSource::Regex,
                                extractor: "otp.rs".to_string(),
                            },
                            evidence: Some(window.to_string()),
                            metadata: serde_json::json!({}),
                        });
                        i += 1;
                        break; // Stop after finding the first valid code in this window
                    }
                }
            }
        }
    }
    
    entities
}
