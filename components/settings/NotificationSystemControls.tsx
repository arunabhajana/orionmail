"use client";
import { Bell, BellOff, Clock3, Volume2 } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { SettingGroup, SettingRow, settingButton } from "./SettingsControls";
import { useAppPreferences } from '@/components/AppPreferencesContext';
import { useQuietHours } from '@/hooks/useQuietHours';

export function NotificationFocusStatus() {
    const { preferences } = useAppPreferences();
    const scheduled = useQuietHours();
    const silenced = !preferences.desktopNotifications || preferences.dndEnabled || scheduled;
    const Icon = scheduled && !preferences.dndEnabled ? Clock3 : silenced ? BellOff : Bell;
    const hasFolders = preferences.notifyInbox || preferences.notifySent || preferences.notifyLabels;
    const title = !preferences.desktopNotifications ? 'Notifications are off' : preferences.dndEnabled ? 'Do not disturb is on' : scheduled ? 'Quiet hours are active' : !hasFolders ? 'No alert folders selected' : 'Notifications are on';
    const description = !preferences.desktopNotifications ? 'Turn on desktop notifications below to receive alerts.' : preferences.dndEnabled ? 'Alerts and sounds stay silenced until you turn Do not disturb off.' : scheduled ? `Alerts are silenced until ${preferences.quietEnd}, in your device’s local time.` : !hasFolders ? 'Enable at least one folder below to receive new mail alerts.' : preferences.importantOnly ? 'You’ll receive alerts for Important mail in your enabled folders.' : 'You’ll receive alerts for new mail in your enabled folders.';
    const folders = [preferences.notifyInbox && 'Inbox', preferences.notifySent && 'Sent', preferences.notifyLabels && 'Tags'].filter(Boolean).join(' · ');
    return <section aria-label="Current notification status" className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white dark:border-white/[0.08] dark:bg-[#191b21]">
        <div className="flex items-start gap-3.5 p-5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon size={19} /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold tracking-tight">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground"><span><span className="font-medium text-foreground/80">Folders:</span> {folders || 'None selected'}</span><span className="inline-flex items-center gap-1.5"><Volume2 size={12} />{preferences.notificationSound ? silenced ? 'Sound enabled · currently silenced' : 'Sound on' : 'Silent'}</span></div></div></div>
        <div className="border-t border-black/[0.05] bg-black/[0.015] px-5 py-3 text-[11px] leading-relaxed text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.015]">Sync and unread counts continue while alerts are silenced. This card reflects saved settings; save your changes below to apply them.</div>
    </section>;
}

export function NotificationSystemControls() {
    const [busy, setBusy] = useState(false);
    const run = async (command: "preview_notification" | "open_notification_settings" | "open_notification_volume") => {
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
        <SettingRow id="notifications.volume" title="Notification volume" description="Adjust notification and app volume in the Windows volume mixer. Windows controls native toast loudness."><button type="button" className={settingButton} disabled={busy} onClick={() => void run('open_notification_volume')}>Open volume mixer</button></SettingRow>
    </SettingGroup>;
}
