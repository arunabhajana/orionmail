"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from './SettingsContext';
import { Loader2 } from 'lucide-react';

export function UnsavedChangesBar() {
    const { hasUnsavedChanges, isSaving, saveAll, resetAll } = useSettings();

    return (
        <AnimatePresence>
            {hasUnsavedChanges && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-8 px-6 py-4 bg-slate-900 dark:bg-[#1A1A1A] border border-white/10 shadow-2xl rounded-2xl w-full max-w-2xl backdrop-blur-xl"
                >
                    <div className="flex flex-col">
                        <span className="text-white font-medium text-sm">Careful — you have unsaved changes!</span>
                        <span className="text-white/60 text-xs">Don't forget to save before leaving.</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={resetAll}
                            disabled={isSaving}
                            className="px-4 py-2 rounded-xl text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                            Reset
                        </button>
                        <button
                            onClick={saveAll}
                            disabled={isSaving}
                            className="px-6 py-2 rounded-xl text-sm font-medium bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                        >
                            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
