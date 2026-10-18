"use client";

import React, { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useAccentColor } from '@/components/AccentColorProvider';

const subscribe = () => () => {};
export const AppearanceSection = () => {
    const { theme, setTheme } = useTheme();
    const { accentColor, setAccentColor } = useAccentColor();
    const mounted = useSyncExternalStore(subscribe, () => true, () => false);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/* Theme Selection */}
            <div className="settings-group p-6">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Interface Theme</h3>

                <div className="grid grid-cols-3 gap-4">
                    {/* Light Mode */}
                    <button data-setting-id="appearance.light" onClick={() => setTheme('light')} className="flex flex-col gap-3 group">
                        <div className={cn(
                            "aspect-[4/3] w-full bg-white dark:bg-[#fafafa] rounded-lg border-2 shadow-sm overflow-hidden relative p-2 transition-all",
                            mounted && theme === 'light' ? "border-primary" : "border-black/5 dark:border-white/5 group-hover:border-black/20 dark:group-hover:border-white/20"
                        )}>
                            <div className="w-full h-full bg-[#f6f7f8] rounded-md border border-black/5 flex flex-col gap-1.5 p-2">
                                <div className="w-3/4 h-2 bg-black/10 rounded-full"></div>
                                <div className="w-1/2 h-2 bg-black/5 rounded-full"></div>
                            </div>
                        </div>
                        <span className={cn(
                            "text-sm font-medium transition-colors",
                            mounted && theme === 'light' ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}>Light Mode</span>
                    </button>

                    {/* Dark Mode */}
                    <button data-setting-id="appearance.dark" onClick={() => setTheme('dark')} className="flex flex-col gap-3 group">
                        <div className={cn(
                            "aspect-[4/3] w-full bg-[#1e1e1e] rounded-lg border-2 shadow-sm overflow-hidden relative p-2 transition-all",
                            mounted && theme === 'dark' ? "border-primary" : "border-black/5 dark:border-transparent group-hover:border-black/20 dark:group-hover:border-white/10"
                        )}>
                            <div className="w-full h-full bg-white/5 rounded-md border border-white/5 flex flex-col gap-1.5 p-2">
                                <div className="w-3/4 h-2 bg-white/20 rounded-full"></div>
                                <div className="w-1/2 h-2 bg-white/10 rounded-full"></div>
                            </div>
                        </div>
                        <span className={cn(
                            "text-sm font-medium transition-colors",
                            mounted && theme === 'dark' ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}>Dark Mode</span>
                    </button>

                    {/* System */}
                    <button data-setting-id="appearance.system" onClick={() => setTheme('system')} className="flex flex-col gap-3 group">
                        <div className={cn(
                            "aspect-[4/3] w-full bg-gradient-to-br from-white to-[#1e1e1e] rounded-lg border-2 shadow-sm overflow-hidden relative p-2 transition-all",
                            mounted && theme === 'system' ? "border-primary" : "border-transparent group-hover:border-black/10 dark:group-hover:border-white/10"
                        )}>
                            <div className="w-full h-full flex flex-col gap-1.5 p-2 justify-center">
                                <div className="w-3/4 h-2 bg-black/20 dark:bg-white/20 backdrop-blur-sm rounded-full mx-auto"></div>
                                <div className="w-1/2 h-2 bg-black/10 dark:bg-white/10 backdrop-blur-sm rounded-full mx-auto"></div>
                            </div>
                        </div>
                        <span className={cn(
                            "text-sm font-medium transition-colors",
                            mounted && theme === 'system' ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}>System</span>
                    </button>
                </div>

                <div data-setting-id="appearance.accent" className="mt-10 flex items-center justify-between rounded-xl">
                    <h4 className="font-semibold text-foreground">Accent Color</h4>
                    <div className="flex gap-3">
                        {([
                            { name: 'blue', class: 'bg-blue-500' },
                            { name: 'purple', class: 'bg-purple-500' },
                            { name: 'rose', class: 'bg-rose-500' },
                            { name: 'emerald', class: 'bg-emerald-500' },
                            { name: 'orange', class: 'bg-orange-500' }
                        ] as const).map((color) => (
                            <button
                                key={color.name}
                                aria-label={`${color.name} accent`}
                                aria-pressed={mounted && accentColor === color.name}
                                onClick={() => setAccentColor(color.name)}
                                className={cn(
                                    "w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-white/0 dark:ring-offset-black/0 transition-all",
                                    color.class,
                                    mounted && accentColor === color.name ? "ring-primary scale-110" : "ring-transparent hover:scale-110"
                                )}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
AppearanceSection.displayName = "AppearanceSection";
