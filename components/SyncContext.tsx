"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode, Dispatch, SetStateAction } from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {toast} from 'sonner';
import { useAuth } from './AuthContext';

interface SyncContextType {
    isSyncing: boolean;
    setIsSyncing: Dispatch<SetStateAction<boolean>>;
    syncMessage: string | null;
    setSyncMessage: Dispatch<SetStateAction<string | null>>;
    unreadCounts: Record<string, number>;
    setUnreadCounts: Dispatch<SetStateAction<Record<string, number>>>;
    syncTriggerCount: number;
    triggerSync: () => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

function useAccountState<T>(owner: string, initial: T, transient=false): [T, Dispatch<SetStateAction<T>>] {
    const { accountEpoch, isAccountCurrent } = useAuth();
    const key=transient?`${owner}:${accountEpoch}`:owner;
    const [values, setValues] = useState<Record<string, T>>({});
    const set = useCallback((update: SetStateAction<T>) => {
        if (!isAccountCurrent(owner, accountEpoch)) return;
        setValues(previous => ({ ...(transient?{}:previous), [key]: typeof update === 'function' ? (update as (value: T) => T)(previous[key] ?? initial) : update }));
    }, [owner, key, transient, initial, accountEpoch, isAccountCurrent]);
    return [values[key] ?? initial, set];
}
const EMPTY_COUNTS: Record<string, number> = {};

export function SyncProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const owner = user?.id ?? '';
    useEffect(()=>{const stop=listen<{subject:string}>('outbox:sent',event=>toast.success('Message sent',{description:event.payload.subject||'(No subject)'}));return()=>{void stop.then(fn=>fn()).catch(()=>{});};},[]);
    useEffect(()=>{
        if(!owner)return;
        const update=()=>{void invoke('set_network_status',{online:navigator.onLine}).catch(()=>{});};
        update();window.addEventListener('online',update);window.addEventListener('offline',update);
        return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
    },[owner]);
    const [isSyncing, setIsSyncing] = useAccountState(owner, false,true);
    const [syncMessage, setSyncMessage] = useAccountState<string | null>(owner, null,true);
    const [unreadCounts, setUnreadCounts] = useAccountState(owner, EMPTY_COUNTS);
    const [syncTriggerCount, setSyncTriggerCount] = useAccountState(owner, 0,true);

    const triggerSync = useCallback(() => setSyncTriggerCount(c => c + 1), [setSyncTriggerCount]);

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
