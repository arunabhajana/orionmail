use dashmap::DashMap;
use once_cell::sync::Lazy;
use std::time::Instant;

const MAX_CACHE_SIZE: usize = 50;

struct CachedBody {
    html: String,
    last_access: Instant,
}

static CACHE: Lazy<DashMap<u32, CachedBody>> = Lazy::new(|| DashMap::new());

pub fn get_cached_body(uid: u32) -> Option<String> {
    if let Some(mut entry) = CACHE.get_mut(&uid) {
        entry.last_access = Instant::now();
        Some(entry.html.clone())
    } else {
        None
    }
}

pub fn insert_cached_body(uid: u32, html: String) {
    // Check if we need to evict LRU
    if CACHE.len() >= MAX_CACHE_SIZE && !CACHE.contains_key(&uid) {
        let lru_key = {
            CACHE
                .iter()
                .min_by_key(|entry| entry.last_access)
                .map(|entry| *entry.key())
        };

        if let Some(key) = lru_key {
            CACHE.remove(&key);
        }
    }

    CACHE.insert(
        uid,
        CachedBody {
            html,
            last_access: Instant::now(),
        },
    );
}
