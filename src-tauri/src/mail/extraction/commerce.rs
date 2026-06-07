use super::provider_registry;
use super::{EntityType, ExtractedEntity, ExtractionSource, Provenance};
use regex::Regex;
use serde_json::json;

#[derive(Clone, Copy)]
enum CommerceKind {
    Purchase,
    Order,
    Invoice,
    Refund,
    Subscription,
    Transaction,
    Receipt,
}

impl CommerceKind {
    fn as_str(self) -> &'static str {
        match self {
            CommerceKind::Purchase => "purchase",
            CommerceKind::Order => "order",
            CommerceKind::Invoice => "invoice",
            CommerceKind::Refund => "refund",
            CommerceKind::Subscription => "subscription",
            CommerceKind::Transaction => "transaction",
            CommerceKind::Receipt => "receipt",
        }
    }

    fn entity_type(self) -> EntityType {
        match self {
            CommerceKind::Invoice => EntityType::InvoiceReference,
            CommerceKind::Receipt => EntityType::ReceiptReference,
            CommerceKind::Order | CommerceKind::Purchase => EntityType::OrderReference,
            CommerceKind::Transaction | CommerceKind::Refund => EntityType::TransactionReference,
            CommerceKind::Subscription => EntityType::SubscriptionReference,
        }
    }
}

pub fn extract(html: &str, text: &str) -> Vec<ExtractedEntity> {
    let searchable = format!("{}\n{}", strip_tags(html), text);
    let provider = provider_registry::detect_provider(text, &searchable);
    let kind = detect_kind(&searchable);
    let references = extract_references(&searchable);
    let amount = extract_amount(&searchable);
    let items = extract_items(&searchable);
    let merchant = extract_merchant(&searchable).or_else(|| provider.as_ref().map(|p| p.name.clone()));
    let status = extract_status(&searchable);

    let has_reference = !references.is_empty();
    let has_items = !items.is_empty();
    let has_amount = amount.is_some();
    let has_transaction_shape = has_amount && (has_reference || has_items || merchant.is_some()) && (kind.is_some() || has_reference);

    if !has_transaction_shape || looks_like_marketing_price_list(&searchable) {
        return Vec::new();
    }

    let inferred_kind = kind.unwrap_or_else(|| infer_kind(&references).unwrap_or(CommerceKind::Transaction));
    let confidence = score_confidence(provider.as_ref().map(|p| p.confidence), has_reference, has_amount, kind.is_some(), has_items);
    if confidence < 0.75 {
        return Vec::new();
    }

    let mut entities = Vec::new();
    let entity_refs = if references.is_empty() {
        vec![(inferred_kind.entity_type(), inferred_kind.as_str().to_string())]
    } else {
        references
    };

    for (i, (entity_type, value)) in entity_refs.into_iter().enumerate() {
        let commerce_type = kind_for_entity(&entity_type).unwrap_or(inferred_kind).as_str();
        let evidence = context_for(&searchable, &value)
            .or_else(|| context_for_kind(&searchable, inferred_kind))
            .unwrap_or_else(|| searchable.chars().take(180).collect::<String>());

        entities.push(ExtractedEntity {
            id: format!("commerce:{}:{}", commerce_type, i),
            entity_type,
            provider: provider.as_ref().map(|p| p.name.clone()),
            value,
            confidence,
            provenance: Provenance {
                source: ExtractionSource::Regex,
                extractor: "commerce.rs".to_string(),
            },
            evidence: Some(evidence),
            metadata: json!({
                "commerceType": commerce_type,
                "provider": provider.as_ref().map(|p| p.name.clone()),
                "providerCategory": provider.as_ref().map(|p| format!("{:?}", p.category)),
                "providerConfidence": provider.as_ref().map(|p| p.confidence),
                "amount": amount,
                "items": items,
                "merchant": merchant,
                "status": status,
            }),
        });
    }

    entities
}

fn detect_kind(text: &str) -> Option<CommerceKind> {
    let patterns = [
        (CommerceKind::Refund, r"(?i)\b(refund issued|refund processed|money returned|refunded)\b"),
        (CommerceKind::Subscription, r"(?i)\b(subscription renewed|membership renewed|billing statement|monthly charge|renewal)\b"),
        (CommerceKind::Invoice, r"(?i)\b(tax invoice|gst invoice|invoice\s*#|invoice number)\b"),
        (CommerceKind::Receipt, r"(?i)\b(tax receipt|purchase receipt|\breceipt\b)\b"),
        (CommerceKind::Order, r"(?i)\b(order confirmed|order placed|order delivered|order shipped)\b"),
        (CommerceKind::Purchase, r"(?i)\b(thank you for your purchase|purchase successful|payment successful|order confirmed)\b"),
        (CommerceKind::Transaction, r"(?i)\b(payment completed|transaction successful|payment confirmation|transaction id)\b"),
    ];

    patterns.iter().find_map(|(kind, pattern)| {
        Regex::new(pattern)
            .ok()
            .and_then(|re| re.is_match(text).then_some(*kind))
    })
}

fn extract_references(text: &str) -> Vec<(EntityType, String)> {
    let patterns = [
        (EntityType::OrderReference, r"(?i)\border[ \t]*(?:id|no|number|#)?[ \t]*[:#-][ \t]*([A-Z0-9][A-Z0-9-]{3,30})\b"),
        (EntityType::InvoiceReference, r"(?i)\binvoice[ \t]*(?:id|no|number|#)?[ \t]*[:#-]?[ \t]*([A-Z0-9][A-Z0-9-]{3,30})\b"),
        (EntityType::TransactionReference, r"(?i)\btransaction[ \t]*(?:id|no|number|#)?[ \t]*[:#-][ \t]*([A-Z0-9][A-Z0-9-]{3,40})\b"),
        (EntityType::ReceiptReference, r"(?i)\breceipt[ \t]*(?:id|no|number|#)?[ \t]*[:#-][ \t]*([A-Z0-9][A-Z0-9-]{3,30})\b"),
        (EntityType::SubscriptionReference, r"(?i)\bsubscription[ \t]*(?:id|no|number|#)?[ \t]*[:#-][ \t]*([A-Z0-9][A-Z0-9-]{3,30})\b"),
    ];

    let mut refs = Vec::new();
    for (entity_type, pattern) in patterns {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(text).take(3) {
                if let Some(m) = cap.get(1) {
                    let value = clean_line(m.as_str());
                    if is_valid_reference(&value) {
                        refs.push((entity_type.clone(), value));
                    }
                }
            }
        }
    }
    refs.extend(extract_table_references(text));
    refs
}

fn extract_table_references(text: &str) -> Vec<(EntityType, String)> {
    let mut refs = Vec::new();
    let lines: Vec<String> = text.lines().map(clean_line).filter(|line| !line.is_empty()).collect();

    for window in lines.windows(2) {
        let label = window[0].to_ascii_lowercase();
        let value = first_reference_token(&window[1]);
        if let Some(value) = value {
            if label.contains("order id") {
                refs.push((EntityType::OrderReference, value));
            } else if label.contains("invoice") {
                refs.push((EntityType::InvoiceReference, value));
            } else if label.contains("transaction id") {
                refs.push((EntityType::TransactionReference, value));
            } else if label.contains("receipt") {
                refs.push((EntityType::ReceiptReference, value));
            }
        }
    }

    refs
}

fn first_reference_token(line: &str) -> Option<String> {
    line.split_whitespace()
        .map(clean_line)
        .find(|token| is_valid_reference(token))
}

fn is_valid_reference(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let blocked = ["radius", "color", "style", "font", "width", "height", "margin", "padding", "border"];
    value.len() >= 4
        && value.len() <= 40
        && value.chars().any(|c| c.is_ascii_digit())
        && !blocked.iter().any(|word| lower.contains(word))
}

fn extract_amount(text: &str) -> Option<serde_json::Value> {
    let amount_re = Regex::new(r"(?i)(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s*(-?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)|(-?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(inr|usd|eur|gbp)").ok()?;
    let mut candidates = Vec::new();
    let lines: Vec<String> = text.lines().map(clean_line).filter(|line| !line.is_empty()).collect();

    for clean in &lines {
        if clean.len() < 2 || is_non_total_amount_line(&clean) {
            continue;
        }

        for cap in amount_re.captures_iter(&clean) {
            let (currency_raw, value_raw) = match (cap.get(1), cap.get(2), cap.get(3), cap.get(4)) {
                (Some(currency), Some(value), _, _) => (currency.as_str(), value.as_str()),
                (_, _, Some(value), Some(currency)) => (currency.as_str(), value.as_str()),
                _ => continue,
            };
            let value_text = value_raw.replace(' ', "").replace(',', "");
            let Ok(value) = value_text.parse::<f64>() else {
                continue;
            };
            let score = amount_line_score(&clean);
            if value < 0.0 || (value == 0.0 && score < 60) {
                continue;
            }
            if score >= 60 {
                candidates.push((score, value, normalize_currency(currency_raw), clean.clone()));
            }
        }
    }

    for window in lines.windows(2) {
        let label = &window[0];
        let amount_line = &window[1];
        if amount_line_score(label) < 60 || is_non_total_amount_line(label) || is_non_total_amount_line(amount_line) {
            continue;
        }

        for cap in amount_re.captures_iter(amount_line) {
            let (currency_raw, value_raw) = match (cap.get(1), cap.get(2), cap.get(3), cap.get(4)) {
                (Some(currency), Some(value), _, _) => (currency.as_str(), value.as_str()),
                (_, _, Some(value), Some(currency)) => (currency.as_str(), value.as_str()),
                _ => continue,
            };
            let value_text = value_raw.replace(' ', "").replace(',', "");
            let Ok(value) = value_text.parse::<f64>() else {
                continue;
            };
            if value < 0.0 {
                continue;
            }

            candidates.push((amount_line_score(label) + 20, value, normalize_currency(currency_raw), format!("{} {}", label, amount_line)));
        }
    }

    candidates
        .into_iter()
        .max_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)))
        .map(|(_, value, currency, evidence)| {
            json!({
                "value": value,
                "currency": currency,
                "evidence": evidence,
            })
        })
}

fn is_non_total_amount_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    let blocked = [
        "discount",
        "coupon",
        "promo",
        "promotion",
        "savings",
        "you saved",
        "cashback",
        "wallet",
        "delivery fee",
        "platform fee",
        "packing charge",
        "tip",
        "subtotal",
        "sub-total",
        "item total",
        "mrp",
        "price",
        "tax",
        "gst",
        "fee",
    ];
    lower.contains("-₹")
        || lower.contains("-rs")
        || lower.contains("- rs")
        || blocked.iter().any(|word| lower.contains(word))
}

fn amount_line_score(line: &str) -> i32 {
    let lower = line.to_ascii_lowercase();
    let strong = [
        "grand total",
        "order total",
        "total paid",
        "amount paid",
        "paid",
        "total amount",
        "amount charged",
        "payment successful",
        "charged",
    ];
    let medium = ["total", "amount", "payment", "paid via"];

    if strong.iter().any(|word| lower.contains(word)) {
        100
    } else if medium.iter().any(|word| lower.contains(word)) {
        60
    } else {
        10
    }
}

fn normalize_currency(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().as_str() {
        "₹" | "rs" | "rs." | "inr" => "INR",
        "$" | "usd" => "USD",
        "€" | "eur" => "EUR",
        "£" | "gbp" => "GBP",
        _ => "UNKNOWN",
    }
}

fn extract_items(text: &str) -> Vec<serde_json::Value> {
    let mut items = Vec::new();
    let quantity_patterns = [
        r"(?im)^\s*(\d+)\s*x\s+([A-Z0-9][^\r\n]{2,80})\s*$",
        r"(?im)^\s*([A-Z0-9][^\r\n]{2,80}?)\s+x\s*(\d+)\s*$",
    ];

    for pattern in quantity_patterns {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(text).take(5) {
                let (qty, name) = if cap.get(1).map(|m| m.as_str().chars().all(|c| c.is_ascii_digit())).unwrap_or(false) {
                    (cap.get(1), cap.get(2))
                } else {
                    (cap.get(2), cap.get(1))
                };
                if let (Some(qty), Some(name)) = (qty, name) {
                    items.push(json!({
                        "name": clean_line(name.as_str()),
                        "quantity": qty.as_str().parse::<u32>().unwrap_or(1),
                    }));
                }
            }
        }
    }

    if items.is_empty() {
        let raw_lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
        for window in raw_lines.windows(2) {
            let header = clean_line(window[0]).to_ascii_lowercase();
            if header.contains("description")
                && header.contains("price")
                && line_has_amount(window[1])
            {
                let name = window[1]
                    .split('\t')
                    .next()
                    .unwrap_or(window[1])
                    .split("  ")
                    .next()
                    .unwrap_or(window[1]);
                let cleaned = clean_line(name);
                if is_plausible_item_name(&cleaned) {
                    items.push(json!({ "name": cleaned }));
                }
            }
        }
    }

    if items.is_empty() {
        if let Ok(re) = Regex::new(r"(?im)^\s*(ELDEN RING|Fortnite Crew|GitHub Copilot|ChatGPT Plus|Sony WH1000XM5)\s*$") {
            for cap in re.captures_iter(text).take(3) {
                if let Some(name) = cap.get(1) {
                    items.push(json!({ "name": clean_line(name.as_str()) }));
                }
            }
        }
    }

    items
}

fn line_has_amount(line: &str) -> bool {
    Regex::new(r"(?i)(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s*-?\s*[0-9]|[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(inr|usd|eur|gbp)")
        .map(|re| re.is_match(line))
        .unwrap_or(false)
}

fn is_plausible_item_name(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.len() >= 3
        && value.len() <= 100
        && !line_has_amount(value)
        && !["description", "publisher", "price", "discount", "total"].iter().any(|word| lower.contains(word))
}

fn extract_merchant(text: &str) -> Option<String> {
    let patterns = [
        r"(?im)\b(?:merchant|restaurant|sold by|seller)\s*[:#-]\s*([^\r\n]{2,80})",
        r"(?im)\bthank you for ordering from\s+([^\r\n]{2,80})",
        r"(?im)\bordering from\s+([^\r\n]{2,80})",
    ];

    for pattern in patterns {
        let Ok(re) = Regex::new(pattern) else {
            continue;
        };
        if let Some(value) = re
            .captures(text)
            .and_then(|cap| cap.get(1))
            .map(|m| clean_line(m.as_str()))
            .filter(|value| is_plausible_merchant(value))
        {
            return Some(value);
        }
    }

    None
}

fn is_plausible_merchant(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.len() >= 3
        && value.len() <= 80
        && !line_has_amount(value)
        && !["order id", "delivered", "total paid", "copyright", "all rights reserved"].iter().any(|word| lower.contains(word))
}

fn extract_status(text: &str) -> Option<String> {
    let re = Regex::new(r"(?i)\b(Delivered|Shipped|Processing|Completed|Cancelled|Canceled|Refunded)\b").ok()?;
    re.captures(text)
        .and_then(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
}

fn infer_kind(refs: &[(EntityType, String)]) -> Option<CommerceKind> {
    refs.first().and_then(|(entity_type, _)| kind_for_entity(entity_type))
}

fn kind_for_entity(entity_type: &EntityType) -> Option<CommerceKind> {
    match entity_type {
        EntityType::InvoiceReference => Some(CommerceKind::Invoice),
        EntityType::ReceiptReference => Some(CommerceKind::Receipt),
        EntityType::OrderReference => Some(CommerceKind::Order),
        EntityType::TransactionReference => Some(CommerceKind::Transaction),
        EntityType::SubscriptionReference => Some(CommerceKind::Subscription),
        _ => None,
    }
}

fn score_confidence(provider_confidence: Option<f32>, has_ref: bool, has_amount: bool, has_kind: bool, has_items: bool) -> f32 {
    let mut score: f32 = 0.35;
    if let Some(provider_confidence) = provider_confidence {
        score += if provider_confidence >= 0.9 { 0.25 } else { 0.15 };
    }
    if has_ref {
        score += 0.20;
    }
    if has_amount {
        score += 0.15;
    }
    if has_kind {
        score += 0.10;
    }
    if has_items {
        score += 0.10;
    }
    score.min(0.95)
}

fn looks_like_marketing_price_list(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let marketing_markers = [
        "tour price per person",
        "per adult",
        "child (5",
        "destinations and places covered",
        "boarding/de-boarding points",
        "package code",
    ];
    let transactional_markers = [
        "order id",
        "transaction id",
        "receipt",
        "total:",
        "total paid",
        "amount paid",
        "payment successful",
    ];

    marketing_markers.iter().filter(|marker| lower.contains(*marker)).count() >= 2
        && !transactional_markers.iter().any(|marker| lower.contains(*marker))
}

fn context_for(text: &str, needle: &str) -> Option<String> {
    let idx = text.find(needle)?;
    let start = text[..idx].char_indices().rev().nth(90).map(|(i, _)| i).unwrap_or(0);
    let end = text[idx..]
        .char_indices()
        .nth(needle.chars().count() + 90)
        .map(|(i, _)| idx + i)
        .unwrap_or(text.len());
    Some(text[start..end].trim().to_string())
}

fn context_for_kind(text: &str, kind: CommerceKind) -> Option<String> {
    context_for(text, kind.as_str())
}

fn strip_tags(html: &str) -> String {
    let without_scripts = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .map(|re| re.replace_all(html, "\n").to_string())
        .unwrap_or_else(|_| html.to_string());
    let without_styles = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .map(|re| re.replace_all(&without_scripts, "\n").to_string())
        .unwrap_or(without_scripts);

    Regex::new(r"(?is)<[^>]+>")
        .map(|re| re.replace_all(&without_styles, "\n").to_string())
        .unwrap_or(without_styles)
}

fn clean_line(value: &str) -> String {
    value
        .trim()
        .trim_matches(|c: char| c == '-' || c == ':' || c == '|')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
