"use client";

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { useSettings } from './SettingsContext';
import { toast } from "sonner";
import { PreferencesSection } from './PreferencesSection';
import { deepEqual } from '@/lib/deepEqual';
import { SettingGroup, SettingRow, SettingToggle, settingButton } from './SettingsControls';

interface SystemSettings {
    minimize_to_tray: boolean;
    start_hidden: boolean;
    launch_at_startup: boolean;
    app_lock_enabled: boolean;
}

export function SystemSection() {
    const { registerSection, unregisterSection, markDirty } = useSettings();

    const [originalSettings, setOriginalSettings] = useState<SystemSettings>({
        minimize_to_tray: true,
        start_hidden: true,
        launch_at_startup: false,
        app_lock_enabled: false,
    });

    const [settings, setSettings] = useState<SystemSettings>({
        minimize_to_tray: true,
        start_hidden: true,
        launch_at_startup: false,
        app_lock_enabled: false,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const rustSettings = await invoke<SystemSettings>('get_app_settings');
                const autostartEnabled = await isEnabled();
                const loadedSettings = {
                    minimize_to_tray: rustSettings.minimize_to_tray,
                    start_hidden: rustSettings.start_hidden,
                    launch_at_startup: autostartEnabled,
                    app_lock_enabled: rustSettings.app_lock_enabled === true,
                };
                setOriginalSettings(loadedSettings);
                setSettings(loadedSettings);
            } catch (err) {
                console.error("Failed to load system settings", err);
                setLoadError(true);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    // Register section
    useEffect(() => {
        const isDirty = !isLoading && !loadError && !deepEqual(originalSettings, settings);
        
        registerSection({
            id: 'desktop-window',
            isDirty,
            save: async () => {
                if (isLoading || loadError) throw new Error('Desktop settings unavailable.');
                const startupChanged = settings.launch_at_startup !== originalSettings.launch_at_startup;
                if (startupChanged) { if (settings.launch_at_startup) await enable(); else await disable(); }
                try {
                    const latest = await invoke<{ app_lock_enabled: boolean }>('get_app_settings');
                    await invoke('set_app_settings', {
                        minimizeToTray: settings.minimize_to_tray,
                        startHidden: settings.start_hidden,
                        appLockEnabled: latest.app_lock_enabled,
                    });
                } catch (error) {
                    if (startupChanged) { if (originalSettings.launch_at_startup) await enable(); else await disable(); }
                    throw error;
                }
                setOriginalSettings(settings);
            },
            reset: () => {
                setSettings(originalSettings);
            }
        });

        return () => unregisterSection('desktop-window');
    }, [originalSettings, settings, isLoading, loadError, registerSection, unregisterSection]);

    useEffect(() => {
        markDirty('desktop-window', !deepEqual(originalSettings, settings));
    }, [settings, originalSettings, markDirty]);

    const toggleMinimizeToTray = () => {
        setSettings(s => ({ ...s, minimize_to_tray: !s.minimize_to_tray }));
    };

    const toggleStartHidden = () => {
        setSettings(s => ({ ...s, start_hidden: !s.start_hidden }));
    };

    const toggleLaunchAtStartup = () => {
        setSettings(s => ({ ...s, launch_at_startup: !s.launch_at_startup }));
    };

    if (isLoading) {
        return <div className="text-muted-foreground p-4">Loading system settings...</div>;
    }

    if (loadError) return <p role="alert" className="settings-group p-5 text-sm text-muted-foreground">Desktop settings couldn’t be loaded. Reopen Settings to try again.</p>;
    return <div className="space-y-5">
        <SettingGroup title="Start your day">
            <SettingRow id="system.autostart" title="Launch at startup" description="Open OrionMail when you sign in to Windows."><SettingToggle label="Launch at startup" checked={settings.launch_at_startup} onChange={toggleLaunchAtStartup} /></SettingRow>
            <SettingRow id="system.hidden" title="Start in the tray" description="Launch quietly in the background when Windows starts."><SettingToggle label="Start in the tray" checked={settings.start_hidden} onChange={toggleStartHidden} disabled={!settings.launch_at_startup} /></SettingRow>
        </SettingGroup>
        <SettingGroup title="Window behavior">
            <SettingRow id="system.tray" title="Keep running when closed" description="The close button hides the window in the system tray. Mail keeps syncing."><SettingToggle label="Keep running when closed" checked={settings.minimize_to_tray} onChange={toggleMinimizeToTray} /></SettingRow>
        </SettingGroup>
        <SettingGroup title="Default mail app"><SettingRow id="system.defaultMail" title="Open email links with OrionMail" description="Register OrionMail as a mail app, then choose it for MAILTO in Windows Default apps. This leaves your current default unchanged until you select OrionMail."><button type="button" className={settingButton} onClick={()=>{void invoke('open_default_mail_settings').catch(error=>toast.error('Could not open default mail settings',{description:String(error)}));}}>Choose in Windows</button></SettingRow></SettingGroup>
        <PreferencesSection section="system" />
    </div>;
}
