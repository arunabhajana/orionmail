import { createRef } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), accountId: 'a' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/inbox' }));
vi.mock('@/components/AuthContext', () => ({ useAuth: () => ({ user: { id: native.accountId } }) }));
vi.mock('@/components/AppPreferencesContext', () => ({ useAppPreferences: () => ({ preferences: { markRead: 'manual', confirmExternalLinks: true } }) }));
import { useEmailBody } from '@/hooks/useEmailBody';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const detail = (body: string) => ({ body, attachments: [] });
beforeEach(() => { native.accountId = 'a'; native.invoke.mockReset(); });

it('clears the old body immediately when accounts share the same message UID', async () => {
    const next = deferred<ReturnType<typeof detail>>();
    native.invoke.mockImplementation((_command, args) => args.accountId === 'a' ? Promise.resolve(detail('Account A')) : next.promise);
    const iframe = createRef<HTMLIFrameElement>();
    const { result, rerender } = renderHook(() => useEmailBody('inbox-7', 7, false, 'inbox', iframe, undefined, undefined, 1));
    await waitFor(() => expect(result.current.bodyContent).toBe('Account A'));
    native.accountId = 'b';
    rerender();
    expect(result.current.bodyContent).toBe('');
    expect(result.current.isLoadingBody).toBe(true);
    await act(async () => { next.resolve(detail('Account B')); });
    await waitFor(() => expect(result.current.bodyContent).toBe('Account B'));
});

it('ignores a late body response from the previous account', async () => {
    const old = deferred<ReturnType<typeof detail>>();
    native.invoke.mockImplementation((_command, args) => args.accountId === 'a' ? old.promise : Promise.resolve(detail('Account B')));
    const iframe = createRef<HTMLIFrameElement>();
    const { result, rerender } = renderHook(() => useEmailBody('inbox-7', 7, false, 'inbox', iframe, undefined, undefined, 1));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
    native.accountId = 'b';
    rerender();
    await waitFor(() => expect(result.current.bodyContent).toBe('Account B'));
    await act(async () => { old.resolve(detail('Stale account A')); });
    expect(result.current.bodyContent).toBe('Account B');
});

it('invalidates the visible body when mailbox UID validity changes', async () => {
    const next = deferred<ReturnType<typeof detail>>();
    native.invoke.mockImplementation((_command, args) => args.expectedUidValidity === 1 ? Promise.resolve(detail('Old mailbox')) : next.promise);
    const iframe = createRef<HTMLIFrameElement>();
    const { result, rerender } = renderHook(({ validity }) => useEmailBody('inbox-7', 7, false, 'inbox', iframe, undefined, undefined, validity), { initialProps: { validity: 1 } });
    await waitFor(() => expect(result.current.bodyContent).toBe('Old mailbox'));
    rerender({ validity: 2 });
    expect(result.current.bodyContent).toBe('');
    await act(async () => { next.resolve(detail('New mailbox')); });
    await waitFor(() => expect(result.current.bodyContent).toBe('New mailbox'));
});
