"use client";
import React, { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {open} from '@tauri-apps/plugin-dialog';
import {toast} from 'sonner';
import { NotificationSystemControls, NotificationFocusStatus } from "./NotificationSystemControls";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useAppPreferences } from "@/components/AppPreferencesContext";
import {useAuth} from '../AuthContext';
import { AppPreferences, parseAddressList } from "@/lib/app-preferences";
import { useSettings } from "./SettingsContext";
import { preferenceGroups } from "./preferenceDefinitions";
import { SettingGroup, SettingRow, SettingSelect, SettingToggle, SettingTimePicker, settingButton } from "./SettingsControls";
export function PreferencesSection({ section }: { section: string }) {
    const {user} = useAuth();
    const { devicePreferences, overrides, saveAccountPreferences, updateDevicePreferences } = useAppPreferences();
    const [scope,setScope]=useState('device');
    const accountId=user?.id;
    const preferences=useMemo(()=>scope==='account' && accountId ? {...devicePreferences,...overrides[accountId]} : devicePreferences,[scope,accountId,devicePreferences,overrides]);
    const updatePreferences=React.useCallback((patch:Partial<AppPreferences>)=>scope==='account' && accountId ? saveAccountPreferences(accountId,patch) : updateDevicePreferences(patch),[scope,accountId,saveAccountPreferences,updateDevicePreferences]);
    const [draft, setDraft] = useState(preferences);
    const [baseline, setBaseline] = useState(preferences);
    // Keep externally changed controls (for example the titlebar bell) in sync,
    // preserving fields the user is currently editing on this page.
    if (baseline !== preferences) {
        setDraft(previous => Object.fromEntries(Object.keys(preferences).map(name => {
            const key = name as keyof AppPreferences;
            return [key, previous[key] === baseline[key] ? preferences[key] : previous[key]];
        })) as AppPreferences);
        setBaseline(preferences);
    }
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
            const patch = Object.fromEntries(keys.filter(key=>scope!=='account' || draft[key]!==preferences[key]).map(key => [key, draft[key]])) as Partial<AppPreferences>;
            await updatePreferences(patch);
        }, reset: () => setDraft(preferences) });
        return () => unregisterSection(section);
    }, [section, draft, preferences, dirty, keys, scope, registerSection, unregisterSection, updatePreferences]); // keys are determined by section
    const set = (key: keyof AppPreferences, value: string | boolean) => setDraft(prev => ({ ...prev, [key]: value }));
    return <div className="space-y-5"><SettingGroup title="Preference scope" description="Device defaults apply to every account. Account overrides affect only this mailbox; other preferences continue to inherit device defaults."><SettingRow id="preferences.scope" title="Edit preferences for" description="Save changes below to apply them to this scope."><SettingSelect label="Preference scope" value={scope} disabled={dirty} options={[["device","This device"],...(accountId ? [["account",user?.email || "This account"] as const] : [])]} onChange={setScope}/></SettingRow>{scope==='account' && accountId && <SettingRow id="preferences.inherit" title="Use device defaults" description={keys.some(key=>Object.hasOwn(overrides[accountId]||{},key))?'This section has account overrides. Resetting removes them.':'This section currently inherits device preferences.'}><button className={settingButton} disabled={dirty} onClick={()=>{void saveAccountPreferences(accountId,{},keys).catch(error=>toast.error('Could not reset preferences',{description:String(error)}));}}>Reset this section</button></SettingRow>}</SettingGroup>{section === 'notifications' && <NotificationFocusStatus />}{groups.map(group => <SettingGroup key={group.title} title={group.title} description={group.description}>{group.items.map(item => {
        const key = item.key;
        const disabled = (key === "notificationTone" && !draft.notificationSound) || (key?.startsWith("smartActions") && key !== "smartActionsGlobal" && !draft.smartActionsGlobal) || ((key === "quietStart" || key === "quietEnd") && !draft.quietHours);
        return <SettingRow key={item.id} id={`${section}.${item.id}`} title={item.title} description={item.description} unavailable={item.type === "unavailable"}>
            {key && item.type === "toggle" && <SettingToggle label={item.title} checked={Boolean(draft[key])} onChange={value => set(key, value)} disabled={disabled} />}
            {key && item.type === "select" && <SettingSelect label={item.title} value={String(draft[key])} options={item.options || []} disabled={disabled} onChange={value => set(key, value)} />}
            {key && item.type === 'folder' && <div className="flex w-full max-w-sm flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={String(draft[key])}>{String(draft[key])||'System Downloads folder'}</span><button className={settingButton} onClick={()=>{void open({directory:true,multiple:false,title:'Choose download folder',defaultPath:String(draft[key])||undefined}).then(path=>{if(typeof path==='string')set(key,path);}).catch(error=>toast.error('Could not choose folder',{description:String(error)}));}}>Choose…</button><button className={settingButton} disabled={!draft[key]} onClick={()=>set(key,'')}>Reset</button></div>}
            {key && item.type === "time" && <SettingTimePicker label={item.title} value={String(draft[key])} disabled={disabled} onChange={value => set(key, value)} />}
            {key && item.type === "text" && <input aria-label={item.title} type="text" value={String(draft[key])} disabled={disabled} onChange={event => set(key, event.target.value)} maxLength={1000} className="settings-input w-full sm:w-64" />}
            {key && item.type === "textarea" && <textarea aria-label={item.title} rows={4} maxLength={4000} value={String(draft[key])} placeholder="Your name, role, and contact details…" onChange={event => set(key, event.target.value)} className="settings-input w-full resize-y min-h-24" />}
        </SettingRow>;
    })}</SettingGroup>)}{section === "notifications" && <NotificationSystemControls />}{section === "shortcuts" && <SettingGroup title="Always within reach"><SettingRow id="shortcuts.save" title="Save settings" description="Save your pending changes."><kbd className="settings-key">Ctrl + S</kbd></SettingRow><SettingRow id="shortcuts.search" title="Search settings" description="Find any preference from this page."><kbd className="settings-key">Ctrl + K</kbd></SettingRow></SettingGroup>}</div>;
}
