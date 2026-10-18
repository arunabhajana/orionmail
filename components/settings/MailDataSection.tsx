"use client";
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthContext";
import { PreferencesSection } from "./PreferencesSection";
import { SettingGroup, SettingRow, settingButton } from "./SettingsControls";
interface SyncStatus { last_sync_at: number | null; sync_in_progress: boolean; }
interface CacheSummary { messages: number; bodyBytes: number; headerBytes: number; }
export function MailDataSection({ section }: { section: "sync" | "storage" }) {
    const { user } = useAuth();
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [cache, setCache] = useState<CacheSummary | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => {
        let active = true;
        const refresh = async () => {
            try {
                if (section === "sync") { const data = await invoke<SyncStatus>("get_sync_diagnostics"); if (active) setStatus(data); }
                else { const data = await invoke<CacheSummary>("get_cache_summary"); if (active) setCache(data); }
                if (active) setError(false);
            } catch { if (active) setError(true); }
        };
        void refresh();
        const timer = setInterval(refresh, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [section, user?.id]);
    const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return <div className="space-y-5">
        {section === "sync" ? <SettingGroup title="Your mailbox"><SettingRow id="sync.status" title={status?.sync_in_progress ? "Syncing mail…" : "Last sync"} description={error ? "Sync status is unavailable. Reopen Settings to retry." : status?.last_sync_at ? new Date(status.last_sync_at * 1000).toLocaleString() : "No sync recorded yet."}><button className={settingButton} disabled={busy || status?.sync_in_progress} onClick={async () => { setBusy(true); try { await invoke("sync_mail_folder", { folder: "inbox" }); setStatus(await invoke<SyncStatus>("get_sync_diagnostics")); toast.info("Inbox sync requested."); } catch { toast.error("Could not sync. Check your connection and try again."); } finally { setBusy(false); } }}><RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />{busy ? "Syncing…" : "Sync Now"}</button></SettingRow></SettingGroup> : <>
            <SettingGroup title="Mail on this device" description="Cached content for the current account. These estimates exclude database indexes, free space, and downloaded attachment files."><SettingRow id="storage.usage" title={cache ? `${cache.messages.toLocaleString()} cached messages` : "Cached messages"} description={error ? "Storage usage is unavailable." : cache ? `Headers and previews: ${formatBytes(cache.headerBytes)} · Message bodies: ${formatBytes(cache.bodyBytes)}` : "Calculating local content…"} /></SettingGroup>
        </>}
        <PreferencesSection section={section} />
        {section === "storage" && <SettingGroup title="Manage local mail"><SettingRow id="storage.clear" title="Clear cached mail" description="Remove this account’s downloaded mail and sync state. Mail stays at Google. Save any open work first."><button className={`${settingButton} text-red-600 dark:text-red-400`} disabled={busy} onClick={() => toast("Clear cached mail for this account?", { description: "Mail will need to download again. Your Google mailbox is not deleted.", action: { label: "Clear cache", onClick: async () => { setBusy(true); try { await invoke("clear_local_cache"); window.location.assign("/inbox"); } catch (error) { toast.error("Could not clear cached mail.", { description: String(error) }); setBusy(false); } } }, cancel: { label: "Cancel", onClick: () => {} } })}>Clear cache</button></SettingRow></SettingGroup>}
    </div>;
}
