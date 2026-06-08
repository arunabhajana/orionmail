"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppPreferences } from '@/components/AppPreferencesContext';
import { useSettings } from './SettingsContext';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export const SmartActionsSection = () => {
    const { preferences, updatePreferences } = useAppPreferences();
    const { registerSection, unregisterSection, markDirty } = useSettings();
    const [mounted, setMounted] = useState(false);
    
    // Local state for UI toggles
    const [localPrefs, setLocalPrefs] = useState({
        smartActionsGlobal: preferences.smartActionsGlobal,
        smartActionsOtp: preferences.smartActionsOtp,
        smartActionsMeetings: preferences.smartActionsMeetings,
        smartActionsCommerce: preferences.smartActionsCommerce,
        smartActionsTravel: preferences.smartActionsTravel
    });

    useEffect(() => {
        setMounted(true);
        // Hydrate local state from preferences on mount
        setLocalPrefs({
            smartActionsGlobal: preferences.smartActionsGlobal,
            smartActionsOtp: preferences.smartActionsOtp,
            smartActionsMeetings: preferences.smartActionsMeetings,
            smartActionsCommerce: preferences.smartActionsCommerce,
            smartActionsTravel: preferences.smartActionsTravel
        });
    }, [preferences]);

    // Check if local state differs from global preferences
    const isDirty = 
        localPrefs.smartActionsGlobal !== preferences.smartActionsGlobal ||
        localPrefs.smartActionsOtp !== preferences.smartActionsOtp ||
        localPrefs.smartActionsMeetings !== preferences.smartActionsMeetings ||
        localPrefs.smartActionsCommerce !== preferences.smartActionsCommerce ||
        localPrefs.smartActionsTravel !== preferences.smartActionsTravel;

    // Register section with save and reset callbacks
    useEffect(() => {
        registerSection({
            id: 'smartactions',
            isDirty,
            save: async () => {
                updatePreferences(localPrefs);
            },
            reset: () => {
                setLocalPrefs({
                    smartActionsGlobal: preferences.smartActionsGlobal,
                    smartActionsOtp: preferences.smartActionsOtp,
                    smartActionsMeetings: preferences.smartActionsMeetings,
                    smartActionsCommerce: preferences.smartActionsCommerce,
                    smartActionsTravel: preferences.smartActionsTravel
                });
            }
        });

        return () => unregisterSection('smartactions');
    }, [isDirty, localPrefs, preferences, registerSection, unregisterSection, updatePreferences]);

    useEffect(() => {
        markDirty('smartactions', isDirty);
    }, [isDirty, markDirty]);

    const handleChange = (key: keyof typeof localPrefs) => {
        setLocalPrefs(prev => ({ ...prev, [key]: !prev[key] }));
    };

    if (!mounted) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
        >
            <div className="p-8 rounded-3xl bg-secondary/30 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-md">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-5 h-5 text-primary" strokeWidth={2} />
                            <h3 className="text-lg font-semibold text-foreground dark:text-white/90">Smart Actions</h3>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 dark:text-white/60">Automatically extract and display actionable cards for OTPs, meetings, and more.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={localPrefs.smartActionsGlobal} onChange={() => handleChange('smartActionsGlobal')} />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                    </label>
                </div>

                <div className={`space-y-4 transition-opacity ${!localPrefs.smartActionsGlobal ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Authentication Codes (OTP)</p>
                            <p className="text-sm text-muted-foreground mt-1 dark:text-white/60">Show quick copy buttons for login codes and 2FA.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={localPrefs.smartActionsOtp} onChange={() => handleChange('smartActionsOtp')} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Meetings & Events</p>
                            <p className="text-sm text-muted-foreground mt-1 dark:text-white/60">Extract join links and calendar invites.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={localPrefs.smartActionsMeetings} onChange={() => handleChange('smartActionsMeetings')} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Commerce & Tracking</p>
                            <p className="text-sm text-muted-foreground mt-1 dark:text-white/60">Track packages, view receipts, and monitor orders.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={localPrefs.smartActionsCommerce} onChange={() => handleChange('smartActionsCommerce')} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-white/40 dark:bg-black/20 rounded-xl">
                        <div>
                            <p className="font-medium text-foreground dark:text-white/90">Travel & Bookings</p>
                            <p className="text-sm text-muted-foreground mt-1 dark:text-white/60">Quick access to flight details, hotel bookings, and itineraries.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={localPrefs.smartActionsTravel} onChange={() => handleChange('smartActionsTravel')} />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
                        </label>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
SmartActionsSection.displayName = "SmartActionsSection";
