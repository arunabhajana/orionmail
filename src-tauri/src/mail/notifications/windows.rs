//! Unpackaged Win32 registration plus a COM activator: buttons keep working in
//! Action Center and can launch the installed app after it has exited.
mod shortcut;
use super::{xml, Batch};
use ::windows::{
    core::{implement, IUnknown, Interface, GUID, HSTRING, PCWSTR},
    Data::Xml::Dom::XmlDocument,
    Win32::{
        Foundation::{BOOL, CLASS_E_NOAGGREGATION, ERROR_NOT_FOUND, RPC_E_CHANGED_MODE},
        System::{
            Com::{
                CoRegisterClassObject, IClassFactory, IClassFactory_Impl, CLSCTX_LOCAL_SERVER,
                REGCLS_MULTIPLEUSE,
            },
            WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
        UI::{
            Notifications::{
                INotificationActivationCallback, INotificationActivationCallback_Impl,
                NOTIFICATION_USER_INPUT_DATA,
            },
            Shell::SetCurrentProcessExplicitAppUserModelID,
        },
    },
    UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
};
use once_cell::sync::OnceCell;
use std::{ffi::c_void, path::PathBuf};
use tauri::{AppHandle, Manager};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const DEV_ID: &str = "com.orionmail.app.dev";
const PROD_ID: &str = "com.orionmail.app";
const DEV_CLSID: GUID = GUID::from_u128(0x273fdab9_39ac_44f7_9b41_7d29e76bd218);
const PROD_CLSID: GUID = GUID::from_u128(0xb2b7cbd7_8182_454f_a980_303023e9d58e);
static ICON: OnceCell<PathBuf> = OnceCell::new();
fn is_missing_entry(error: &::windows::core::Error) -> bool {
    error.code() == ::windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0)
}
fn native_error(operation: &str, error: ::windows::core::Error) -> String {
    format!("Windows notifications ({}, {operation}): {error}", app_id())
}
fn app_id() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_ID
    } else {
        PROD_ID
    }
}
struct Apartment(bool);
impl Apartment {
    fn enter() -> Result<Self, String> {
        match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
            Ok(()) => Ok(Self(true)),
            Err(e) if e.code() == RPC_E_CHANGED_MODE => Ok(Self(false)),
            Err(e) => Err(e.to_string()),
        }
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { RoUninitialize() };
        }
    }
}

#[implement(INotificationActivationCallback)]
struct Activator {
    app: AppHandle,
}
impl INotificationActivationCallback_Impl for Activator_Impl {
    fn Activate(
        &self,
        appid: &PCWSTR,
        args: &PCWSTR,
        _data: *const NOTIFICATION_USER_INPUT_DATA,
        _count: u32,
    ) -> ::windows::core::Result<()> {
        // Windows supplies null-terminated strings. Bound argument scanning
        // before converting, and accept only our registered application ID.
        unsafe {
            if appid.is_null() || args.is_null() {
                return Ok(());
            }
            let bounded = |value: PCWSTR, max: usize| -> Option<String> {
                for len in 0..max {
                    if *value.0.add(len) == 0 {
                        return String::from_utf16(std::slice::from_raw_parts(value.0, len)).ok();
                    }
                }
                None
            };
            if bounded(*appid, 128).as_deref() != Some(app_id()) {
                return Ok(());
            }
            if let Some(args) = bounded(*args, 128) {
                super::receive(&self.app, &args);
            }
        }
        Ok(())
    }
}
#[implement(IClassFactory)]
struct Factory {
    app: AppHandle,
}
impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Option<&IUnknown>,
        iid: *const GUID,
        object: *mut *mut c_void,
    ) -> ::windows::core::Result<()> {
        if outer.is_some() {
            return Err(::windows::core::Error::from_hresult(CLASS_E_NOAGGREGATION));
        }
        let activation: INotificationActivationCallback = Activator {
            app: self.app.clone(),
        }
        .into();
        unsafe { activation.query(iid, object).ok() }
    }
    fn LockServer(&self, _lock: BOOL) -> ::windows::core::Result<()> {
        Ok(())
    }
}

type Work = Box<dyn FnOnce() + Send>;
static WORKER: OnceCell<std::sync::mpsc::SyncSender<Work>> = OnceCell::new();
static APP: OnceCell<AppHandle> = OnceCell::new();
thread_local! {
    static NOTIFIER: std::cell::RefCell<Option<::windows::UI::Notifications::ToastNotifier>> = const { std::cell::RefCell::new(None) };
    static TOASTS: std::cell::RefCell<std::collections::HashMap<String,ToastNotification>> = std::cell::RefCell::new(std::collections::HashMap::new());
}
struct Registration {
    _apartment: Apartment,
    _factory: IClassFactory,
    cookie: u32,
}
impl Drop for Registration {
    fn drop(&mut self) {
        let _ = unsafe { ::windows::Win32::System::Com::CoRevokeClassObject(self.cookie) };
    }
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    let (sender, jobs) = std::sync::mpsc::sync_channel::<Work>(32);
    WORKER
        .set(sender)
        .map_err(|_| "Notification worker already started")?;
    let (ready, receiver) = std::sync::mpsc::sync_channel(1);
    let app = app.clone();
    std::thread::Builder::new()
        .name("windows-notifications".into())
        .spawn(move || {
            let started = std::time::Instant::now();
            match register(&app) {
                Ok(_registration) => {
                    log::info!(
                        "{} native notification registration ready in {} ms",
                        super::display_name(),
                        started.elapsed().as_millis()
                    );
                    let _ = ready.send(Ok(()));
                    for job in jobs {
                        job();
                    }
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| format!("Windows notification registration timed out: {e}"))?
}
fn execute<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, result) = std::sync::mpsc::sync_channel(1);
    WORKER
        .get()
        .ok_or("Windows notifications are not initialized")?
        .try_send(Box::new(move || {
            let _ = sender.send(job());
        }))
        .map_err(|e| format!("Windows notification worker unavailable: {e}"))?;
    result
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Windows notification service did not respond: {e}"))?
}
fn register(app: &AppHandle) -> Result<Registration, String> {
    let apartment = Apartment::enter()?;

    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("notification-assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let icon = dir.join(if cfg!(debug_assertions) {
        "orionmail-dev.png"
    } else {
        "orionmail.png"
    });
    let bytes: &[u8] = if cfg!(debug_assertions) {
        include_bytes!("../../../icons/notification-dev.png")
    } else {
        include_bytes!("../../../icons/notification.png")
    };
    if std::fs::read(&icon).ok().as_deref() != Some(bytes) {
        std::fs::write(&icon, bytes).map_err(|e| e.to_string())?;
    }
    let _ = ICON.set(icon.clone());
    let clsid = if cfg!(debug_assertions) {
        DEV_CLSID
    } else {
        PROD_CLSID
    };
    let clsid_string = if cfg!(debug_assertions) {
        "{273FDAB9-39AC-44F7-9B41-7D29E76BD218}"
    } else {
        "{B2B7CBD7-8182-454F-A980-303023E9D58E}"
    };
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = root
        .create_subkey(format!("Software\\Classes\\AppUserModelId\\{}", app_id()))
        .map_err(|e| e.to_string())?;
    key.set_value("DisplayName", &super::display_name())
        .map_err(|e| e.to_string())?;
    key.set_value("IconUri", &icon.to_string_lossy().as_ref())
        .map_err(|e| e.to_string())?;
    key.set_value("CustomActivator", &clsid_string)
        .map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let (server, _) = root
        .create_subkey(format!(
            "Software\\Classes\\CLSID\\{clsid_string}\\LocalServer32"
        ))
        .map_err(|e| e.to_string())?;
    server
        .set_value("", &format!("\"{}\" --notification-server", exe.display()))
        .map_err(|e| e.to_string())?;
    let wide = HSTRING::from(app_id());
    unsafe { SetCurrentProcessExplicitAppUserModelID(PCWSTR(wide.as_ptr())) }
        .map_err(|e| e.to_string())?;
    shortcut::register(app, &exe, &clsid)?;
    let factory: IClassFactory = Factory { app: app.clone() }.into();
    let cookie =
        unsafe { CoRegisterClassObject(&clsid, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE) }
            .map_err(|e| e.to_string())?;
    if crate::auth::app_lock::require_unlocked(app).is_err() {
        let _apartment = Apartment::enter()?;
        // A newly registered identity may not have a notification history yet.
        // There is nothing to redact in that case; keep the worker available.
        if let Err(error) = ToastNotificationManager::History()
            .and_then(|history| history.ClearWithId(&HSTRING::from(app_id())))
        {
            if !is_missing_entry(&error) {
                unsafe { ::windows::Win32::System::Com::CoRevokeClassObject(cookie) }
                    .ok();
                return Err(native_error("clear locked-app history", error));
            }
        }
    }
    Ok(Registration {
        _apartment: apartment,
        _factory: factory,
        cookie,
    })
}
fn icon_uri() -> Result<String, String> {
    url::Url::from_file_path(ICON.get().ok_or("Notifications are not initialized")?)
        .map(|u| u.to_string())
        .map_err(|_| "Invalid notification icon path".into())
}
fn show_xml(content: &str, tag: &str, popup: bool) -> Result<(), String> {
    let content = content.to_string();
    let tag = tag.to_string();
    execute(move || show_xml_inner(&content, &tag, popup))
}
fn show_xml_inner(content: &str, tag: &str, popup: bool) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    let document = XmlDocument::new().map_err(|e| e.to_string())?;
    document
        .LoadXml(&HSTRING::from(content))
        .map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&document).map_err(|e| e.to_string())?;
    let expiry = ::windows::Foundation::DateTime {
        UniversalTime: (chrono::Utc::now().timestamp() + 86400 + 11644473600) * 10_000_000,
    };
    let expiry: ::windows::Foundation::IReference<::windows::Foundation::DateTime> =
        ::windows::Foundation::PropertyValue::CreateDateTime(expiry)
            .and_then(|value| value.cast())
            .map_err(|e| e.to_string())?;
    toast
        .SetExpirationTime(&expiry)
        .map_err(|e| e.to_string())?;
    toast
        .SetTag(&HSTRING::from(tag))
        .map_err(|e| e.to_string())?;
    toast
        .SetGroup(&HSTRING::from("inbox"))
        .map_err(|e| e.to_string())?;
    toast.SetSuppressPopup(!popup).map_err(|e| e.to_string())?;
    let notifier = NOTIFIER.with(|cell| -> Result<_, String> {
        let mut cached = cell.borrow_mut();
        if cached.is_none() {
            *cached = Some(
                ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id()))
                    .map_err(|e| native_error("create notifier", e))?,
            );
        }
        Ok(cached.as_ref().unwrap().clone())
    })?;
    match notifier.Setting() {
        Ok(NotificationSetting::Enabled) => (),
        Ok(setting) => {
            return Err(format!("Windows notifications are disabled for this app ({setting:?})"));
        }
        // Windows can return ERROR_NOT_FOUND before the first toast creates
        // this identity's settings entry. Let Show perform OS policy checks;
        // never override notification preferences or registry policy values.
        Err(error) if is_missing_entry(&error) => {
            log::debug!("{} notification settings entry not created yet", app_id());
        }
        Err(error) => return Err(native_error("read notification settings", error)),
    }
    let app = APP.get().cloned();
    toast
        .Failed(&::windows::Foundation::TypedEventHandler::new(
            move |_, args: &Option<::windows::UI::Notifications::ToastFailedEventArgs>| {
                if let Some(args) = args {
                    let error = format!("Windows rejected a notification: {:?}", args.ErrorCode());
                    log::error!("{}", error);
                    if let Some(app) = &app {
                        use tauri::Emitter;
                        let _ = app.emit("mail:notification_error", error);
                    }
                }
                Ok(())
            },
        ))
        .map_err(|e| e.to_string())?;
    notifier
        .Show(&toast)
        .map_err(|e| native_error("show toast", e))?;
    // Keep callbacks alive, with one retained toast per account/tag.
    TOASTS.with(|items| {
        let mut items = items.borrow_mut();
        if items.len() >= 32 {
            items.clear();
        }
        items.insert(tag.to_string(), toast);
    });
    Ok(())
}
pub fn show(
    batch: &Batch,
    title: &str,
    body: &str,
    attribution: &str,
    sound: bool,
    popup: bool,
) -> Result<(), String> {
    if !popup && !present(&batch.display_tag)? {
        return Ok(());
    }
    let open = format!("{}:open", batch.token);
    let read = format!("{}:read", batch.token);
    let open_label = if batch.items.len() == 1 {
        "Open email"
    } else {
        "Open Inbox"
    };
    let read_label = if batch.items.len() == 1 {
        "Mark as read"
    } else {
        "Mark all as read"
    };
    let audio = if sound {
        "<audio src=\"ms-winsoundevent:Notification.Mail\"/>"
    } else {
        "<audio silent=\"true\"/>"
    };
    show_xml(&format!("<toast launch=\"{open}\" activationType=\"foreground\"><visual><binding template=\"ToastGeneric\"><image placement=\"appLogoOverride\" src=\"{}\"/><text>{}</text><text hint-maxLines=\"4\">{}</text><text placement=\"attribution\">{}</text></binding></visual><actions><action content=\"{open_label}\" arguments=\"{open}\" activationType=\"foreground\"/><action content=\"{read_label}\" arguments=\"{read}\" activationType=\"background\" afterActivationBehavior=\"pendingUpdate\"/></actions>{audio}</toast>",xml(&icon_uri()?),xml(title),xml(body),xml(attribution)),&batch.display_tag,popup)
}
pub fn status(title: &str, body: &str) -> Result<(), String> {
    show_xml(&format!("<toast launch=\"app:open\"><visual><binding template=\"ToastGeneric\"><image placement=\"appLogoOverride\" src=\"{}\"/><text>{}</text><text>{}</text></binding></visual><actions><action content=\"Open OrionMail\" arguments=\"app:open\" activationType=\"foreground\"/></actions><audio silent=\"true\"/></toast>",xml(&icon_uri()?),xml(title),xml(body)),"status",true)
}
pub fn remove(tag: &str) -> Result<(), String> {
    let tag = tag.to_string();
    execute(move || remove_inner(&tag))
}
fn remove_inner(tag: &str) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    match ToastNotificationManager::History()
        .and_then(|h| {
            h.RemoveGroupedTagWithId(
                &HSTRING::from(tag),
                &HSTRING::from("inbox"),
                &HSTRING::from(app_id()),
            )
        })
    {
        Ok(()) => Ok(()),
        Err(error) if is_missing_entry(&error) => Ok(()),
        Err(error) => Err(native_error("remove toast", error)),
    }
}
pub fn present(tag: &str) -> Result<bool, String> {
    let tag = tag.to_string();
    execute(move || present_inner(&tag))
}
fn present_inner(tag: &str) -> Result<bool, String> {
    let _apartment = Apartment::enter()?;
    let history = match ToastNotificationManager::History()
        .and_then(|h| h.GetHistoryWithId(&HSTRING::from(app_id())))
    {
        Ok(history) => history,
        Err(error) if is_missing_entry(&error) => return Ok(false),
        Err(error) => return Err(native_error("read toast history", error)),
    };
    for toast in history {
        if toast.Tag().map_err(|e| e.to_string())? == tag
            && toast.Group().map_err(|e| e.to_string())? == "inbox"
        {
            return Ok(true);
        }
    }
    Ok(false)
}
