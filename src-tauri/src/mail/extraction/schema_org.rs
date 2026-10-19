use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use crate::mail::patterns::regex as cached_regex;

pub fn extract(html: &str, _text: &str) -> Vec<ExtractedEntity> {
    let mut objects = Vec::new();
    if let Ok(pattern) = cached_regex(r#"(?si)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>"#) {
        for capture in pattern.captures_iter(html).take(20) {
            if let Some(body) = capture.get(1).filter(|body| body.as_str().len() <= 128 * 1024) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(body.as_str()) { flatten(&value, &mut objects, 0); }
            }
        }
    }
    objects.into_iter().enumerate().map(|(index, value)| ExtractedEntity {
        id: format!("schema_org:{index}"), entity_type: EntityType::SchemaOrgObject, provider: None,
        value: "schema".into(), confidence: 0.9,
        provenance: Provenance { source: ExtractionSource::SchemaOrg, extractor: "schema_org.rs".into() },
        evidence: None, metadata: value,
    }).collect()
}
fn flatten(value: &serde_json::Value, output: &mut Vec<serde_json::Value>, depth: usize) {
    if depth > 8 || output.len() >= 12 { return; }
    if let Some(array) = value.as_array() { for child in array { flatten(child, output, depth + 1); } }
    else if let Some(object) = value.as_object() {
        let known = ["Order", "Event", "FlightReservation", "LodgingReservation", "TrainReservation", "ParcelDelivery", "Invoice"];
        if let Some(kind) = object.get("@type") {
            let types: Vec<&str> = if let Some(kind) = kind.as_str() { vec![kind] }
                else { kind.as_array().map(|values| values.iter().filter_map(|kind| kind.as_str()).collect()).unwrap_or_default() };
            if let Some(kind) = types.into_iter().find(|kind| known.contains(&kind.rsplit('/').next().unwrap_or(kind))) {
                let mut normalized = value.clone(); normalized["@type"] = serde_json::Value::String(kind.to_string()); output.push(normalized);
            }
        }
        if let Some(graph) = object.get("@graph") { flatten(graph, output, depth + 1); }
    }
}
