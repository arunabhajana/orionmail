mod auth;
mod commands;
mod mail;
mod contacts;

use crate::commands::auth_commands::*;
use crate::commands::message_commands::*;
use crate::contacts::contact_search::search_contacts;
use tauri::{Manager, Emitter};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;

struct TraySettings {
    minimize_to_tray: Mutex<bool>,
}

#[tauri::command]
fn set_minimize_to_tray(app_handle: tauri::AppHandle, minimize: bool) {
    let state = app_handle.state::<TraySettings>();
    *state.minimize_to_tray.lock().unwrap() = minimize;
}

#[tauri::command]
fn update_tray_tooltip(app_handle: tauri::AppHandle, count: u32) {
    if let Some(tray) = app_handle.tray_by_id("main") {
        let text = if count > 0 {
            format!("Orion Mail ({} unread)", count)
        } else {
            "Orion Mail".to_string()
        };
        let _ = tray.set_tooltip(Some(text));
    }
}

#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      app.manage(TraySettings { minimize_to_tray: Mutex::new(true) });

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
          window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
              let state = app_handle.state::<TraySettings>();
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

      if let Ok(cache_dir) = app.handle().path().app_cache_dir() {
        let inline_dir = cache_dir.join("orbitmail_inline");
        let _ = std::fs::remove_dir_all(&inline_dir);
      }

      crate::mail::database::init_db(app.handle())?;
      crate::contacts::contact_store::init_contacts_db(app.handle())?;

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
      set_minimize_to_tray,
      update_tray_tooltip
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
