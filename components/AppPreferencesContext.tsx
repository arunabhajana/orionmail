"use client";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AppPreferences, defaultPreferences, normalizePreferences } from "@/lib/app-preferences";
export type { AppPreferences } from "@/lib/app-preferences";
interface PreferencesContext { preferences: AppPreferences; updatePreferences: (updates: Partial<AppPreferences>) => Promise<void>; }
const Context = createContext<PreferencesContext | null>(null);
const nativeKeys: (keyof AppPreferences)[] = ["dndEnabled", "desktopNotifications", "notificationSound", "hideNotificationContent", "quietHours", "quietStart", "quietEnd", "syncPaused", "pollInterval", "prefetchBodies"];
export function AppPreferencesProvider({ children }: { children: React.ReactNode }) {
    const [preferences, setPreferences] = useState(defaultPreferences);
    const current = useRef(preferences);
    const [loaded, setLoaded] = useState(false);
    const queue = useRef(Promise.resolve());
    useEffect(() => {
        let mounted = true;
        (async () => {
            let stored = {};
            try { stored = JSON.parse(localStorage.getItem("orion_app_preferences") || "{}"); } catch { /* Recover corrupt storage. */ }
            if (isTauri()) {
                try { stored = { ...stored, ...await invoke<object>("get_mail_preferences") }; }
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
    return <Context.Provider value={{ preferences, updatePreferences }}>{loaded ? children : <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">Loading preferences…</div>}</Context.Provider>;
}
export function useAppPreferences() { const context = useContext(Context); if (!context) throw new Error("Missing AppPreferencesProvider"); return context; }
