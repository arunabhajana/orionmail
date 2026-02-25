mod auth;
mod commands;
mod mail;

use crate::commands::auth_commands::*;
use crate::commands::message_commands::*;
use tauri::Manager;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Apply Mica window effect on Windows
      #[cfg(target_os = "windows")]
      {
        if let Some(window) = app.get_webview_window("main") {
          apply_mica(&window, None).ok();
          
          window.on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
              log::info!("App closing: Stopping IMAP IDLE and Polling listeners...");
              crate::mail::idle::stop_idle_listener();
              crate::mail::poll::stop_polling();
            }
          });
        }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if let Ok(cache_dir) = app.handle().path().app_cache_dir() {
        let inline_dir = cache_dir.join("orbitmail_inline");
        let _ = std::fs::remove_dir_all(&inline_dir);
      }

      crate::mail::database::init_db(app.handle())?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      login_google,
      get_current_user,
      list_accounts,
      logout_user,
      bootstrap_accounts,
      get_mailboxes,
      get_inbox_messages,
      get_cached_messages,
      sync_inbox,
      get_message_body,
      get_messages_page,
      mark_as_read,
      toggle_star,
      delete_message
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
