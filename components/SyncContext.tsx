"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SyncContextType {
    isSyncing: boolean;
    setIsSyncing: (value: boolean) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
    const [isSyncing, setIsSyncing] = useState(false);

    return (
        <SyncContext.Provider value={{ isSyncing, setIsSyncing }}>
            {children}
        </SyncContext.Provider>
    );
}

export function useSync() {
    const context = useContext(SyncContext);
    if (!context) {
        throw new Error("useSync must be used within a SyncProvider");
    }
    return context;
}
