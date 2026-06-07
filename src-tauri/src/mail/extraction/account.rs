use super::ExtractedEntity;
use regex::Regex;

pub fn extract(_html: &str, text: &str) -> Vec<ExtractedEntity> {
    let entities = Vec::new();
    
    let patterns = vec![
        (r"(?i)\b(?:reset|forgot)\s+password\b", "PasswordReset"),
        (r"(?i)\bverify\s+(?:your\s+)?email\b", "EmailVerification"),
        (r"(?i)\bnew\s+(?:device|sign-in|login)\b", "NewSignIn"),
    ];

    for (_i, (p, _subtype)) in patterns.iter().enumerate() {
        if let Ok(re) = Regex::new(p) {
            if let Some(_m) = re.find(text) {
                // Return a generic "Link" type or a specific Account type?
                // The instructions said AccountAction is classified by frontend, so we can just emit an entity type
                // Wait, EntityType doesn't have AccountAction anymore. The frontend classifies based on Link or Code or SchemaOrg.
                // If it's just detecting the presence of these keywords, maybe we don't extract an entity here, 
                // or we extract a dummy EntityType::Code. Let's not extract it as a separate entity if the frontend uses context (subject/sender).
                // Actually, the user asked for: "AccountActionDetector: Contextual heuristic for Verify/Sign In, issues SECURITY actions."
                // So the frontend will do it based on DetectorContext (subject, sender). We don't necessarily need to extract an entity here.
                // Let's just return empty for now, the frontend will handle it.
            }
        }
    }
    
    entities
}
