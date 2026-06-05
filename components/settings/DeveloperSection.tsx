"use client";

import React, { useState, useEffect } from 'react';
import { Terminal, BugPlay } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DeveloperSection() {
    const [devToolsEnabled, setDevToolsEnabled] = useState(false);

    useEffect(() => {
        // Hydrate from localStorage
        const stored = localStorage.getItem("orion_dev_tools_enabled");
        if (stored === "true") {
            setDevToolsEnabled(true);
        }
    }, []);

    const toggleDevTools = () => {
        const newState = !devToolsEnabled;
        setDevToolsEnabled(newState);
        localStorage.setItem("orion_dev_tools_enabled", String(newState));
        
        // Dispatch custom event so the Titlebar can react instantly
        window.dispatchEvent(new CustomEvent("orion:dev_tools_toggled", { detail: newState }));
    };

    return (
        <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-white/50 dark:bg-white/5 border border-black/5 dark:border-white/5 shadow-sm">
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
