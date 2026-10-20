"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DraftPayload, MailDraft } from '@/lib/drafts';
import { recoveryKey } from '@/lib/draft-recovery';

/** Saves are serialized and revision checked. Provider events never replace the editor. */
export function useDraftComposer(accountId: string | undefined, initial: MailDraft | undefined, payload: DraftPayload, hasContent: boolean, suspended: boolean) {
    const [seed] = useState(() => ({ id: initial?.id || crypto.randomUUID(), serialized: initial ? JSON.stringify(initial.payload) : '' }));
    const id = useRef(seed.id);
    const revision = useRef(initial?.revision || 0);
    const persisted = useRef<MailDraft | null>(initial || null);
    const serialized = useMemo(() => JSON.stringify(payload), [payload]);
    const latest = useRef({ payload, serialized, hasContent });
    const lastSaved = useRef(seed.serialized);
    const queue = useRef<Promise<MailDraft | null>>(Promise.resolve(initial || null));
    const alive = useRef(true);
    const completed = useRef(false);
    const maxWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [state, setState] = useState(initial?.state || 'new');
    const [error, setError] = useState<string | null>(initial?.error || null);
    const [saving, setSaving] = useState(false);
    const journal = useCallback(() => {
        if (!accountId || completed.current || !latest.current.hasContent || latest.current.serialized === lastSaved.current) return;
        try { localStorage.setItem(recoveryKey(accountId, id.current), JSON.stringify({ id: id.current, revision: revision.current, payload: latest.current.payload })); } catch { /* SQLite autosave remains the primary persistence path. */ }
    }, [accountId]);
    const clearJournal = useCallback(() => { try { if (accountId) localStorage.removeItem(recoveryKey(accountId, id.current)); } catch {} }, [accountId]);
    useEffect(() => {
        window.addEventListener('beforeunload', journal);
        return () => { window.removeEventListener('beforeunload', journal); journal(); };
    }, [journal]);
    useEffect(() => { latest.current = { payload, serialized, hasContent }; }, [payload, serialized, hasContent]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(maxWait.current); }; }, []);

    const flush = useCallback(() => {
        const task = queue.current.catch(() => null).then(async () => {
            if (completed.current || !accountId) return persisted.current;
            const snapshot = latest.current;
            if ((!snapshot.hasContent && !persisted.current) || snapshot.serialized === lastSaved.current) return persisted.current;
            if (alive.current) { setSaving(true); setError(null); }
            try {
                const record = await invoke<MailDraft>('save_draft', { accountId, id: id.current, expectedRevision: revision.current, payload: snapshot.payload });
                persisted.current = record; revision.current = record.revision; lastSaved.current = snapshot.serialized;
                if (latest.current.serialized === snapshot.serialized) clearJournal();
                if (alive.current) setState(record.state);
                return record;
            } catch (failure) {
                if (alive.current) setError(String(failure));
                journal();
                throw failure;
            } finally { if (alive.current) setSaving(false); }
        });
        queue.current = task;
        return task;
    }, [accountId, clearJournal, journal]);

    useEffect(() => {
        if (suspended || completed.current || serialized === lastSaved.current || !hasContent && !persisted.current) {
            clearTimeout(maxWait.current); maxWait.current = undefined; return;
        }
        const commit = () => { clearTimeout(maxWait.current); maxWait.current = undefined; void flush().catch(() => {}); };
        // A long uninterrupted typing session is still saved every two seconds.
        if (!maxWait.current) maxWait.current = setTimeout(commit, 2000);
        const timer = setTimeout(commit, 500);
        return () => clearTimeout(timer);
    }, [serialized, suspended, flush, hasContent]);
    useEffect(() => {
        if (!accountId) return;
        let disposed = false; let stop: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
        void listen<string>('drafts:updated', event => {
            if (event.payload !== accountId || completed.current) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!persisted.current) return;
                void invoke<{ state: string; error: string | null }>('draft_status', { accountId, id: id.current }).then(status => {
                    if (!disposed) {
                        if (status.state === 'sent') { completed.current = true; clearJournal(); }
                        setState(status.state); setError(status.error);
                    }
                }).catch(() => {});
            }, 700);
        }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
        return () => { disposed = true; clearTimeout(timer); stop?.(); };
    }, [accountId, clearJournal]);

    const release = useCallback(async () => {
        if (accountId && persisted.current) await invoke('release_draft', { accountId, id: id.current });
    }, [accountId]);
    const discard = useCallback(async () => {
        const record = await flush();
        if (accountId && record) await invoke('discard_draft', { accountId, id: record.id, expectedRevision: record.revision });
        completed.current = true;
        clearJournal();
    }, [accountId, flush, clearJournal]);
    const markSent = useCallback(() => { completed.current = true; clearJournal(); }, [clearJournal]);
    const saveCopy = useCallback(() => {
        const task = queue.current.catch(() => null).then(async () => {
            if (!accountId) return null;
            const old = id.current; const snapshot = latest.current;
            if (alive.current) setSaving(true);
            try {
                const record = await invoke<MailDraft>('fork_draft', { accountId, id: old, payload: snapshot.payload });
                clearJournal(); id.current = record.id; revision.current = record.revision; persisted.current = record;
                lastSaved.current = snapshot.serialized;
                if (alive.current) { setState(record.state); setError(null); }
                await invoke('release_draft', { accountId, id: old }).catch(() => {});
                return record;
            } finally { if (alive.current) setSaving(false); }
        });
        queue.current = task; return task;
    }, [accountId, clearJournal]);
    const resolveSend = useCallback(async (delivered: boolean) => {
        if (!accountId || !persisted.current) return;
        setSaving(true);
        try {
            const record = await invoke<MailDraft | null>('resolve_draft_send', { accountId, id: id.current, expectedRevision: revision.current, delivered });
            if (record) { persisted.current = record; revision.current = record.revision; setState(record.state); }
            else { completed.current = true; clearJournal(); setState('sent'); }
            setError(null);
        } finally { if (alive.current) setSaving(false); }
    }, [accountId, clearJournal]);
    return { flush, release, discard, markSent, saveCopy, resolveSend, state, error, saving, blocked: ['sending', 'send_unknown', 'sent'].includes(state), unconfirmed: ['checking', 'needs_attachments'].includes(state) };
}
