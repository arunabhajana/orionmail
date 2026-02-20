mod auth;
mod commands;
mod mail;

use crate::commands::auth_commands::*;
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
        }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
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
      get_cached_messages
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
