"use client";

import React, { memo } from 'react';
import { motion } from 'framer-motion';

export const SecuritySection = memo(() => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
    >
        {/* Security Summary & Toggles */}
        <div className="p-8 rounded-3xl bg-secondary/30 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-md">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Login Security</h3>

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-foreground">Two-Factor Authentication</h4>
                        <p className="text-sm text-muted-foreground mt-1">Add an extra layer of security to your account.</p>
                    </div>
                    {/* CSS Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-black/10 dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                <div className="h-px bg-white/10 dark:bg-white/5 w-full" />

                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-foreground">Require Password on App Launch</h4>
                        <p className="text-sm text-muted-foreground mt-1">Prompt for password or biometrics when opening OrbitMail.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" />
                        <div className="w-11 h-6 bg-black/10 dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>
            </div>
        </div>

        {/* Data & Privacy */}
        <div className="p-8 rounded-3xl bg-secondary/30 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-md">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Privacy Controls</h3>

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-foreground">Block External Images</h4>
                        <p className="text-sm text-muted-foreground mt-1">Prevent senders from tracking you via spy pixels.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-black/10 dark:bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                <div className="h-px bg-white/10 dark:bg-white/5 w-full" />

                <div className="flex items-center justify-between">
                    <div className="flex-1 pr-6">
                        <h4 className="font-semibold text-foreground">Blocked Senders</h4>
                        <p className="text-sm text-muted-foreground mt-1">Manage addresses you have blocked from messaging you.</p>
                    </div>
                    <button className="px-5 py-2 whitespace-nowrap bg-white text-black font-medium rounded-xl shadow-sm hover:bg-white/90 transition-colors text-sm dark:bg-black/40 dark:text-white dark:border dark:border-white/10 dark:hover:bg-black/60">
                        Manage Blocklist
                    </button>
                </div>
            </div>

            <div className="mt-10">
                <button className="px-5 py-2.5 bg-red-500/10 text-red-600 font-semibold rounded-xl hover:bg-red-500/20 transition-colors text-sm flex items-center gap-2">
                    Clear Local Cache Data
                </button>
                <p className="text-xs text-muted-foreground mt-2 px-1">This will remove downloaded emails from your device, requiring a re-sync.</p>
            </div>
        </div>
    </motion.div>
));
SecuritySection.displayName = "SecuritySection";
