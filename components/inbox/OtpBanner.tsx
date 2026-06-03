"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OtpBannerProps {
    code: string;
    className?: string;
}

export const OtpBanner: React.FC<OtpBannerProps> = ({ code, className }) => {
    const [copied, setCopied] = useState(false);
    const [toastPos, setToastPos] = useState<{ x: number, y: number } | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleCopy = (e: React.MouseEvent) => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        
        // Calculate safe position to prevent going off-screen
        let x = e.clientX;
        let y = e.clientY + 20; // Default: below cursor
        
        if (typeof window !== 'undefined') {
            const toastWidth = 180; // Wider approximation for safety
            const toastHeight = 40; 
            
            // Horizontal clamping (account for -50% translateX centering)
            if (x + toastWidth / 2 > window.innerWidth - 30) {
                x = window.innerWidth - 30 - toastWidth / 2;
            } else if (x - toastWidth / 2 < 30) {
                x = toastWidth / 2 + 30;
            }
            
            // Vertical clamping
            if (y + toastHeight > window.innerHeight - 30) {
                // If it overflows bottom, show it above the cursor instead
                y = e.clientY - 20 - toastHeight;
            }
        }
        
        setToastPos({ x, y });
        
        setTimeout(() => {
            setCopied(false);
        }, 2000);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "relative overflow-hidden mb-6 rounded-2xl border",
                "bg-primary/5 dark:bg-primary/10",
                "border-primary/20 dark:border-primary/30",
                "shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)]",
                className
            )}
        >
            <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-50 pointer-events-none" />
            
            <div className="relative p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-foreground dark:text-white/90">Verification Code Detected</h4>
                        <p className="text-xs text-muted-foreground dark:text-white/60 mt-0.5">
                            We found a code in this email for quick access.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                    <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-black/5 dark:border-white/10 font-mono font-bold text-lg tracking-widest text-foreground dark:text-white/90 select-all">
                        {code}
                    </div>
                    
                    <button
                        onClick={handleCopy}
                        className={cn(
                            "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300",
                            copied 
                                ? "bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.4)]" 
                                : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md"
                        )}
                        title="Copy to clipboard"
                    >
                        <AnimatePresence mode="wait">
                            {copied ? (
                                <motion.div
                                    key="check"
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.5, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    <Check className="w-5 h-5" />
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="copy"
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.5, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    <Copy className="w-5 h-5" />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </button>
                </div>
            </div>

            {mounted && createPortal(
                <AnimatePresence>
                    {copied && toastPos && (
                        <motion.div
                            initial={{ opacity: 0, y: -5, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 5, scale: 0.95 }}
                            style={{ 
                                left: toastPos.x, 
                                top: toastPos.y + 20, // offset below cursor
                                transform: 'translateX(-50%)' // center horizontally on cursor
                            }}
                            className="fixed z-[9999] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black backdrop-blur-md shadow-lg whitespace-nowrap pointer-events-none"
                        >
                            <Check className="w-3.5 h-3.5" />
                            <span className="text-xs font-semibold tracking-tight">Code copied</span>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </motion.div>
    );
};
