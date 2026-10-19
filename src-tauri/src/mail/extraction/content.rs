//! Visible mail text is evidence; source markup and hidden preheaders are not.
use kuchikiki::{traits::TendrilSink, NodeRef};

pub struct Content {
    pub text: String,
    pub links: Vec<(String, String)>,
}

pub fn parse(html: &str) -> Content {
    let mut end = html.len().min(2 * 1024 * 1024);
    while !html.is_char_boundary(end) { end -= 1; }
    let document = kuchikiki::parse_html().one(&html[..end]).document_node;
    let mut content = Content { text: String::new(), links: Vec::new() };
    visit(&document, &mut content, 0);
    content.text = content.text.replace(['\u{200b}', '\u{200c}', '\u{200d}', '\u{feff}'], "").lines().map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n");
    content
}

fn visit(node: &NodeRef, content: &mut Content, depth: usize) {
    if depth > 100 || content.text.len() >= 250_000 { return; }
    let mut block = false;
    let mut link = None;
    let text_start = content.text.len();
    if let Some(element) = node.as_element() {
        let tag = element.name.local.as_ref();
        if matches!(tag, "head" | "style" | "script" | "template" | "noscript" | "svg" | "math" | "iframe" | "object" | "blockquote") { return; }
        let attributes = element.attributes.borrow();
        if attributes.get("class").is_some_and(|value| value.split_whitespace().any(|name| matches!(name, "gmail_quote" | "yahoo_quoted" | "protonmail_quote"))) { return; }
        let style = attributes.get("style").unwrap_or("").split_whitespace().collect::<String>().to_ascii_lowercase();
        if attributes.contains("hidden") || attributes.get("aria-hidden") == Some("true")
            || style.contains("display:none") || style.contains("visibility:hidden")
            || style.split(';').any(|rule| rule == "opacity:0" || rule.starts_with("max-height:0")) { return; }
        if matches!(tag, "pre" | "code") {
            let sample = node.text_contents();
            if sample.contains('{') || sample.contains('}') || sample.contains("<style")
                || sample.contains("=>") || sample.contains("function ")
                || (tag == "code" && sample.contains([':', '=', ';']))
                || crate::mail::patterns::regex(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?/?>").unwrap().is_match(&sample) { return; }
        }
        block = matches!(tag, "p" | "div" | "br" | "tr" | "td" | "th" | "li" | "h1" | "h2" | "h3" | "section" | "table");
        if block { content.text.push('\n'); }
        if tag == "a" && content.links.len() < 100 {
            if let Some(raw) = attributes.get("href") {
                if let Ok(url) = url::Url::parse(raw.trim()) {
                    if url.scheme() == "https" && url.has_host() && url.username().is_empty() && url.password().is_none()
                        && raw.len() <= 8192 && !raw.chars().any(char::is_control) {
                        link = Some(url.to_string());
                    }
                }
            }
        }
    }
    if let Some(text) = node.as_text() {
        let text = text.borrow();
        let mut end = text.len().min(250_000 - content.text.len());
        while !text.is_char_boundary(end) { end -= 1; }
        content.text.push_str(&text[..end]);
    }
    for child in node.children() { visit(&child, content, depth + 1); }
    if block { content.text.push('\n'); }
    if let Some(url) = link {
        let label = content.text[text_start..].split_whitespace().collect::<Vec<_>>().join(" ");
        if content.links.len() < 100 { content.links.push((url, label.chars().take(160).collect())); }
    }
}
