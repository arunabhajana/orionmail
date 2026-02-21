use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const MAX_CACHE_SIZE: usize = 50;

struct CachedBody {
    html: String,
    last_access: Instant,
}

static CACHE: OnceLock<Mutex<HashMap<u32, CachedBody>>> = OnceLock::new();

fn get_cache() -> &'static Mutex<HashMap<u32, CachedBody>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn get_cached_body(uid: u32) -> Option<String> {
    let mut cache = get_cache().lock().unwrap();
    if let Some(entry) = cache.get_mut(&uid) {
        entry.last_access = Instant::now();
        Some(entry.html.clone())
    } else {
        None
    }
}

pub fn insert_cached_body(uid: u32, html: String) {
    let mut cache = get_cache().lock().unwrap();

    // Check if we need to evict LRU
    if cache.len() >= MAX_CACHE_SIZE && !cache.contains_key(&uid) {
        if let Some(lru_key) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.last_access)
            .map(|(k, _)| *k)
        {
            cache.remove(&lru_key);
        }
    }

    cache.insert(
        uid,
        CachedBody {
            html,
            last_access: Instant::now(),
        },
    );
}
