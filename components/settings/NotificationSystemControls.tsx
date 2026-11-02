"use client";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { SettingGroup, SettingRow, settingButton } from "./SettingsControls";
import { useAppPreferences } from '@/components/AppPreferencesContext';
import { useQuietHours } from '@/hooks/useQuietHours';

export function NotificationFocusStatus() {
    const { preferences } = useAppPreferences();
    const scheduled = useQuietHours();
    const status = !preferences.desktopNotifications ? 'Desktop notifications are off.' : preferences.dndEnabled ? 'Do not disturb is on until you turn it off.' : scheduled ? `Quiet hours are active until ${preferences.quietEnd} (device local time).` : 'New mail alerts are enabled.';
    return <div role="status" className="rounded-xl border border-primary/15 bg-primary/[0.04] px-5 py-3 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Current status: </span>{status}<p className="mt-1">Sync and unread counts continue while alerts are silenced. Changes below take effect when saved.</p></div>;
}

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
