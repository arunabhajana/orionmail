"use client";

import React, { useEffect, useState } from 'react';
import { useSettings } from './SettingsContext';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';

export function ConfirmNavigationDialog({ pendingCallback, onResolve }: { pendingCallback: (() => void) | null, onResolve: () => void }) {
    const { saveAll, resetAll } = useSettings();
    const [isSaving, setIsSaving] = useState(false);

    if (!pendingCallback) return null;

    const handleDiscard = () => {
        resetAll();
        onResolve();
        pendingCallback();
    };

    const handleStay = () => {
        onResolve();
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveAll();
            onResolve();
            pendingCallback();
        } catch (e) {
            // failed to save, keep dialog open or close it?
            // Usually if save fails, we close the dialog so they see the toast and stay on page.
            onResolve();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 shadow-2xl rounded-3xl p-8 max-w-md w-full"
                >
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                            <AlertCircle className="w-6 h-6 text-orange-500" strokeWidth={2} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-foreground dark:text-white/90">Unsaved Changes</h3>
                            <p className="text-sm text-muted-foreground mt-1">You have unsaved changes. What would you like to do?</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 mt-8">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isSaving ? "Saving..." : "Save & Continue"}
                        </button>
                        <button
                            onClick={handleDiscard}
                            disabled={isSaving}
                            className="w-full px-4 py-3 bg-red-500/10 text-red-600 font-medium rounded-xl hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                            Discard Changes
                        </button>
                        <button
                            onClick={handleStay}
                            disabled={isSaving}
                            className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 text-foreground dark:text-white/80 font-medium rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                            Stay Here
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
