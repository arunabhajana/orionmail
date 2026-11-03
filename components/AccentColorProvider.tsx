"use client";

import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';

export type AccentColorName = 'blue' | 'purple' | 'rose' | 'emerald' | 'orange';

interface AccentColorContextType {
    accentColor: AccentColorName;
    setAccentColor: (color: AccentColorName) => void;
}

export const colorMap: Record<AccentColorName, { light: string; dark: string }> = {
    blue: { light: '#277bf1', dark: '#3b82f6' },
    purple: { light: '#9333ea', dark: '#a855f7' },
    rose: { light: '#e11d48', dark: '#f43f5e' },
    emerald: { light: '#059669', dark: '#10b981' },
    orange: { light: '#ea580c', dark: '#f97316' },
};

function subscribeAccent(update: () => void) {
    window.addEventListener('storage', update); window.addEventListener('orion:accent_changed', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('orion:accent_changed', update); };
}
function accentSnapshot(): AccentColorName {
    const value = localStorage.getItem('orbitmail_accent');
    return value && Object.hasOwn(colorMap, value) ? value as AccentColorName : 'blue';
}
const serverAccent = (): AccentColorName => 'blue';
const AccentColorContext = createContext<AccentColorContextType | undefined>(undefined);

export function AccentColorProvider({ children }: { children: React.ReactNode }) {
    const accentColor = useSyncExternalStore(subscribeAccent, accentSnapshot, serverAccent);
    const { theme, resolvedTheme } = useTheme();

    const setAccentColor = (color: AccentColorName) => {
        localStorage.setItem('orbitmail_accent', color);
        window.dispatchEvent(new Event('orion:accent_changed'));
    };

    useEffect(() => {
        const isDark = resolvedTheme === 'dark';
        const hex = isDark ? colorMap[accentColor].dark : colorMap[accentColor].light;
        document.documentElement.style.setProperty('--color-primary', hex);
    }, [accentColor, theme, resolvedTheme]);

    return (
        <AccentColorContext.Provider value={{ accentColor, setAccentColor }}>
            {children}
        </AccentColorContext.Provider>
    );
}

export function useAccentColor() {
    const context = useContext(AccentColorContext);
    if (context === undefined) {
        throw new Error('useAccentColor must be used within an AccentColorProvider');
    }
    return context;
}
