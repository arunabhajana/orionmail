"use client";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { SettingGroup, SettingRow, settingButton } from "./SettingsControls";

export function NotificationSystemControls() {
    const [busy, setBusy] = useState(false);
    const run = async (command: "preview_notification" | "open_notification_settings") => {
        setBusy(true);
        try { await invoke(command); }
        catch (error) { toast.error("Notification settings", { description: String(error) }); }
        finally { setBusy(false); }
    };
    return <SettingGroup title="Windows integration">
        <SettingRow id="notifications.preview" title="Preview notification" description="Check the app name, icon, and Windows delivery using your saved preferences.">
            <button type="button" className={settingButton} disabled={busy} onClick={() => void run("preview_notification")}>Send preview</button>
        </SettingRow>
        <SettingRow id="notifications.system" title="Windows notification settings" description="Manage banners, sounds, and lock screen previews for OrionMail or OrionMail Dev.">
            <button type="button" className={settingButton} disabled={busy} onClick={() => void run("open_notification_settings")}>Open settings</button>
        </SettingRow>
    </SettingGroup>;
}
