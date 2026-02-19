"use client";


import { Window as TauriWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, RefreshCw } from "lucide-react";
import { useEffect, useState, memo } from "react";
import { cn } from "@/lib/utils";

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
    iconSize = 18,
    iconStrokeWidth = 2.5,
    iconRx,
    ...props
}: WindowControlProps) => (
    <button
        className={cn(
            "w-[36px] h-[26px] flex items-center justify-center rounded-md transition-all active:scale-95",
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
    const [isSyncing, setIsSyncing] = useState(false);

    useEffect(() => {
        // Simulate sync cycle every 5 seconds
        const interval = setInterval(() => setIsSyncing(prev => !prev), 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div
            className={cn(
                "flex items-center gap-2 px-2 py-0.5 rounded-full select-none transition-all duration-300",
                "bg-transparent"
            )}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
            {isSyncing ? (
                <>
                    <RefreshCw size={12} className="text-muted-foreground animate-spin" />
                    <span className="text-[10px] font-medium text-muted-foreground tracking-tight">
                        Syncing...
                    </span>
                </>
            ) : (
                <>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
                    <span className="text-[10px] font-medium text-foreground/70 tracking-tight">
                        Online
                    </span>
                </>
            )}
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
            <div className="justify-self-end flex gap-1.5 px-1.5">
                <WindowControl
                    icon={Minus}
                    onClick={() => { appWindow?.minimize(); }}
                    aria-label="Minimize"
                />
                <WindowControl
                    icon={Square}
                    iconSize={16}
                    iconRx={4}
                    onClick={() => { appWindow?.toggleMaximize(); }}
                    aria-label="Maximize"
                />
                <WindowControl
                    icon={X}
                    onClick={() => { appWindow?.close(); }}
                    className="hover:bg-[#e81123] hover:text-white"
                    aria-label="Close"
                />
            </div>
        </header>
    );
}
