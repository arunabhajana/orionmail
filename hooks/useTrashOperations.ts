"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import type { PendingTrashAction, TrashRollback } from '@/lib/trash';

/** Versioned native receipts keep old IPC replies from undoing newer choices. */
export function useTrashOperations(accountId: string | undefined, onRollback: (event: TrashRollback) => boolean | void, selectedId?: string | null) {
    const callback = useRef(onRollback);
    const account = useRef(accountId);
    const generation = useRef(0);
    const pinned = useRef<string | undefined>(undefined);
    useEffect(() => { pinned.current = selectedId?.startsWith('local-') ? selectedId.slice(6) : undefined; }, [selectedId]);
    useEffect(() => { callback.current = onRollback; account.current = accountId; }, [onRollback, accountId]);
    const [state, setState] = useState<{ accountId: string; rows: PendingTrashAction[] }>({ accountId: '', rows: [] });
    const merge = useCallback((rows: PendingTrashAction[], touched = false, authoritative = false) => {
        if (!accountId || account.current !== accountId) return;
        setState(previous => {
            const oldRows = new Map((previous.accountId === accountId ? previous.rows : []).map(row => [row.id, row]));
            const map = authoritative ? new Map<string, PendingTrashAction>() : new Map(oldRows);
            for (const row of rows) {
                const old = oldRows.get(row.id);
                if (old && row.version < old.version) { map.set(row.id, old); continue; }
                map.set(row.id, {
                    ...row, locallyTouched: touched || old?.locallyTouched || row.phase !== 'settled',
                });
            }
            return { accountId, rows: [...map.values()].slice(-500) };
        });
    }, [accountId]);
    const accept = useCallback((row: PendingTrashAction, touched = false) => { ++generation.current; merge([row], touched); }, [merge]);
    useEffect(() => {
        if (!accountId) return;
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failureTimer: ReturnType<typeof setTimeout> | undefined;
        const failures = new Map<string, TrashRollback>();
        const stops: (() => void)[] = [];
        const load = async () => {
            const version = ++generation.current;
            const rows = await invoke<PendingTrashAction[]>('list_trash_actions', { accountId, localId: pinned.current });
            if (!disposed && generation.current === version) merge(rows, false, true);
            return !disposed && generation.current === version ? rows : null;
        };
        const refresh = () => {
            clearTimeout(timer); timer = setTimeout(() => { void load().catch(() => {}); }, 25);
        };
        const flushFailures = async () => {
            try {
                const rows = await load();
                if (disposed) return;
                // A simultaneous enqueue/refresh invalidates this snapshot.
                // Retain the failures until we can compare a current revision.
                if (!rows) { failureTimer = setTimeout(() => { void flushFailures(); }, 90); return; }
                const batch = [...failures.values()]; failures.clear();
                const current = batch.filter(failure => {
                    const row = rows.find(row => row.id === failure.id);
                    if (!row || row.revision !== failure.revision || !row.last_error) return false;
                    return callback.current({ ...failure, source: row.cached ? row.source : undefined }) !== false;
                });
                if (!current.length) return;
                toast.error(current.length > 1 ? `${current.length} mail changes need attention` : current[0].reverted ? 'Mail change reverted' : 'Could not finish updating mail', {
                    id: 'mail-location-failure',
                    description: current[0].error,
                    action: { label: 'Retry', onClick: () => { void invoke('sync_mail_folder', { folder: 'inbox' }).catch(() => {}); } },
                });
            } catch {
                if (!disposed) failureTimer = setTimeout(() => { void flushFailures(); }, 1000);
            }
        };
        void (async () => {
            const failed = await listen<TrashRollback>('trash:failed', event => {
                if (disposed || event.payload.account_id !== accountId) return;
                failures.set(event.payload.id, event.payload);
                clearTimeout(failureTimer);
                failureTimer = setTimeout(() => { void flushFailures(); }, 90);
            });
            if (disposed) { failed(); return; } stops.push(failed);
            const changed = await listen<string>('trash:pending_changed', event => { if (event.payload === accountId) refresh(); });
            if (disposed) { changed(); return; } stops.push(changed);
            await load();
        })().catch(() => {});
        return () => { disposed = true; clearTimeout(timer); clearTimeout(failureTimer); stops.forEach(stop => stop()); };
    }, [accountId, merge]);
    return { operations: state.accountId === accountId ? state.rows : [], accept };
}
