"use client";
import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Refresh active provider views on return; no rapid polling while minimized. */
export function useActiveFolderRefresh(enabled: boolean, folder: string, refresh: () => Promise<unknown>, poll = true) {
    const latest = useRef(refresh);
    useEffect(() => { latest.current = refresh; }, [refresh]);
    useEffect(() => {
        if (!enabled) return;
        let disposed = false; let running = false; let last = Date.now();
        const update = async () => {
            if (disposed || running || document.visibilityState !== 'visible' || Date.now() - last < 15_000) return;
            running = true;
            try {
                if (await getCurrentWindow().isMinimized() || disposed) return;
                last = Date.now(); await latest.current();
            } finally { running = false; }
        };
        const wake = () => { void update().catch(() => {}); };
        const interval = poll ? setInterval(wake, 60_000) : undefined;
        window.addEventListener('focus', wake); window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake);
        return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
    }, [enabled, folder, poll]);
}
