import { invoke } from '@tauri-apps/api/core';
const pending = new Map<string, Promise<void>>();
export const recoveryKey = (account: string, id: string) => `orion:draft-recovery:${account}:${id}`;
/** A small shutdown journal covers renderer unload while a SQLite save is in flight. */
export function recoverLocalDrafts(accountId: string): Promise<void> {
    const running = pending.get(accountId); if (running) return running;
    const task = (async () => {
        const prefix = `orion:draft-recovery:${accountId}:`;
        const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix));
        const failures: string[] = [];
        for (const key of keys) {
            const raw = localStorage.getItem(key); if (!raw) continue;
            let snapshot; try { snapshot = JSON.parse(raw); } catch { continue; }
            try {
                await invoke('recover_draft', { accountId, id: snapshot.id, expectedRevision: snapshot.revision, payload: snapshot.payload });
                if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
            } catch (error) { failures.push(String(error)); }
        }
        if (failures.length) throw new Error(failures[0]);
    })().finally(() => pending.delete(accountId));
    pending.set(accountId, task); return task;
}
