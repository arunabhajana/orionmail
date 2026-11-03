"use client";
import { useSyncExternalStore } from 'react';
function subscribe(update: () => void) {
    window.addEventListener('storage', update);
    window.addEventListener('orion:dev_tools_toggled', update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener('orion:dev_tools_toggled', update); };
}
const snapshot = () => localStorage.getItem('orion_dev_tools_enabled') === 'true';
const serverSnapshot = () => false;
export function useDevToolsEnabled() { return useSyncExternalStore(subscribe, snapshot, serverSnapshot); }
