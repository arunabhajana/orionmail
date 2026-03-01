"use client";

import React, { memo } from 'react';
import { motion } from 'framer-motion';

export const NotificationsSection = memo(() => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
    >
        {/* Email Notifications */}
        <div className="p-8 rounded-3xl bg-secondary/30 border border-white/20 backdrop-blur-md">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Email Alerts</h3>

            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-foreground">Desktop Notifications</h4>
                        <p className="text-sm text-muted-foreground mt-1">Receive push notifications for new emails.</p>
                    </div>
                    {/* CSS Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>

                <div className="h-px bg-white/10 w-full" />

                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-semibold text-foreground">Play Notification Sound</h4>
                        <p className="text-sm text-muted-foreground mt-1">Audible ping when a new message arrives.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>
            </div>

            <div className="mt-8 flex items-center justify-between">
                <div>
                    <h4 className="font-semibold text-foreground">Notification Sound</h4>
                    <p className="text-sm text-muted-foreground mt-1">Choose the alert tone.</p>
                </div>
                <select className="px-4 py-2 rounded-xl bg-white/50 border border-white/20 outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm font-medium">
                    <option>Default Ping</option>
                    <option>Chime</option>
                    <option>Soft Bell</option>
                    <option>Orbit</option>
                </select>
            </div>
        </div>

        {/* Badge & Unread Counts */}
        <div className="p-8 rounded-3xl bg-secondary/30 border border-white/20 backdrop-blur-md">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Badges</h3>

            <div className="flex items-center justify-between">
                <div>
                    <h4 className="font-semibold text-foreground">Show Unread Count</h4>
                    <p className="text-sm text-muted-foreground mt-1">Display unread metric in the app sidebar and taskbar.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-black/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
            </div>
        </div>
    </motion.div>
));
NotificationsSection.displayName = "NotificationsSection";
