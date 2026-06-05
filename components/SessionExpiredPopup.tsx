"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, X, LogIn } from "lucide-react";

interface SessionExpiredPopupProps {
    isOpen: boolean;
    onClose: () => void;
    onLogin: () => void;
}

export function SessionExpiredPopup({ isOpen, onClose, onLogin }: SessionExpiredPopupProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    {/* Highly blurred backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-white/30 dark:bg-black/40 backdrop-blur-3xl"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="relative w-full max-w-sm bg-white dark:bg-[#111111] border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden p-8 flex flex-col items-center text-center"
                    >
                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-muted-foreground"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6">
                            <AlertCircle className="w-8 h-8 text-red-500" />
                        </div>

                        <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">Session Expired</h2>
                        <p className="text-sm text-muted-foreground mb-8">
                            Your Google authentication token has expired. Please log in again to continue syncing your emails.
                        </p>

                        <button
                            onClick={() => {
                                onClose();
                                onLogin();
                            }}
                            className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity"
                        >
                            <LogIn className="w-5 h-5" />
                            Login Again
                        </button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
