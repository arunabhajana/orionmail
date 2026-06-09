use once_cell::sync::Lazy;
use tokio_util::sync::CancellationToken;

pub static APP_TOKEN: Lazy<CancellationToken> = Lazy::new(|| CancellationToken::new());

pub static IDLE_TOKEN: Lazy<CancellationToken> = Lazy::new(|| APP_TOKEN.child_token());
pub static POLL_TOKEN: Lazy<CancellationToken> = Lazy::new(|| APP_TOKEN.child_token());
pub static PREFETCH_TOKEN: Lazy<CancellationToken> = Lazy::new(|| APP_TOKEN.child_token());
pub static TRAY_TOKEN: Lazy<CancellationToken> = Lazy::new(|| APP_TOKEN.child_token());

pub fn trigger_shutdown() {
    log::info!("Global shutdown triggered");
    APP_TOKEN.cancel();
}
