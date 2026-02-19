"use client";

import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const AppearanceSection = memo(() => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
    >
        {/* Theme Selection */}
        <div className="p-8 rounded-3xl bg-secondary/30 border border-white/20 backdrop-blur-md">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Interface Theme</h3>

            <div className="grid grid-cols-3 gap-6">
                {['Light Mode', 'Dark Mode', 'System'].map((mode, i) => (
                    <button
                        key={mode}
                        className={cn(
                            "group relative flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200",
                            i === 0 ? "border-primary bg-primary/5" : "border-transparent hover:bg-white/40"
                        )}
                    >
                        <div className={cn(
                            "w-full aspect-video rounded-lg shadow-sm overflow-hidden border border-black/5",
                            mode === 'Light Mode' ? "bg-settings-light" :
                                mode === 'Dark Mode' ? "bg-settings-dark" :
                                    "bg-gradient-to-br from-settings-light to-settings-dark"
                        )}>
                            {/* Mock UI elements inside the preview */}
                            <div className="w-full h-full p-3 flex flex-col gap-2 opacity-50">
                                <div className={cn("w-1/3 h-2 rounded-full", mode === 'Dark Mode' ? "bg-white/20" : "bg-black/10")} />
                                <div className={cn("w-2/3 h-2 rounded-full", mode === 'Dark Mode' ? "bg-white/10" : "bg-black/5")} />
                            </div>
                        </div>
                        <span className={cn(
                            "text-sm font-medium",
                            i === 0 ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}>
                            {mode}
                        </span>
                    </button>
                ))}
            </div>

            <div className="mt-10 flex items-center justify-between">
                <div>
                    <h4 className="font-semibold text-foreground">Message Density</h4>
                    <p className="text-sm text-muted-foreground mt-1">Control how much information you see at once.</p>
                </div>
                <div className="flex bg-black/5 p-1 rounded-lg">
                    {['Compact', 'Default', 'Relaxed'].map((d, i) => (
                        <button
                            key={d}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                i === 1 ? "bg-white text-black shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {d}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-10 flex items-center justify-between">
                <h4 className="font-semibold text-foreground">Accent Color</h4>
                <div className="flex gap-3">
                    {['bg-blue-500', 'bg-purple-500', 'bg-rose-500', 'bg-emerald-500', 'bg-orange-500'].map((color, i) => (
                        <button
                            key={color}
                            className={cn(
                                "w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-white/0 transition-all",
                                color,
                                i === 0 ? "ring-primary scale-110" : "ring-transparent hover:scale-110"
                            )}
                        />
                    ))}
                </div>
            </div>
        </div>
    </motion.div>
));
AppearanceSection.displayName = "AppearanceSection";
