//! Keep speculative work and WebView2 memory targets in step with the window.
use std::sync::atomic::{AtomicBool, Ordering};

static DISPLAYED: AtomicBool = AtomicBool::new(false);
static FOCUSED: AtomicBool = AtomicBool::new(false);
static INITIALIZED: AtomicBool = AtomicBool::new(false);
static VISIBLE: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub async fn wait_until_displayed() {
    loop {
        let changed = VISIBLE.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        if is_displayed() { return; }
        changed.await;
    }
}



pub fn is_displayed() -> bool {
    DISPLAYED.load(Ordering::Relaxed)
}

pub fn is_foreground() -> bool { is_displayed() && FOCUSED.load(Ordering::Relaxed) }

pub fn refresh(window: &tauri::WebviewWindow) {
    let displayed = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(true);
    let focused = window.is_focused().unwrap_or(false);
    let focus_changed = FOCUSED.swap(focused, Ordering::Relaxed) != focused;
    let changed = DISPLAYED.swap(displayed, Ordering::Relaxed) != displayed || focus_changed;
    if INITIALIZED.swap(true, Ordering::Relaxed) && !changed {
        return;
    }
    if displayed { VISIBLE.notify_waiters(); }
    // Wake an idle worker so it discards queued speculative jobs immediately
    // when hidden, without waiting for another mail request.
    if !displayed || !focused {
        crate::mail::body_prefetch_manager::PREFETCH_MANAGER.notify.notify_one();
    }
    // This is a cache/memory hint, not suspension: compose state, sync, native
    // notification actions and queued provider operations continue to work.
    #[cfg(target_os = "windows")]
    if let Err(error) = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core_webview::Interface;
        let result = (|| unsafe {
            let core = webview.controller().CoreWebView2()?;
            let core: ICoreWebView2_19 = core.cast()?;
            core.SetMemoryUsageTargetLevel(if is_displayed() {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            })
        })();
        if let Err(error) = result {
            // Older WebView2 runtimes may not support this optional hint.
            log::debug!("WebView2 memory target unavailable: {error}");
        }
    }) {
        log::debug!("Could not update WebView2 memory target: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn hidden_history_sleeps_and_all_waiters_resume_on_show() {
        DISPLAYED.store(false, Ordering::Relaxed);
        assert!(tokio::time::timeout(std::time::Duration::from_millis(10), wait_until_displayed()).await.is_err());
        let resume = async {
            tokio::task::yield_now().await;
            DISPLAYED.store(true, Ordering::Relaxed);
            VISIBLE.notify_waiters();
        };
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            tokio::join!(wait_until_displayed(), wait_until_displayed(), resume);
        }).await.unwrap();
        DISPLAYED.store(false, Ordering::Relaxed);
    }
}
