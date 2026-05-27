"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SyncContextType {
    isSyncing: boolean;
    setIsSyncing: (value: boolean) => void;
    syncMessage: string | null;
    setSyncMessage: (msg: string | null) => void;
    unreadCounts: Record<string, number>;
    setUnreadCounts: (value: Record<string, number>) => void;
    syncTriggerCount: number;
    triggerSync: () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [syncTriggerCount, setSyncTriggerCount] = useState(0);

    const triggerSync = () => setSyncTriggerCount(c => c + 1);

    return (
        <SyncContext.Provider value={{
            isSyncing,
            setIsSyncing,
            syncMessage,
            setSyncMessage,
            unreadCounts,
            setUnreadCounts,
            syncTriggerCount,
            triggerSync
        }}>
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
