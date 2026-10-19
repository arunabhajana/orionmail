use super::{ExtractedEntity, EntityType, Provenance, ExtractionSource};
use crate::mail::patterns::regex as cached_regex;

/// Match a whole code next to an authentication label, never arbitrary numbers
/// elsewhere in a paragraph. Code casing and leading zeroes are preserved.
pub fn extract_visible(text: &str, subject: &str) -> Vec<ExtractedEntity> {
    let auth = cached_regex(r"(?i)\b(?:otp|one[- ]time (?:password|code)|verification code|security code|authentication code|login code|sign[- ]in code|passcode|verify your (?:email|identity|account))\b").unwrap();
    let before = cached_regex(r"(?i)\b(?:otp|one[- ]time (?:password|code)|verification code|security code|authentication code|login code|sign[- ]in code|passcode|your code|code)(?:\s*(?:is|:|=|-))*\s*$").unwrap();
    let after = cached_regex(r"(?i)^\s*(?:is\s+)?(?:your\s+)?(?:otp|one[- ]time (?:password|code)|verification code|security code|authentication code|login code|sign[- ]in code|passcode)\b").unwrap();
    let candidate = cached_regex(r"\b(?:G-[0-9]{4,8}|[A-Za-z0-9]{4,8})\b").unwrap();
    let spaced = cached_regex(r"^[0-9](?: [0-9]){3,7}$").unwrap();
    let non_code_label = cached_regex(r"(?i)\b(?:coupon|promo|discount|voucher|order|invoice|tracking|postal|zip|css|color|width|height|copyright|account number|phone number)\b").unwrap();
    let subject_auth = auth.is_match(subject) || cached_regex(r"(?i)\b(?:verify|confirm)\b.{0,30}\b(?:email|account|identity)\b|\b(?:email|account) verification\b").unwrap().is_match(subject);
    let mut found = std::collections::BTreeMap::new();
    let lines: Vec<_> = text.lines().take(1500).collect();
    for (index, source) in lines.iter().enumerate() {
        let previous = index.checked_sub(1).and_then(|i| lines.get(i)).copied().unwrap_or("");
        let context = format!("{previous} {source}");
        if !subject_auth && !auth.is_match(&context) { continue; }
        let normalized;
        let line = if spaced.is_match(source.trim()) {
            normalized = source.trim().replace(' ', ""); normalized.as_str()
        } else { *source };
        for matched in candidate.find_iter(line) {
            let code = matched.as_str();
            if !code.chars().any(|c| c.is_ascii_digit()) { continue; }
            let prefix = &line[..matched.start()];
            let suffix = &line[matched.end()..];
            if prefix.ends_with(['-', '_', '#', '=']) || suffix.starts_with(['-', '_', '%']) { continue; }
            if prefix.chars().last().is_some_and(|c| matches!(c, '$' | '\u{20b9}' | '\u{20ac}' | '\u{00a3}')) { continue; }
            if suffix.starts_with('.') && suffix.chars().nth(1).is_some_and(|c| c.is_ascii_digit()) { continue; }
            let standalone = line.trim() == code && (subject_auth || auth.is_match(previous)) && !non_code_label.is_match(previous);
            let google_code = code.starts_with("G-") && auth.is_match(&context);
            if !standalone && !google_code && !before.is_match(prefix) && !after.is_match(suffix) { continue; }
            // An explicit non-authentication label nearest to the value wins.
            if non_code_label.is_match(prefix) && !auth.is_match(prefix) { continue; }
            found.entry(code.to_string()).or_insert(context.chars().take(160).collect::<String>());
        }
    }
    // Never guess between a current code and another code in the same message.
    if found.len() != 1 { return Vec::new(); }
    found.into_iter().map(|(value, evidence)| ExtractedEntity {
        id: "code:0".into(), entity_type: EntityType::Code, provider: None,
        value, confidence: 0.95,
        provenance: Provenance { source: ExtractionSource::PlainText, extractor: "otp.rs".into() },
        evidence: Some(evidence), metadata: serde_json::json!({"contextual":true}),
    }).collect()
}
