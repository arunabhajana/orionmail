"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

export type AccentColorName = 'blue' | 'purple' | 'rose' | 'emerald' | 'orange';

interface AccentColorContextType {
    accentColor: AccentColorName;
    setAccentColor: (color: AccentColorName) => void;
}

const colorMap: Record<AccentColorName, { light: string; dark: string }> = {
    blue: { light: '#277bf1', dark: '#3b82f6' },
    purple: { light: '#9333ea', dark: '#a855f7' },
    rose: { light: '#e11d48', dark: '#f43f5e' },
    emerald: { light: '#059669', dark: '#10b981' },
    orange: { light: '#ea580c', dark: '#f97316' },
};

const AccentColorContext = createContext<AccentColorContextType | undefined>(undefined);

export function AccentColorProvider({ children }: { children: React.ReactNode }) {
    const [accentColor, setAccentColorState] = useState<AccentColorName>('blue');
    const { theme, resolvedTheme } = useTheme();

    useEffect(() => {
        const stored = localStorage.getItem('orbitmail_accent');
        if (stored && colorMap[stored as AccentColorName]) {
            setAccentColorState(stored as AccentColorName);
        }
    }, []);

    const setAccentColor = (color: AccentColorName) => {
        setAccentColorState(color);
        localStorage.setItem('orbitmail_accent', color);
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
