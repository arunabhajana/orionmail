"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from 'sonner';

export type SettingsSection = {
    id: string;
    isDirty: boolean;
    save: () => Promise<void>;
    reset: () => void;
};

interface SettingsContextType {
    dirtySections: Record<string, SettingsSection>;
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    registerSection: (section: SettingsSection) => void;
    unregisterSection: (id: string) => void;
    markDirty: (id: string, isDirty: boolean) => void;
    saveAll: () => Promise<void>;
    resetAll: () => void;
    requestNavigation: (callback: () => void) => void;
    canChangeAccount: () => boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children, onInterceptNavigation }: { children: React.ReactNode, onInterceptNavigation: (callback: () => void) => void }) {
    const [dirtySections, setDirtySections] = useState<Record<string, SettingsSection>>({});
    const [isSaving, setIsSaving] = useState(false);
    const sectionsRef = useRef<Record<string, SettingsSection>>({});
    const savingRef = useRef(false);
    const updateSections = useCallback((update: (previous: Record<string, SettingsSection>) => Record<string, SettingsSection>) => {
        const next = update(sectionsRef.current);
        sectionsRef.current = next;
        setDirtySections(next);
    }, []);
    const canChangeAccount = useCallback(() => !savingRef.current && !Object.values(sectionsRef.current).some(section => section.isDirty), []);

    const hasUnsavedChanges = useMemo(
        () => Object.values(dirtySections).some(section => section.isDirty),
        [dirtySections]
    );

    const registerSection = useCallback((section: SettingsSection) => {
        updateSections(prev => ({ ...prev, [section.id]: section }));
    }, [updateSections]);

    const unregisterSection = useCallback((id: string) => {
        updateSections(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, [updateSections]);

    const markDirty = useCallback((id: string, isDirty: boolean) => {
        updateSections(prev => {
            if (!prev[id]) return prev;
            if (prev[id].isDirty === isDirty) return prev;
            return {
                ...prev,
                [id]: { ...prev[id], isDirty }
            };
        });
    }, [updateSections]);

    const saveAll = useCallback(async function saveSettings() {
        if (savingRef.current) throw new Error('Settings are already being saved.');
        if (canChangeAccount()) return;
        savingRef.current = true;
        setIsSaving(true);
        try {
            const promises = Object.values(sectionsRef.current)
                .filter(s => s.isDirty)
                .map(s => s.save());
            await Promise.all(promises);
            // After successful save, reset dirty flags
            updateSections(prev => {
                const next = { ...prev };
                for (const key in next) {
                    if (next[key].isDirty) {
                        next[key] = { ...next[key], isDirty: false };
                    }
                }
                return next;
            });
        } catch (e) {
            console.error("Save all failed", e);
            toast.error(e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to save settings.", {
                action: {
                    label: "Retry",
                    onClick: () => { void saveSettings().catch(() => {}); }
                }
            });
            throw e; // throw to stop navigation
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    }, [canChangeAccount, updateSections]);

    const resetAll = useCallback(() => {
        Object.values(sectionsRef.current).forEach(s => {
            if (s.isDirty) s.reset();
        });
        updateSections(previous => Object.fromEntries(Object.entries(previous).map(([id, section]) => [id, { ...section, isDirty: false }])));
    }, [updateSections]);

    const requestNavigation = useCallback((callback: () => void) => {
        if (isSaving) return;
        if (hasUnsavedChanges) {
            onInterceptNavigation(callback);
        } else {
            callback();
        }
    }, [hasUnsavedChanges, isSaving, onInterceptNavigation]);

    // Ctrl+S listener
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                if (hasUnsavedChanges && !isSaving) {
                    e.preventDefault();
                    void saveAll().catch(() => {});
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [hasUnsavedChanges, isSaving, saveAll]);

    // Browser Web unload protection
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (!hasUnsavedChanges) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasUnsavedChanges]);

    // Tauri window close protection
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        
        const setup = async () => {
            try {
                const appWindow = getCurrentWindow();
                unlisten = await appWindow.onCloseRequested(async (event) => {
                    if (hasUnsavedChanges) {
                        event.preventDefault();
                        // optionally, we could open a Tauri dialog here
                        // but event.preventDefault() will stop it from closing instantly.
                    }
                });
            } catch {
                // Not running in Tauri
            }
        };
        setup();
        
        return () => {
            if (unlisten) unlisten();
        };
    }, [hasUnsavedChanges]);

    return (
        <SettingsContext.Provider value={{
            dirtySections,
            hasUnsavedChanges,
            isSaving,
            registerSection,
            unregisterSection,
            markDirty,
            saveAll,
            resetAll,
            requestNavigation,
            canChangeAccount
        }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const ctx = useContext(SettingsContext);
    if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
    return ctx;
}
