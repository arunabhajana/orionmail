//! Keep speculative work and WebView2 memory targets in step with the window.
use std::sync::atomic::{AtomicBool, Ordering};

static DISPLAYED: AtomicBool = AtomicBool::new(false);
static INITIALIZED: AtomicBool = AtomicBool::new(false);

pub fn is_displayed() -> bool {
    DISPLAYED.load(Ordering::Relaxed)
}

pub fn refresh(window: &tauri::WebviewWindow) {
    let displayed = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(true);
    let changed = DISPLAYED.swap(displayed, Ordering::Relaxed) != displayed;
    if INITIALIZED.swap(true, Ordering::Relaxed) && !changed {
        return;
    }
    // Wake an idle worker so it discards queued speculative jobs immediately
    // when hidden, without waiting for another mail request.
    if !displayed {
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
