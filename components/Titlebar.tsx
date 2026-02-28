"use client";


import { Window as TauriWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, RefreshCw, CheckCircle2 } from "lucide-react";
import { useEffect, useState, memo } from "react";
import { cn } from "@/lib/utils";
import { useSync } from "@/components/SyncContext";
import { motion, AnimatePresence } from "framer-motion";

// --- Types & Interfaces ---

interface WindowControlProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: React.ElementType;
    className?: string;
    iconClassName?: string;
    iconSize?: number;
    iconStrokeWidth?: number;
    iconRx?: number;
}

// --- Sub-Components ---

/**
 * Reusable Window Control Button
 * Optimized for touch targets and visual consistency.
 */
const WindowControl = memo(({
    icon: Icon,
    className,
    iconClassName,
    iconSize = 14,
    iconStrokeWidth = 2,
    iconRx,
    ...props
}: WindowControlProps) => (
    <button
        className={cn(
            "w-[36px] h-[26px] flex items-center justify-center rounded-md transition-colors",
            "bg-transparent hover:bg-black/5 text-foreground/70",
            className
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        {...props}
    >
        <Icon
            size={iconSize}
            strokeWidth={iconStrokeWidth}
            rx={iconRx}
            className={iconClassName}
        />
    </button>
));
WindowControl.displayName = "WindowControl";

/**
 * Sync Status Indicator
 * Cycles between 'Online' and 'Syncing' states.
 */
function SyncIndicator() {
    const { isSyncing, syncMessage, unreadCount } = useSync();
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <div
            className={cn(
                "flex items-center px-2 py-0.5 rounded-full select-none transition-all duration-300",
                "bg-transparent relative h-6 w-32 overflow-hidden"
            )}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
            <AnimatePresence mode="wait">
                {!isOnline ? (
                    <motion.div
                        key="offline"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 flex items-center gap-2 pl-2"
                    >
                        <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
                        <span className="text-[10px] font-medium text-red-500/80 tracking-tight">
                            Offline
                        </span>
                    </motion.div>
                ) : isSyncing ? (
                    <motion.div
                        key="syncing"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 flex items-center gap-2 pl-2"
                    >
                        <RefreshCw size={12} className="text-orange-500 animate-spin" />
                        <span className="text-[10px] font-semibold text-orange-500/90 tracking-tight uppercase">
                            Syncing...
                        </span>
                    </motion.div>
                ) : unreadCount > 0 ? (
                    <motion.div
                        key="unread"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="absolute inset-0 flex items-center gap-2 pl-2"
                    >
                        <div className="flex items-center justify-center bg-blue-500 text-white text-[9px] font-bold h-4 min-w-[16px] px-1 rounded-full shadow-sm ring-1 ring-white/20">
                            {unreadCount}
                        </div>
                        <span className="text-[10px] font-medium text-foreground/70 tracking-tight">
                            Unread
                        </span>
                    </motion.div>
                ) : (
                    <motion.div
                        key="online"
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 5 }}
                        className="absolute inset-0 flex items-center gap-2 pl-2"
                    >
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
                        <span className="text-[10px] font-medium text-foreground/70 tracking-tight">
                            Online
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// --- Main Component ---

export default function Titlebar() {
    // Use state to safely access window object only on client
    const [appWindow, setAppWindow] = useState<TauriWindow | null>(null);

    useEffect(() => {
        import("@tauri-apps/api/window").then((mod) => {
            setAppWindow(mod.getCurrentWindow());
        });
    }, []);

    if (!appWindow) return null;

    return (
        <header
            className={cn(
                "fixed top-0 left-0 right-0 h-[30px] z-50",
                "grid grid-cols-[1fr_auto_1fr] items-center px-2.5",
                "bg-background/80 backdrop-blur-xl border-b border-border",
                "select-none"
            )}
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
            {/* Left: Status & Utilities */}
            <div className="flex items-center gap-1.5 pl-1">
                <SyncIndicator />
            </div>

            {/* Center: Brand Identity */}
            <div className="justify-self-center pointer-events-none">
                <span className="font-sans font-semibold text-[13px] tracking-[0.3px] text-foreground/85">
                    OrionMail
                </span>
            </div>

            {/* Right: Window Controls */}
            <div className="justify-self-end flex gap-1 px-1">
                <WindowControl
                    icon={Minus}
                    onClick={() => { appWindow?.minimize(); }}
                    aria-label="Minimize"
                />
                <WindowControl
                    icon={Square}
                    iconSize={12}
                    onClick={() => { appWindow?.toggleMaximize(); }}
                    aria-label="Maximize"
                />
                <WindowControl
                    icon={X}
                    onClick={() => { appWindow?.close(); }}
                    className="hover:bg-red-500 hover:text-white"
                    aria-label="Close"
                />
            </div>
        </header>
    );
}
