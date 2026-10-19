use super::{content::Content, ExtractedEntity, EntityType, Provenance, ExtractionSource};
use std::collections::HashSet;

pub fn from_content(content: &Content) -> Vec<ExtractedEntity> {
    let mut seen = HashSet::new();
    let mut links = content.links.clone();
    if let Ok(pattern) = crate::mail::patterns::regex(r#"https://[^\s<>"']+"#) {
        for found in pattern.find_iter(&content.text).take(50) {
            let raw = found.as_str().trim_end_matches(['.', ',', ';', ')', ']']);
            if let Ok(url) = url::Url::parse(raw) {
                if url.has_host() && url.username().is_empty() && url.password().is_none() && raw.len() <= 8192 {
                    links.push((url.into(), String::new()));
                }
            }
        }
    }
    links.iter().filter(|(url, _)| seen.insert(url.clone())).take(100).enumerate().map(|(i, (url, label))| ExtractedEntity {
        id: format!("link:{i}"), entity_type: EntityType::Link, provider: None,
        value: url.clone(), confidence: 0.9,
        provenance: Provenance { source: ExtractionSource::Html, extractor: "links.rs".into() },
        evidence: Some(label.clone()), metadata: serde_json::json!({"url":url,"label":label}),
    }).collect()
}
