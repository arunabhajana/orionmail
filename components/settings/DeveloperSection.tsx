"use client";

import React, { useState, useEffect } from 'react';
import { Terminal, BugPlay } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettings } from './SettingsContext';

export function DeveloperSection() {
    const { registerSection, unregisterSection, markDirty } = useSettings();
    const [originalDevToolsEnabled, setOriginalDevToolsEnabled] = useState(false);
    const [devToolsEnabled, setDevToolsEnabled] = useState(false);

    useEffect(() => {
        // Hydrate from localStorage
        const stored = localStorage.getItem("orion_dev_tools_enabled");
        if (stored === "true") {
            setOriginalDevToolsEnabled(true);
            setDevToolsEnabled(true);
        }
    }, []);

    // Register section
    useEffect(() => {
        const isDirty = originalDevToolsEnabled !== devToolsEnabled;

        registerSection({
            id: 'developer',
            isDirty,
            save: async () => {
                localStorage.setItem("orion_dev_tools_enabled", String(devToolsEnabled));
                // Dispatch custom event so the Titlebar can react instantly
                window.dispatchEvent(new CustomEvent("orion:dev_tools_toggled", { detail: devToolsEnabled }));
                setOriginalDevToolsEnabled(devToolsEnabled);
            },
            reset: () => {
                setDevToolsEnabled(originalDevToolsEnabled);
            }
        });

        return () => unregisterSection('developer');
    }, [originalDevToolsEnabled, devToolsEnabled, registerSection, unregisterSection]);

    useEffect(() => {
        markDirty('developer', originalDevToolsEnabled !== devToolsEnabled);
    }, [originalDevToolsEnabled, devToolsEnabled, markDirty]);

    const toggleDevTools = () => {
        setDevToolsEnabled(!devToolsEnabled);
    };

    return (
        <div className="space-y-6">
            <div className="p-8 rounded-3xl bg-secondary/30 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-md">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-5 h-5 text-primary" strokeWidth={2} />
                            <h3 className="text-lg font-semibold text-foreground dark:text-white/90">Developer Tools</h3>
                        </div>
                        <p className="text-sm text-muted-foreground dark:text-white/60">
                            Enable the Dev Tools menu in the titlebar for debugging and testing error states.
                        </p>
                    </div>
                    <button
                        onClick={toggleDevTools}
                        className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-background",
                            devToolsEnabled ? "bg-primary" : "bg-black/20 dark:bg-white/20"
                        )}
                        role="switch"
                        aria-checked={devToolsEnabled}
                    >
                        <span className="sr-only">Enable developer tools</span>
                        <span
                            className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                devToolsEnabled ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                </div>

                <div className="mt-6 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400">
                    <div className="flex items-start gap-3">
                        <BugPlay className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium text-sm mb-1">Warning: Experimental Features</h4>
                            <p className="text-xs opacity-90 leading-relaxed">
                                Dev Tools allow you to forcibly simulate failures across different layers of the application (Authentication, Network, Local Database). Use these tools to verify how the application recovers from critical errors.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
