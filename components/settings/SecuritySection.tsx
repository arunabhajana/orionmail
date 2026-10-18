"use client";

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettings } from './SettingsContext';
import { SettingGroup, SettingRow, SettingToggle } from './SettingsControls';
import { PreferencesSection } from './PreferencesSection';

export const SecuritySection = () => {
    const { registerSection, unregisterSection, markDirty } = useSettings();
    const [helloAvailable, setHelloAvailable] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    
    const [originalAppLockEnabled, setOriginalAppLockEnabled] = useState(false);
    const [appLockEnabled, setAppLockEnabled] = useState(false);

    useEffect(() => {
        // Hydrate from Tauri settings
        invoke<{ minimize_to_tray: boolean; start_hidden: boolean; app_lock_enabled: boolean }>('get_app_settings')
            .then(settings => {
                const stored = settings.app_lock_enabled === true;
                setOriginalAppLockEnabled(stored);
                setAppLockEnabled(stored);

                // Check availability
                invoke<boolean>('check_hello_availability')
                    .then(available => {
                        setHelloAvailable(available);
                    })
                    .catch(console.error);
            })
            .catch(() => setLoadError(true)).finally(() => setLoaded(true));
    }, []);

    // Register section
    useEffect(() => {
        const isDirty = loaded && !loadError && originalAppLockEnabled !== appLockEnabled;

        registerSection({
            id: 'security',
            isDirty,
            save: async () => {
                if (!loaded || loadError) throw new Error("Security settings could not be loaded.");
                if (appLockEnabled && !originalAppLockEnabled) {
                    const verified = await invoke<boolean>('authenticate_hello', { message: 'Enable OrionMail app lock' });
                    if (!verified) throw new Error('Windows Hello verification is required to enable app lock.');
                }
                const settings = await invoke<{ minimize_to_tray: boolean; start_hidden: boolean; app_lock_enabled: boolean }>('get_app_settings');
                await invoke('set_app_settings', {
                    minimizeToTray: settings.minimize_to_tray,
                    startHidden: settings.start_hidden,
                    appLockEnabled: appLockEnabled
                });
                setOriginalAppLockEnabled(appLockEnabled);
            },
            reset: () => {
                setAppLockEnabled(originalAppLockEnabled);
            }
        });

        return () => unregisterSection('security');
    }, [originalAppLockEnabled, appLockEnabled, loaded, loadError, registerSection, unregisterSection]);

    useEffect(() => {
        markDirty('security', originalAppLockEnabled !== appLockEnabled);
    }, [originalAppLockEnabled, appLockEnabled, markDirty]);

    return <div className="space-y-5">
        <SettingGroup title="Protect this app" description="Windows Hello protects access to OrionMail. Your Google account security is managed by Google.">
            <SettingRow id="security.app-lock" title="Windows Hello on launch" description={!loaded ? "Checking device security…" : loadError ? "Could not load native security settings. Reopen Settings to try again." : helloAvailable ? "Require your PIN, fingerprint, or face when opening OrionMail." : "Set up Windows Hello in Windows Settings to enable app lock."}>
                <SettingToggle label="Windows Hello on launch" checked={appLockEnabled} onChange={setAppLockEnabled} disabled={!loaded || loadError || (!helloAvailable && !appLockEnabled)} />
            </SettingRow>
            <SettingRow id="security.idle" title="Automatic idle lock" description="App lock currently applies on launch. Timed re-locking is not available yet." unavailable />
            <SettingRow id="security.windows" title="Lock with Windows" description="Windows session lock integration is not available yet." unavailable />
        </SettingGroup>
        <PreferencesSection section="privacy" />
    </div>;
};
SecuritySection.displayName = "SecuritySection";
