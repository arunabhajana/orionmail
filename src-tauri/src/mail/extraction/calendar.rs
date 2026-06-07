use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let mut entities = Vec::new();
    if let Some(start) = text.find("BEGIN:VCALENDAR") {
        if let Some(end) = text[start..].find("END:VCALENDAR") {
            let vcal = &text[start..start+end+"END:VCALENDAR".len()];
            entities.push(ExtractedEntity {
                id: format!("calendar:{}", entities.len()),
                entity_type: EntityType::CalendarEvent,
                provider: None,
                value: "vcalendar".to_string(),
                confidence: 0.9,
                provenance: Provenance {
                    source: ExtractionSource::Calendar,
                    extractor: "calendar.rs".to_string(),
                },
                evidence: Some(vcal.to_string()),
                metadata: serde_json::json!({ "vcalendar": vcal }),
            });
        }
    }
    entities
}
