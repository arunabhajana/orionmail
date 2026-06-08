"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface BackgroundTask {
    id: string;
    name: string;
}

interface BackgroundTasksContextType {
    tasks: BackgroundTask[];
    startTask: (id: string, name: string) => void;
    endTask: (id: string) => void;
}

const BackgroundTasksContext = createContext<BackgroundTasksContextType | null>(null);

export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
    const [tasks, setTasks] = useState<BackgroundTask[]>([]);

    const startTask = useCallback((id: string, name: string) => {
        setTasks((prev) => {
            if (prev.find((t) => t.id === id)) return prev;
            return [...prev, { id, name }];
        });
    }, []);

    const endTask = useCallback((id: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <BackgroundTasksContext.Provider value={{ tasks, startTask, endTask }}>
            {children}
        </BackgroundTasksContext.Provider>
    );
}

export function useBackgroundTasks() {
    const context = useContext(BackgroundTasksContext);
    if (!context) {
        throw new Error("useBackgroundTasks must be used within a BackgroundTasksProvider");
    }
    return context;
}
