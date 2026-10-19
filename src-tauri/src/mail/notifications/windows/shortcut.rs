//! Development builds have no installer-created Start Menu identity. Register
//! a real shortcut, including the typed AUMID and COM activation properties.
use ::windows::{
    core::{Interface, GUID, HSTRING, PCWSTR, PROPVARIANT},
    Win32::{
        System::{
            Com::{
                CoCreateInstance, IPersistFile,
                StructuredStorage::{
                    InitPropVariantFromCLSID, PropVariantChangeType, PROPVAR_CHANGE_FLAGS,
                },
                CLSCTX_INPROC_SERVER,
            },
            Variant::VT_LPWSTR,
        },
        UI::Shell::{
            IShellLinkW,
            PropertiesSystem::{IPropertyStore, PROPERTYKEY},
            ShellLink,
        },
    },
};
use std::path::Path;
use tauri::{AppHandle, Manager};

pub(super) fn register(app: &AppHandle, exe: &Path, clsid: &GUID) -> Result<(), String> {
    let programs = app
        .path()
        .resolve(
            "Microsoft/Windows/Start Menu/Programs",
            tauri::path::BaseDirectory::Data,
        )
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&programs).map_err(|e| e.to_string())?;
    let path = programs.join(format!("{}.lnk", super::super::display_name()));
    let asset = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("notification-assets")
        .join(if cfg!(debug_assertions) {
            "orionmail-dev.ico"
        } else {
            "orionmail.ico"
        });
    let bytes: &[u8] = if cfg!(debug_assertions) {
        include_bytes!("../../../../icons/notification-dev.ico")
    } else {
        include_bytes!("../../../../icons/icon.ico")
    };
    if std::fs::read(&asset).ok().as_deref() != Some(bytes) {
        std::fs::write(&asset, bytes).map_err(|e| e.to_string())?;
    }
    let result = (|| -> ::windows::core::Result<()> {
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(exe.to_string_lossy().as_ref()))?;
            if let Some(parent) = exe.parent() {
                link.SetWorkingDirectory(&HSTRING::from(parent.to_string_lossy().as_ref()))?;
            }
            link.SetDescription(&HSTRING::from(super::super::display_name()))?;
            link.SetIconLocation(&HSTRING::from(asset.to_string_lossy().as_ref()), 0)?;
            let properties: IPropertyStore = link.cast()?;
            let fmtid = GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3);
            let mut id = PROPVARIANT::new();
            PropVariantChangeType(
                &mut id,
                &PROPVARIANT::from(super::app_id()),
                PROPVAR_CHANGE_FLAGS(0),
                VT_LPWSTR,
            )?;
            properties.SetValue(&PROPERTYKEY { fmtid, pid: 5 }, &id)?;
            properties.SetValue(
                &PROPERTYKEY { fmtid, pid: 26 },
                &InitPropVariantFromCLSID(clsid)?,
            )?;
            properties.Commit()?;
            let file: IPersistFile = link.cast()?;
            let name = HSTRING::from(path.to_string_lossy().as_ref());
            file.Save(PCWSTR(name.as_ptr()), true)?;
            Ok(())
        }
    })();
    result.map_err(|e| {
        format!(
            "Could not register {} Start Menu notification identity: {e}",
            super::super::display_name()
        )
    })
}
