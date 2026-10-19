//! Reuse application-owned patterns; mail content never becomes a cache key.
use once_cell::sync::Lazy;
use regex::Regex;
use std::{collections::HashMap, sync::{Arc, Mutex}};

type Compiled = Result<Arc<Regex>, Arc<regex::Error>>;
static PATTERNS: Lazy<Mutex<HashMap<&'static str, Compiled>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn regex(pattern: &'static str) -> Compiled {
    let mut patterns = PATTERNS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    patterns.entry(pattern).or_insert_with(|| {
        Regex::new(pattern).map(Arc::new).map_err(Arc::new)
    }).clone()
}
