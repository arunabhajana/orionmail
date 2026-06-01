"use client";

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
// Actually, let's build custom nicely styled toggles for this since we don't know if Switch exists.

interface SystemSettings {
    minimize_to_tray: boolean;
    start_hidden: boolean;
    launch_at_startup: boolean;
}

export function SystemSection() {
    const [settings, setSettings] = useState<SystemSettings>({
        minimize_to_tray: true,
        start_hidden: true,
        launch_at_startup: false,
    });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const rustSettings: any = await invoke('get_app_settings');
                const autostartEnabled = await isEnabled();
                setSettings({
                    minimize_to_tray: rustSettings.minimize_to_tray,
                    start_hidden: rustSettings.start_hidden,
                    launch_at_startup: autostartEnabled,
                });
            } catch (err) {
                console.error("Failed to load system settings", err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const toggleMinimizeToTray = async () => {
        const newVal = !settings.minimize_to_tray;
        setSettings(s => ({ ...s, minimize_to_tray: newVal }));
        try {
            await invoke('set_app_settings', { minimizeToTray: newVal, startHidden: settings.start_hidden });
        } catch (e) {
            console.error("Failed to update minimize_to_tray", e);
            // revert
            setSettings(s => ({ ...s, minimize_to_tray: !newVal }));
        }
    };

    const toggleStartHidden = async () => {
        const newVal = !settings.start_hidden;
        setSettings(s => ({ ...s, start_hidden: newVal }));
        try {
            await invoke('set_app_settings', { minimizeToTray: settings.minimize_to_tray, startHidden: newVal });
        } catch (e) {
            console.error("Failed to update start_hidden", e);
            // revert
            setSettings(s => ({ ...s, start_hidden: !newVal }));
        }
    };

    const toggleLaunchAtStartup = async () => {
        const newVal = !settings.launch_at_startup;
        setSettings(s => ({ ...s, launch_at_startup: newVal }));
        try {
            if (newVal) {
                await enable();
                let permissionGranted = await isPermissionGranted();
                if (!permissionGranted) {
                    const permission = await requestPermission();
                    permissionGranted = permission === 'granted';
                }
                if (permissionGranted) {
                    sendNotification({
                        title: 'Autostart Enabled',
                        body: 'OrionMail will now launch automatically when Windows starts.'
                    });
                }
            } else {
                await disable();
            }
        } catch (e) {
            console.error("Failed to update autostart", e);
            // revert
            setSettings(s => ({ ...s, launch_at_startup: !newVal }));
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground p-4">Loading system settings...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="bg-white/60 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground dark:text-white/90 mb-4">Startup Behavior</h3>
                
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Launch at Startup</p>
                            <p className="text-sm text-muted-foreground mt-1">Automatically start Orion Mail when you log into your computer.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={settings.launch_at_startup} onChange={toggleLaunchAtStartup} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl opacity-100 transition-opacity">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Start Hidden</p>
                            <p className="text-sm text-muted-foreground mt-1">When launched at startup, start minimized in the system tray without showing the main window.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={settings.start_hidden} onChange={toggleStartHidden} disabled={!settings.launch_at_startup} />
                            <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 ${!settings.launch_at_startup ? 'opacity-50' : 'peer-checked:bg-primary'}`}></div>
                        </label>
                    </div>
                </div>
            </div>

            <div className="bg-white/60 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground dark:text-white/90 mb-4">Window Behavior</h3>
                
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Minimize to Tray</p>
                            <p className="text-sm text-muted-foreground mt-1">When clicking the close (X) button, hide the window to the system tray instead of quitting the app.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={settings.minimize_to_tray} onChange={toggleMinimizeToTray} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}
