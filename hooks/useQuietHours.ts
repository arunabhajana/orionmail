"use client";
import { useEffect, useState } from 'react';
import { useAppPreferences } from '@/components/AppPreferencesContext';
import { quietHoursActive } from '@/lib/app-preferences';

export function useQuietHours() {
    const { preferences } = useAppPreferences();
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        if (!preferences.quietHours) return;
        let timer: ReturnType<typeof setTimeout>;
        const tick = () => { setNow(new Date()); timer = setTimeout(tick, 60000 - Date.now() % 60000); };
        const visible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); } };
        tick();
        document.addEventListener('visibilitychange', visible);
        window.addEventListener('focus', visible);
        return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
    }, [preferences.quietHours]);
    return quietHoursActive(preferences, now);
}
