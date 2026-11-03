"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AppPreferences, defaultPreferences, normalizePreferences } from "@/lib/app-preferences";
import { useAuth } from "./AuthContext";
export type { AppPreferences } from "@/lib/app-preferences";
interface PreferencesContext { devicePreferences: AppPreferences; overrides: Record<string, Partial<AppPreferences>>; saveAccountPreferences: (accountId:string, patch:Partial<AppPreferences>, resetKeys?: (keyof AppPreferences)[]) => Promise<void>; updateDevicePreferences: (patch:Partial<AppPreferences>)=>Promise<void>; preferences: AppPreferences; updatePreferences: (updates: Partial<AppPreferences>) => Promise<void>; }
const Context = createContext<PreferencesContext | null>(null);
const nativeKeys: (keyof AppPreferences)[] = ["notifyInbox","notifySent","notifyLabels","importantOnly","notificationTone","downloadFolder","cacheRetention","cacheBudget","taskbarBadge","taskbarBadgeScope","dndEnabled", "desktopNotifications", "notificationSound", "hideNotificationContent", "quietHours", "quietStart", "quietEnd", "syncPaused", "pollInterval", "prefetchBodies"];
export function AppPreferencesProvider({ children }: { children: React.ReactNode }) {
    const {user, isAccountCurrent} = useAuth();
    const [overrides,setOverrides] = useState<Record<string,Partial<AppPreferences>>>({});
    const overridesRef = useRef(overrides);
    const [preferences, setPreferences] = useState(defaultPreferences);
    const current = useRef(preferences);
    const [loaded, setLoaded] = useState(false);
    const queue = useRef(Promise.resolve());
    useEffect(() => {
        let mounted = true;
        (async () => {
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem("orion_app_preferences") || "{}"); } catch { /* Recover corrupt storage. */ }
            if (!isTauri()) { try { const cached=JSON.parse(localStorage.getItem("orion_account_preferences")||"{}"); if(mounted){overridesRef.current=cached;setOverrides(cached);} }catch{} }
            if (isTauri()) {
                try { const native = await invoke<{accountOverrides?:Record<string,Partial<AppPreferences>>}>("get_mail_preferences"); stored = { ...stored, ...native }; if(mounted) { overridesRef.current=native.accountOverrides || {}; setOverrides(overridesRef.current); } }
                catch (error) { console.error("Cannot load native preferences", error); }
            }
            if (mounted) { const value = normalizePreferences(stored); current.current = value; setPreferences(value); setLoaded(true); }
        })();
        return () => { mounted = false; };
    }, []);
    const updatePreferences = useCallback((updates: Partial<AppPreferences>) => {
        const task = queue.current.catch(() => {}).then(async () => {
            const next = normalizePreferences({ ...current.current, ...updates });
            if ((Object.keys(updates) as (keyof AppPreferences)[]).some(key => next[key] !== updates[key])) throw new Error("Check your preference values before saving.");
            // Persist native settings before reporting success; never show a fake saved toggle.
            if (isTauri() && nativeKeys.some(key => next[key] !== current.current[key])) {
                await invoke("set_mail_preferences", { preferences: Object.fromEntries(nativeKeys.map(key => [key, next[key]])) });
            }
            try { localStorage.setItem("orion_app_preferences", JSON.stringify(next)); }
            catch (error) {
                if (isTauri() && nativeKeys.some(key => next[key] !== current.current[key])) {
                    await invoke("set_mail_preferences", { preferences: Object.fromEntries(nativeKeys.map(key => [key, current.current[key]])) });
                }
                throw error;
            }
            current.current = next;
            setPreferences(next);
        });
        queue.current = task;
        return task;
    }, []);
    const saveAccountPreferences = useCallback((accountId:string, patch:Partial<AppPreferences>, resetKeys: (keyof AppPreferences)[] = []) => {
        const task=queue.current.catch(()=>{}).then(async()=>{
            if(!isAccountCurrent(accountId)) throw new Error('Account changed. Reopen Settings.');
            const next={...overridesRef.current[accountId],...patch};
            for(const key of resetKeys) delete next[key];
            const normalized=normalizePreferences({...current.current,...next});
            for(const key of Object.keys(next) as (keyof AppPreferences)[]) if(next[key]!==normalized[key]) throw new Error('Invalid account preference');
            if(isTauri()) await invoke('set_account_preferences',{accountId,overrides:next});
            else localStorage.setItem('orion_account_preferences',JSON.stringify({...overridesRef.current,[accountId]:next}));
            overridesRef.current={...overridesRef.current,[accountId]:next}; setOverrides(overridesRef.current);
        }); queue.current=task; return task;
    },[isAccountCurrent]);
    const effective=useMemo(()=>normalizePreferences({...preferences,...(user ? overrides[user.id] : {})}),[preferences,overrides,user]);
    const updateEffective=useCallback(async (patch:Partial<AppPreferences>)=>{
        if(user && Object.keys(patch).some(key=>Object.hasOwn(overrides[user.id] || {},key))) await saveAccountPreferences(user.id,patch);
        else await updatePreferences(patch);
    },[user,overrides,saveAccountPreferences,updatePreferences]);
    return <Context.Provider value={{ devicePreferences:preferences, overrides, saveAccountPreferences, updateDevicePreferences:updatePreferences, preferences:effective, updatePreferences:updateEffective }}>{loaded ? children : <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">Loading preferences…</div>}</Context.Provider>;
}
export function useAppPreferences() { const context = useContext(Context); if (!context) throw new Error("Missing AppPreferencesProvider"); return context; }
