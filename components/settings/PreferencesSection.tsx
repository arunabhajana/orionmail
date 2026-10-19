"use client";
import React, { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { NotificationSystemControls } from "./NotificationSystemControls";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useAppPreferences } from "@/components/AppPreferencesContext";
import { AppPreferences, parseAddressList } from "@/lib/app-preferences";
import { useSettings } from "./SettingsContext";
import { preferenceGroups } from "./preferenceDefinitions";
import { SettingGroup, SettingRow, SettingSelect, SettingToggle } from "./SettingsControls";
export function PreferencesSection({ section }: { section: string }) {
    const { preferences, updatePreferences } = useAppPreferences();
    const [draft, setDraft] = useState(preferences);
    const { registerSection, unregisterSection } = useSettings();
    const groups = preferenceGroups[section] || [];
    const keys = useMemo(() => (preferenceGroups[section] || []).flatMap(group => group.items.flatMap(item => item.key ? [item.key] : [])), [section]);
    const dirty = keys.some(key => draft[key] !== preferences[key]);
    useEffect(() => {
        registerSection({ id: section, isDirty: dirty, save: async () => {
            if (section === "compose") { parseAddressList(draft.defaultCc); parseAddressList(draft.defaultBcc); }
            if (section === "notifications" && draft.desktopNotifications && !preferences.desktopNotifications && isTauri()) {
                if (!await isPermissionGranted() && await requestPermission() !== "granted") throw new Error("Allow OrionMail notifications in Windows Settings first.");
            }
            const patch = Object.fromEntries(keys.map(key => [key, draft[key]])) as Partial<AppPreferences>;
            await updatePreferences(patch);
        }, reset: () => setDraft(preferences) });
        return () => unregisterSection(section);
    }, [section, draft, preferences, dirty, keys, registerSection, unregisterSection, updatePreferences]); // keys are determined by section
    const set = (key: keyof AppPreferences, value: string | boolean) => setDraft(prev => ({ ...prev, [key]: value }));
    return <div className="space-y-5">{groups.map(group => <SettingGroup key={group.title} title={group.title} description={group.description}>{group.items.map(item => {
        const key = item.key;
        const disabled = (key?.startsWith("smartActions") && key !== "smartActionsGlobal" && !draft.smartActionsGlobal) || ((key === "quietStart" || key === "quietEnd") && !draft.quietHours);
        return <SettingRow key={item.id} id={`${section}.${item.id}`} title={item.title} description={item.description} unavailable={item.type === "unavailable"}>
            {key && item.type === "toggle" && <SettingToggle label={item.title} checked={Boolean(draft[key])} onChange={value => set(key, value)} disabled={disabled} />}
            {key && item.type === "select" && <SettingSelect label={item.title} value={String(draft[key])} options={item.options || []} onChange={value => set(key, value)} />}
            {key && (item.type === "text" || item.type === "time") && <input aria-label={item.title} type={item.type} value={String(draft[key])} disabled={disabled} onChange={event => set(key, event.target.value)} maxLength={1000} className={`settings-input ${item.type === "text" ? "w-full sm:w-64" : "w-32"}`} />}
            {key && item.type === "textarea" && <textarea aria-label={item.title} rows={4} maxLength={4000} value={String(draft[key])} placeholder="Your name, role, and contact details…" onChange={event => set(key, event.target.value)} className="settings-input w-full resize-y min-h-24" />}
        </SettingRow>;
    })}</SettingGroup>)}{section === "notifications" && <NotificationSystemControls />}{section === "shortcuts" && <SettingGroup title="Always within reach"><SettingRow id="shortcuts.save" title="Save settings" description="Save your pending changes."><kbd className="settings-key">Ctrl + S</kbd></SettingRow><SettingRow id="shortcuts.search" title="Search settings" description="Find any preference from this page."><kbd className="settings-key">Ctrl + K</kbd></SettingRow></SettingGroup>}</div>;
}
