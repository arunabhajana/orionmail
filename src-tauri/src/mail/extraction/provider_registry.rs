use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub enum ProviderCategory {
    FoodDelivery,
    Ecommerce,
    Gaming,
    Subscription,
    Travel,
    Payments,
    Retail,
    Unknown,
}

#[derive(Debug, Clone, Copy)]
pub struct Provider {
    pub name: &'static str,
    pub category: ProviderCategory,
    pub domains: &'static [&'static str],
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderDetection {
    pub name: String,
    pub category: ProviderCategory,
    pub confidence: f32,
    pub matched_domain: Option<String>,
}

const PROVIDERS: &[Provider] = &[
    Provider {
        name: "Steam",
        category: ProviderCategory::Gaming,
        domains: &["steampowered.com", "steamcommunity.com"],
    },
    Provider {
        name: "Epic Games",
        category: ProviderCategory::Gaming,
        domains: &["epicgames.com", "epicgames.dev"],
    },
    Provider {
        name: "Amazon",
        category: ProviderCategory::Ecommerce,
        domains: &["amazon.com", "amazon.in"],
    },
    Provider {
        name: "Zomato",
        category: ProviderCategory::FoodDelivery,
        domains: &["zomato.com"],
    },
    Provider {
        name: "Swiggy",
        category: ProviderCategory::FoodDelivery,
        domains: &["swiggy.com"],
    },
    Provider {
        name: "Netflix",
        category: ProviderCategory::Subscription,
        domains: &["netflix.com"],
    },
    Provider {
        name: "Spotify",
        category: ProviderCategory::Subscription,
        domains: &["spotify.com"],
    },
    Provider {
        name: "GitHub",
        category: ProviderCategory::Subscription,
        domains: &["github.com"],
    },
    Provider {
        name: "Razorpay",
        category: ProviderCategory::Payments,
        domains: &["razorpay.com"],
    },
    Provider {
        name: "PayPal",
        category: ProviderCategory::Payments,
        domains: &["paypal.com"],
    },
];

pub fn detect_provider(headers_and_text: &str, body_text: &str) -> Option<ProviderDetection> {
    detect_from_sender_headers(headers_and_text)
        .or_else(|| detect_from_text(headers_and_text, 0.75, true))
        .or_else(|| detect_from_text(body_text, 0.60, false))
}

fn detect_from_sender_headers(text: &str) -> Option<ProviderDetection> {
    let header_block = text.lines().take(80).collect::<Vec<_>>().join("\n");
    let Ok(email_re) = Regex::new(
        r"(?im)^(from|sender|reply-to|return-path)\s*:\s*.*?([A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}))",
    ) else {
        return None;
    };

    for cap in email_re.captures_iter(&header_block) {
        if let Some(domain) = cap.get(3).map(|m| m.as_str().to_ascii_lowercase()) {
            if let Some(provider) = provider_for_domain(&domain) {
                return Some(ProviderDetection {
                    name: provider.name.to_string(),
                    category: provider.category,
                    confidence: 0.95,
                    matched_domain: Some(domain),
                });
            }
        }
    }

    None
}

fn detect_from_text(text: &str, confidence: f32, allow_name_match: bool) -> Option<ProviderDetection> {
    let lower = text.to_ascii_lowercase();
    for provider in PROVIDERS {
        for domain in provider.domains {
            if lower.contains(domain)
                || (allow_name_match && lower.contains(&provider.name.to_ascii_lowercase()))
            {
                return Some(ProviderDetection {
                    name: provider.name.to_string(),
                    category: provider.category,
                    confidence,
                    matched_domain: Some((*domain).to_string()),
                });
            }
        }
    }
    None
}

fn provider_for_domain(domain: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|provider| {
        provider
            .domains
            .iter()
            .any(|known| domain == *known || domain.ends_with(&format!(".{}", known)))
    })
}
