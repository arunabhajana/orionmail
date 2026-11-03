export interface InitialSyncStatus {
    inbox_last_sync_at?: number | null;
    inbox_sync_in_progress?: boolean;
    inbox_sync_error?: string | null;
}
function pause(signal: AbortSignal, ms: number) {
    return new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
    });
}

/** Serial cache reads: no overlapping polls, abandoned timers, or empty-inbox two-minute wait. */
export async function waitForInitialMail(readCache: () => Promise<boolean>, readStatus: () => Promise<InitialSyncStatus>, signal: AbortSignal, timeout = 120000) {
    const deadline = Date.now() + timeout;
    while (!signal.aborted && Date.now() < deadline) {
        const ready = await readCache().catch(() => false);
        if (signal.aborted) return 'cancelled';
        if (ready) return 'ready';
        const status = await readStatus().catch(() => null);
        if (signal.aborted) return 'cancelled';
        if (status?.inbox_sync_error) return 'failed';
        if (status?.inbox_last_sync_at && !status.inbox_sync_in_progress) return 'empty';
        await pause(signal, Math.min(750, Math.max(0, deadline - Date.now())));
    }
    return signal.aborted ? 'cancelled' : 'timeout';
}
