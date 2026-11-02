use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use once_cell::sync::Lazy;
use tokio::time::Duration;

struct TrayState {
    unread_count: u32,
    last_sync_timestamp: Option<i64>,
}

static STATE: Lazy<Mutex<TrayState>> = Lazy::new(|| Mutex::new(TrayState {
    unread_count: 0,
    last_sync_timestamp: None,
}));

pub fn init_from_db(app: &AppHandle) {
    let mut state = STATE.lock().unwrap();
    state.unread_count = 0;
    state.last_sync_timestamp = None;
    if let Some(account) = crate::auth::session::get_active_profile(app) {
        if let Ok(db_state) = crate::mail::database::get_global_sync_state(app, &account.id) {
            state.last_sync_timestamp = db_state.last_sync_at;
        }
        if let Ok(count) = crate::mail::database::get_global_unread_count(app, &account.id) {
            state.unread_count = count;
        }
    }
}

pub fn refresh_unread_count_from_db(app: &AppHandle) {
    if let Some(account) = crate::auth::session::get_active_profile(app) {
        if let Ok(count) = crate::mail::database::get_global_unread_count(app, &account.id) {
            {
                let mut state = STATE.lock().unwrap();
                state.unread_count = count;
            }
            update_tray_now(app);
        }
    } else {
        let mut state = STATE.lock().unwrap();
        state.unread_count = 0;
        state.last_sync_timestamp = None;
        drop(state);
        update_tray_now(app);
    }
}

pub fn set_last_sync_time(app: &AppHandle, account_id: &str) {
    if crate::auth::session::get_active_profile(app).map(|account| account.id) == Some(account_id.to_string()) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        {
            let mut state = STATE.lock().unwrap();
            state.last_sync_timestamp = Some(now);
        }
        update_tray_now(app);
    }
}

fn format_time_ago(timestamp: Option<i64>) -> String {
    if let Some(ts) = timestamp {
        if ts == 0 {
            return "Never synced".to_string();
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let diff = now.saturating_sub(ts);
        
        if diff < 60 {
            "just now".to_string()
        } else if diff < 3600 {
            let mins = diff / 60;
            format!("{} min ago", mins)
        } else if diff < 86400 {
            let hours = diff / 3600;
            format!("{} hour{} ago", hours, if hours == 1 { "" } else { "s" })
        } else {
            let days = diff / 86400;
            format!("{} day{} ago", days, if days == 1 { "" } else { "s" })
        }
    } else {
        "Never synced".to_string()
    }
}

pub fn update_tray_now(app: &AppHandle) {
    let (count, ts) = {
        let state = STATE.lock().unwrap();
        (state.unread_count, state.last_sync_timestamp)
    };
    update_taskbar_badge(app,count);
    
    if let Some(tray) = app.tray_by_id("main") {
        let time_str = format_time_ago(ts);
        
        let text = format!(
            "OrionMail\n{} unread email{}\nLast synced {}",
            count,
            if count == 1 { "" } else { "s" },
            time_str
        );
        let _ = tray.set_tooltip(Some(text));
    }
}

fn update_taskbar_badge(app:&AppHandle,count:u32){
    use std::sync::atomic::{AtomicU32,Ordering};
    static LAST:AtomicU32=AtomicU32::new(u32::MAX);
    let count=if crate::mail_preferences::load(app).taskbar_badge {count}else{0};
    if let Some(window)=app.get_webview_window("main"){
        if LAST.load(Ordering::Relaxed)==count{return;}
        #[cfg(target_os="windows")]
        let result=window.set_overlay_icon(if count==0{None}else{Some(tauri::image::Image::new_owned(badge_pixels(count),32,32))});
        #[cfg(not(target_os="windows"))]
        let result=window.set_badge_count(if count==0{None}else{Some(count as i64)});
        if result.is_ok(){LAST.store(count,Ordering::Relaxed);}
        else if let Err(error)=result{log::debug!("Taskbar badge unavailable: {}",error);}
    }
}

fn badge_pixels(count:u32)->Vec<u8>{
    let mut pixels=vec![0;32*32*4];
    for y in 0..32i32{for x in 0..32i32{if (x-16).pow(2)+(y-16).pow(2)<=225{
        let i=((y*32+x)*4)as usize;pixels[i..i+4].copy_from_slice(&[39,123,241,255]);
    }}}
    let text=if count>99{"99+".to_string()}else{count.to_string()};
    let glyphs:[&str;11]=["111101101101111","010110010010111","111001111100111","111001111001111","101101111001001","111100111001111","111100111101111","111001010010010","111101111101111","111101111001111","000010111010000"];
    let scale=if text.len()>2{2}else{3};let width=text.len()*(3*scale+scale)-scale;
    let start=(32-width)/2;let top=(32-5*scale)/2;
    for (n,ch)in text.chars().enumerate(){let glyph=glyphs[if ch=='+'{10}else{ch.to_digit(10).unwrap_or(0)as usize}];
        for (cell,value)in glyph.bytes().enumerate(){if value==b'1'{for dy in 0..scale{for dx in 0..scale{
            let x=start+n*4*scale+cell%3*scale+dx;let y=top+cell/3*scale+dy;
            let i=(y*32+x)*4;pixels[i..i+4].copy_from_slice(&[255,255,255,255]);
        }}}}
    }
    pixels
}

#[cfg(test)]
mod badge_tests{
    use super::*;
    #[test]fn unread_overlay_is_bounded_and_transparent_outside_circle(){for count in [1,9,10,99,100,u32::MAX]{let image=badge_pixels(count);assert_eq!(image.len(),4096);assert_eq!(image[3],0);assert!(image.chunks_exact(4).any(|pixel|pixel==[255,255,255,255]));}}
}

pub fn spawn_tray_update_loop(app: AppHandle) {
    init_from_db(&app);
    update_tray_now(&app);
    
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        let mut notifications_allowed = crate::mail_preferences::load(&app).notifications_allowed();
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    update_tray_now(&app);
                    let allowed = crate::mail_preferences::load(&app).notifications_allowed();
                    if allowed != notifications_allowed {
                        notifications_allowed = allowed;
                        crate::mail::notifications::refresh_policy(&app);
                    }
                }
                _ = crate::mail::shutdown::TRAY_TOKEN.cancelled() => {
                    break;
                }
            }
        }
    });
}
