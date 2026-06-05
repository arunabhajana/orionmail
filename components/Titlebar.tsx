"use client";


import { Window as TauriWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, RefreshCw, CheckCircle2, Download, AlertCircle, File, FolderOpen, Terminal, Database, ShieldAlert, FileText, WifiOff, Clock } from "lucide-react";
import { useEffect, useState, memo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSync } from "@/components/SyncContext";
import { useDownloads } from "@/components/DownloadContext";
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
    const { isSyncing, syncMessage, unreadCounts } = useSync();
    const unreadCount = unreadCounts['inbox'] || 0;
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

/**
 * Developer Tools Popover
 */
function DevToolsPopover() {
    const [isOpen, setIsOpen] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [isSimulatedOffline, setIsSimulatedOffline] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Hydrate
        if (typeof window !== 'undefined') {
            setEnabled(localStorage.getItem("orion_dev_tools_enabled") === "true");
            
            const handleToggle = (e: any) => {
                setEnabled(e.detail);
                if (!e.detail) setIsOpen(false);
            };
            window.addEventListener("orion:dev_tools_toggled", handleToggle);
            return () => window.removeEventListener("orion:dev_tools_toggled", handleToggle);
        }
    }, []);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    if (!enabled) return null;

    const simulateError = (type: string) => {
        setIsOpen(false);
        switch(type) {
            case 'session':
                emit("auth:session_expired");
                break;
            case 'sync':
                emit("mail:sync_error", { folder: "inbox", error: "Simulated SQLite database connection drop or network failure during IMAP sync." });
                break;
            case 'body':
                toast.error("Body Fetch Error", { description: "Failed to download email body content. Connection reset by peer." });
                break;
            case 'db':
                toast.error("Database Corruption Detected", { description: "Simulated SQLite structural error in messages table." });
                break;
            case 'timeout':
                // Custom event for useEmailBody.ts to catch and render the orange clock UI
                window.dispatchEvent(new CustomEvent("orion:simulate_error", { detail: "Timeout waiting for message body to fetch" }));
                break;
            case 'offline':
                const newOfflineState = !isSimulatedOffline;
                setIsSimulatedOffline(newOfflineState);
                window.dispatchEvent(new Event(newOfflineState ? 'offline' : 'online'));
                toast.info(newOfflineState ? "Simulated Offline Mode Enabled" : "Simulated Offline Mode Disabled");
                break;
        }
    };

    return (
        <div ref={popoverRef} className="relative flex items-center h-full mr-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "p-1.5 rounded-md transition-colors relative",
                    "hover:bg-black/5 dark:hover:bg-white/10 text-orange-500",
                    isOpen && "bg-black/5 dark:bg-white/10"
                )}
                title="Developer Tools"
            >
                <Terminal size={14} strokeWidth={2} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full right-0 mt-2 w-64 bg-white/90 dark:bg-[#1C1C21]/90 backdrop-blur-2xl rounded-xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden z-[100]"
                    >
                        <div className="px-4 py-3 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
                            <h3 className="text-sm font-semibold text-foreground dark:text-white tracking-tight">Error Simulation</h3>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Trigger application error states</p>
                        </div>
                        <div className="p-2 flex flex-col gap-1">
                            <button onClick={() => simulateError('session')} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <ShieldAlert size={14} className="text-red-500" /> Session Expired
                            </button>
                            <button onClick={() => simulateError('sync')} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <RefreshCw size={14} className="text-orange-500" /> Sync Error
                            </button>
                            <button onClick={() => simulateError('body')} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <FileText size={14} className="text-yellow-500" /> Body Fetch Error
                            </button>
                            <button onClick={() => simulateError('timeout')} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <Clock size={14} className="text-orange-400" /> Simulate Timeout UI
                            </button>
                            <button onClick={() => simulateError('db')} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <Database size={14} className="text-purple-500" /> Database Error
                            </button>
                            <div className="h-px bg-black/5 dark:bg-white/5 my-1 mx-2" />
                            <button onClick={(e) => { e.stopPropagation(); simulateError('offline'); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left text-xs font-medium text-foreground/80 dark:text-white/80">
                                <WifiOff size={14} className={isSimulatedOffline ? "text-red-500" : "text-muted-foreground"} /> 
                                {isSimulatedOffline ? "Disable Offline Mode" : "Enable Offline Mode"}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/**
 * Download Manager Popover
 */
function DownloadManagerPopover() {
    const { downloads, activeCount, clearDownloads } = useDownloads();
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div ref={popoverRef} className="relative flex items-center h-full mr-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "p-1.5 rounded-md transition-colors relative",
                    "hover:bg-black/5 dark:hover:bg-white/10 text-foreground/70 dark:text-white/70",
                    isOpen && "bg-black/5 dark:bg-white/10 text-primary"
                )}
            >
                <Download size={14} strokeWidth={2} />
                {activeCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-primary rounded-full border border-background animate-pulse" />
                )}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full right-0 mt-2 w-72 bg-white/70 dark:bg-[#1C1C21]/70 backdrop-blur-2xl rounded-xl shadow-2xl border border-white/40 dark:border-white/5 overflow-hidden z-[100]"
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 bg-white/30 dark:bg-white/5">
                            <h3 className="text-sm font-semibold text-foreground/70 dark:text-white/70 tracking-tight">Downloads</h3>
                            {downloads.length > 0 && (
                                <button
                                    onClick={clearDownloads}
                                    className="text-[10px] font-medium text-foreground/50 dark:text-white/40 hover:text-primary dark:hover:text-primary transition-colors"
                                >
                                    Clear All
                                </button>
                            )}
                        </div>

                        <div className="max-h-64 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
                            {downloads.length === 0 ? (
                                <div className="py-6 text-center text-foreground/40 dark:text-white/30 text-xs flex flex-col items-center gap-2">
                                    <Download size={20} className="opacity-50" />
                                    <span>No recent downloads</span>
                                </div>
                            ) : (
                                downloads.map(item => (
                                    <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group">
                                        <div className="mt-0.5 shrink-0 bg-primary/10 text-primary p-1.5 rounded-md">
                                            <File size={14} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-foreground/90 dark:text-white/90 truncate">{item.filename}</p>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                {item.status === 'downloading' ? (
                                                    <span className="text-[10px] text-primary animate-pulse font-medium">Downloading...</span>
                                                ) : item.status === 'completed' ? (
                                                    <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                                                        <CheckCircle2 size={10} /> Saved
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-red-500 font-medium flex items-center gap-1">
                                                        <AlertCircle size={10} /> Failed
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {item.status === 'completed' && item.path && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    invoke('show_in_folder', { path: item.path });
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1.5 text-foreground/50 dark:text-white/50 hover:bg-black/5 dark:hover:bg-white/10 hover:text-primary dark:hover:text-primary rounded-md transition-all self-center"
                                                title="Show in folder"
                                            >
                                                <FolderOpen size={14} />
                                            </button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// --- Main Component ---

export default function Titlebar() {
    const { isSyncing, triggerSync } = useSync();
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
            <div className="justify-self-end flex items-center pr-1">
                <button
                    onClick={triggerSync}
                    disabled={isSyncing}
                    className={cn(
                        "p-1.5 rounded-md transition-colors relative mr-1",
                        "hover:bg-black/5 dark:hover:bg-white/10 text-foreground/70 dark:text-white/70"
                    )}
                    title="Manual Sync"
                    style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                >
                    <RefreshCw size={14} strokeWidth={2} className={cn(isSyncing && "animate-spin text-primary")} />
                </button>
                <DevToolsPopover />
                <DownloadManagerPopover />
                <div className="flex gap-1">
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
            </div>
        </header>
    );
}
