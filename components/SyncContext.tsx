"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SyncContextType {
    isSyncing: boolean;
    setIsSyncing: (value: boolean) => void;
    syncMessage: string | null;
    setSyncMessage: (msg: string | null) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);

    return (
        <SyncContext.Provider value={{ isSyncing, setIsSyncing, syncMessage, setSyncMessage }}>
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
