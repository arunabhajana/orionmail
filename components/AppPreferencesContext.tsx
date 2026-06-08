"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export interface AppPreferences {
    dndEnabled: boolean;
    smartActionsGlobal: boolean;
    smartActionsOtp: boolean;
    smartActionsMeetings: boolean;
    smartActionsCommerce: boolean;
    smartActionsTravel: boolean;
}

const defaultPreferences: AppPreferences = {
    dndEnabled: false,
    smartActionsGlobal: true,
    smartActionsOtp: true,
    smartActionsMeetings: true,
    smartActionsCommerce: true,
    smartActionsTravel: true,
};

interface AppPreferencesContextType {
    preferences: AppPreferences;
    updatePreferences: (updates: Partial<AppPreferences>) => void;
}

const AppPreferencesContext = createContext<AppPreferencesContextType | null>(null);

export function AppPreferencesProvider({ children }: { children: React.ReactNode }) {
    const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        try {
            const stored = localStorage.getItem("orion_app_preferences");
            if (stored) {
                setPreferences({ ...defaultPreferences, ...JSON.parse(stored) });
            }
        } catch (e) {
            console.error("Failed to load app preferences", e);
        }
        setIsLoaded(true);
    }, []);

    const updatePreferences = (updates: Partial<AppPreferences>) => {
        setPreferences((prev) => {
            const next = { ...prev, ...updates };
            try {
                localStorage.setItem("orion_app_preferences", JSON.stringify(next));
            } catch (e) {
                console.error("Failed to save app preferences", e);
            }
            return next;
        });
    };

    if (!isLoaded) return <>{children}</>;

    return (
        <AppPreferencesContext.Provider value={{ preferences, updatePreferences }}>
            {children}
        </AppPreferencesContext.Provider>
    );
}

export function useAppPreferences() {
    const context = useContext(AppPreferencesContext);
    if (!context) {
        throw new Error("useAppPreferences must be used within an AppPreferencesProvider");
    }
    return context;
}
