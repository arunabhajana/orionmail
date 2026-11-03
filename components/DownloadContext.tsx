"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type DownloadStatus = 'downloading' | 'completed' | 'error';

export interface DownloadItem {
    accountId: string;
    id: string;
    filename: string;
    status: DownloadStatus;
    progress: number;
    path?: string;
}

interface DownloadContextType {
    downloads: DownloadItem[];
    addDownload: (filename: string) => string;
    updateDownloadProgress: (id: string, progress: number) => void;
    updateDownloadStatus: (id: string, status: DownloadStatus, path?: string) => void;
    removeDownload: (id: string) => void;
    clearDownloads: () => void;
    activeCount: number;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export function DownloadProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const owner = user?.id ?? '';
    const [downloads, setDownloads] = useState<DownloadItem[]>([]);

    const addDownload = useCallback((filename: string) => {
        const id = crypto.randomUUID();
        setDownloads(prev => [{ id, accountId: owner, filename, status: 'downloading', progress: 0 }, ...prev]);
        return id;
    }, [owner]);

    const updateDownloadProgress = useCallback((id: string, progress: number) => {
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, progress } : d));
    }, []);

    const updateDownloadStatus = useCallback((id: string, status: DownloadStatus, path?: string) => {
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, status, path } : d));
    }, []);

    const removeDownload = useCallback((id: string) => {
        setDownloads(prev => prev.filter(d => d.id !== id));
    }, []);

    const clearDownloads = useCallback(() => {
        setDownloads(previous => previous.filter(item => item.accountId !== owner));
    }, [owner]);

    const visibleDownloads = downloads.filter(item => item.accountId === owner);
    const activeCount = visibleDownloads.filter(d => d.status === 'downloading').length;

    return (
        <DownloadContext.Provider value={{
            downloads: visibleDownloads,
            addDownload,
            updateDownloadProgress,
            updateDownloadStatus,
            removeDownload,
            clearDownloads,
            activeCount
        }}>
            {children}
        </DownloadContext.Provider>
    );
}

export function useDownloads() {
    const context = useContext(DownloadContext);
    if (context === undefined) {
        throw new Error('useDownloads must be used within a DownloadProvider');
    }
    return context;
}
