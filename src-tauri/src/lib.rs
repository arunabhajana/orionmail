mod auth;
mod commands;
mod mail;
mod contacts;
mod config;
pub mod tray_state;

use crate::commands::auth_commands::*;
use crate::commands::message_commands::*;
use crate::contacts::contact_search::search_contacts;
use tauri::{Manager, Emitter};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;

use crate::config::{AppSettings, get_app_settings, set_app_settings, was_launched_minimized};
use tauri_plugin_autostart::MacosLauncher;


#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let (min_to_tray, start_hidden) = config::load_settings(app.handle());
      app.manage(AppSettings { 
          minimize_to_tray: Mutex::new(min_to_tray),
          start_hidden: Mutex::new(start_hidden),
      });

      let show_i = MenuItem::with_id(app, "show", "Show Orion Mail", true, None::<&str>)?;
      let compose_i = MenuItem::with_id(app, "compose", "Compose Email", true, None::<&str>)?;
      let sync_i = MenuItem::with_id(app, "sync", "Sync Now", true, None::<&str>)?;
      let sep1 = PredefinedMenuItem::separator(app)?;
      let pause_i = MenuItem::with_id(app, "pause", "Pause Sync (15 min)", false, None::<&str>)?;
      let sep2 = PredefinedMenuItem::separator(app)?;
      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

      let menu = Menu::with_items(app, &[
          &show_i, &compose_i, &sync_i, &sep1, &pause_i, &sep2, &quit_i
      ])?;

      let _tray = TrayIconBuilder::with_id("main")
          .icon(app.default_window_icon().unwrap().clone())
          .menu(&menu)
          .tooltip("Orion Mail")
          .on_menu_event(move |app_handle, event| {
              match event.id.as_ref() {
                  "quit" => {
                      log::info!("Quit requested from tray.");
                      app_handle.exit(0);
                  }
                  "show" => {
                      if let Some(window) = app_handle.get_webview_window("main") {
                          window.show().unwrap();
                          window.unminimize().unwrap();
                          window.set_focus().unwrap();
                      }
                  }
                  "compose" => {
                      if let Some(window) = app_handle.get_webview_window("main") {
                          window.show().unwrap();
                          window.unminimize().unwrap();
                          window.set_focus().unwrap();
                          window.emit("tray:compose", ()).ok();
                      }
                  }
                  "sync" => {
                      app_handle.emit("tray:sync_now", ()).ok();
                  }
                  _ => {}
              }
          })
          .on_tray_icon_event(|tray, event| {
              if let TrayIconEvent::DoubleClick { .. } = event {
                  if let Some(window) = tray.app_handle().get_webview_window("main") {
                      if window.is_visible().unwrap_or(false) {
                          window.hide().unwrap();
                      } else {
                          window.show().unwrap();
                          window.unminimize().unwrap();
                          window.set_focus().unwrap();
                      }
                  }
              }
          })
          .build(app)?;

      // Apply Mica window effect on Windows
      #[cfg(target_os = "windows")]
      {
        if let Some(window) = app.get_webview_window("main") {
          apply_mica(&window, None).ok();
          
          let app_handle = window.app_handle().clone();
          let window_clone = window.clone();
          
          // Initial Window Visibility Logic
          let launched_with_minimized = was_launched_minimized();
          if launched_with_minimized && start_hidden {
              window.hide().unwrap();
          } else {
              window.show().unwrap();
          }

          window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
              let state = app_handle.state::<AppSettings>();
              let minimize = *state.minimize_to_tray.lock().unwrap();
              if minimize {
                  log::info!("Window close intercepted. Hiding window to run in background.");
                  api.prevent_close();
                  window_clone.hide().unwrap();
                  window_clone.emit("window:hidden", ()).ok();
              } else {
                  log::info!("App closing permanently.");
                  crate::mail::idle::stop_idle_listener();
                  crate::mail::poll::stop_polling();
              }
            }
          });
        }
      }

      // Always register logging — in dev logs go to stdout,
      // in release they go to the OS app log directory so production failures are diagnosable.
      #[cfg(debug_assertions)]
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;

      #[cfg(not(debug_assertions))]
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("orbitmail".into()) }))
          .build(),
      )?;

      
      app.handle().plugin(tauri_plugin_dialog::init())?;
      app.handle().plugin(tauri_plugin_notification::init())?;
      app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))?;

      if let Ok(cache_dir) = app.handle().path().app_cache_dir() {
        let inline_dir = cache_dir.join("orbitmail_inline");
        let _ = std::fs::remove_dir_all(&inline_dir);
      }

      crate::mail::database::init_db(app.handle())?;
      crate::contacts::contact_store::init_contacts_db(app.handle())?;

      crate::tray_state::spawn_tray_update_loop(app.handle().clone());

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
      sync_mail_folder,
      get_folder_messages,
      get_message_body,
      get_messages_page,
      mark_as_read,
      prefetch_messages,
      toggle_read,
      toggle_star,
      delete_message,
      download_attachment,
      show_in_folder,
      show_main_window,
      send_message,
      search_contacts,
      get_unread_counts,
      get_sync_diagnostics,
      get_app_settings,
      set_app_settings,
      was_launched_minimized,
      get_attachment_metadata,
      open_url
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
