import { afterEach, expect, it, vi } from 'vitest';
import { waitForInitialMail } from '@/lib/initial-sync';
afterEach(() => vi.useRealTimers());
it('finishes immediately for a successfully synced empty inbox', async () => {
    const cache = vi.fn().mockResolvedValue(false);
    expect(await waitForInitialMail(cache, async () => ({ inbox_last_sync_at: 123, inbox_sync_in_progress: false }), new AbortController().signal)).toBe('empty');
    expect(cache).toHaveBeenCalledOnce();
});
it('stops on sync failure rather than hiding the mailbox for two minutes', async () => {
    expect(await waitForInitialMail(async () => false, async () => ({ inbox_sync_error: 'Offline' }), new AbortController().signal)).toBe('failed');
});
it('cancels its wait and removes polling timers on account teardown', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const cache = vi.fn().mockResolvedValue(false);
    const waiting = waitForInitialMail(cache, async () => ({}), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(); expect(await waiting).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000); expect(cache).toHaveBeenCalledOnce();
});
it('never overlaps slow cache reads and stops when recent mail becomes available', async () => {
    vi.useFakeTimers(); let active = 0, maximum = 0, reads = 0;
    const cache = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1000)); active--; return ++reads === 2; };
    const waiting = waitForInitialMail(cache, async () => ({}), new AbortController().signal);
    await vi.runAllTimersAsync(); expect(await waiting).toBe('ready');
    expect(maximum).toBe(1); expect(vi.getTimerCount()).toBe(0);
});
