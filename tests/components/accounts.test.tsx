import { StrictMode, useEffect } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { User } from '@/components/AuthContext';

const native = vi.hoisted(() => ({ invoke: vi.fn(), events: new Map<string, (event: { payload: { account_id: string } }) => void>(), router: { push: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: { account_id: string } }) => void) => { native.events.set(name, callback); return () => native.events.delete(name); }) }));
vi.mock('next/navigation', () => ({ useRouter: () => native.router, usePathname: () => '/inbox' }));
vi.mock('@/components/SessionExpiredPopup', () => ({ SessionExpiredPopup: ({ isOpen, email }: { isOpen: boolean; email?: string }) => isOpen ? <p>Reconnect {email}</p> : null }));
import { AuthProvider, useAuth } from '@/components/AuthContext';
import { SyncProvider, useSync } from '@/components/SyncContext';
import { AccountList } from '@/components/accounts/AccountList';

const profile = (id: string): User => ({ id, email: `${id}@example.com`, name: `Account ${id}`, picture: '', provider: { type: 'Google' }, needs_reauth: false });
let profiles: User[], active: string | null;
let auth: ReturnType<typeof useAuth>, sync: ReturnType<typeof useSync>;
function Probe() {
    const authValue = useAuth(), syncValue = useSync();
    useEffect(() => { auth = authValue; sync = syncValue; }, [authValue, syncValue]);
    return <><p>Active: {authValue.user?.id ?? 'none'}</p><p>Unread: {syncValue.unreadCounts.inbox ?? 0}</p><AccountList /></>;
}
function Guard({ run }: { run: () => Promise<void> }) { const { registerAccountGuard } = useAuth(); useEffect(() => registerAccountGuard(run), [registerAccountGuard, run]); return null; }
function App({ guard }: { guard?: () => Promise<void> }) { return <AuthProvider><SyncProvider>{guard && <Guard run={guard} />}<Probe /></SyncProvider></AuthProvider>; }
beforeEach(() => {
    localStorage.removeItem('orion_account_identity');
    profiles = [profile('a'), profile('b')]; active = 'a'; native.events.clear(); native.invoke.mockReset(); native.router.push.mockReset();
    native.invoke.mockImplementation(async (name: string, args?: { accountId?: string }) => {
        if (name === 'get_app_settings') return { app_lock_enabled: false };
        if (name === 'bootstrap_accounts') return { user: profiles.find(p => p.id === active) ?? null, needs_refresh: false };
        if (name === 'list_accounts') return profiles;
        if (name === 'get_current_user') return profiles.find(p => p.id === active) ?? null;
        if (name === 'switch_account') { active = args?.accountId ?? null; return profiles.find(p => p.id === active); }
        if (name === 'logout_user') { profiles = profiles.filter(p => p.id !== args?.accountId); if (active === args?.accountId) active = profiles[0]?.id ?? null; return profiles.find(p => p.id === active) ?? null; }
        throw new Error(`Unexpected native command: ${name}`);
    });
});

it('uses the preferred startup account once and preserves later selections on reconnect', async () => {
    localStorage.setItem('orion_account_identity',JSON.stringify({startup:'b'}));
    render(<App/>);
    await screen.findByText('Active: b');
    await act(async()=>auth.switchAccount('a'));
    expect(auth.user?.id).toBe('a');
    act(()=>window.dispatchEvent(new Event('online')));
    await waitFor(()=>expect(native.invoke.mock.calls.filter(([name])=>name==='bootstrap_accounts')).toHaveLength(2));
    expect(auth.user?.id).toBe('a');
});

it('bootstraps once in Strict Mode and switches using the custom account picker', async () => {
    render(<StrictMode><App /></StrictMode>);
    await screen.findByText('Active: a');
    expect(native.invoke.mock.calls.filter(([name]) => name === 'bootstrap_accounts')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Account b, b@example.com' }));
    await screen.findByText('Active: b');
    expect(screen.getByRole('button', { name: /Account b.*active account/ })).toHaveAttribute('aria-current', 'true');
});

it('isolates unread state and ignores an old account setter after switching', async () => {
    render(<App />); await screen.findByText('Active: a');
    const setA = sync.setUnreadCounts;
    act(() => setA({ inbox: 8 }));
    await act(async () => auth.switchAccount('b'));
    expect(screen.getByText('Unread: 0')).toBeInTheDocument();
    act(() => setA({ inbox: 99 }));
    expect(screen.getByText('Unread: 0')).toBeInTheDocument();
    act(() => sync.setUnreadCounts({ inbox: 3 }));
    await act(async () => auth.switchAccount('a'));
    expect(screen.getByText('Unread: 8')).toBeInTheDocument();
    act(() => setA({ inbox: 101 }));
    expect(screen.getByText('Unread: 8')).toBeInTheDocument();
});

it('waits for draft guards, rejects overlapping changes, and preserves the old account on guard failure', async () => {
    let finish!: () => void;
    const guard = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<App guard={guard} />); await screen.findByText('Active: a');
    let switching!: Promise<void>;
    act(() => { switching = auth.switchAccount('b'); });
    expect(auth.accountBusy).toBe(true);
    expect(native.invoke.mock.calls.some(([name]) => name === 'switch_account')).toBe(false);
    await expect(auth.switchAccount('b')).rejects.toThrow('already in progress');
    await act(async () => { finish(); await switching; });
    expect(screen.getByText('Active: b')).toBeInTheDocument();
    guard.mockRejectedValueOnce(new Error('Save Settings first'));
    await act(async () => { await expect(auth.switchAccount('a')).rejects.toThrow('Save Settings first'); });
    expect(screen.getByText('Active: b')).toBeInTheDocument(); expect(auth.accountBusy).toBe(false);
});

it('keeps other accounts signed in and chooses the remaining account on sign-out', async () => {
    render(<App />); await screen.findByText('Active: a');
    await act(async () => auth.logout('a'));
    expect(screen.getByText('Active: b')).toBeInTheDocument();
    expect(auth.accounts.map(p => p.id)).toEqual(['b']);
    expect(native.router.push).not.toHaveBeenCalledWith('/');
    await act(async () => auth.logout('b'));
    expect(screen.getByText('Active: none')).toBeInTheDocument(); expect(native.router.push).toHaveBeenCalledWith('/');
});

it('keeps expired accounts and cached identity instead of logging out every mailbox', async () => {
    render(<App />); await screen.findByText('Active: a');
    act(() => native.events.get('auth:account_expired')?.({ payload: { account_id: 'b' } }));
    await waitFor(() => expect(auth.user?.id).toBe('a'));
    expect(screen.queryByText('Reconnect a@example.com')).not.toBeInTheDocument();
    act(() => native.events.get('auth:session_expired')?.({ payload: { account_id: 'a' } }));
    await screen.findByText('Reconnect a@example.com');
    expect(auth.user?.id).toBe('a'); expect(auth.accounts).toHaveLength(2);
    expect(native.invoke.mock.calls.some(([name]) => name === 'logout_user')).toBe(false);
});

it('preserves the current mailbox when adding another account is cancelled', async () => {
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (name: string, args?: { accountId?: string }) => { if (name === 'login_google') throw new Error('Sign-in cancelled'); return handler(name, args); });
    render(<App />); await screen.findByText('Active: a');
    await act(async () => { await expect(auth.loginWithGoogle()).rejects.toThrow('Sign-in cancelled'); });
    expect(auth.user?.id).toBe('a'); expect(auth.accounts).toHaveLength(2); expect(auth.accountBusy).toBe(false);
});

it('keeps cached mail accessible when startup requires reconnecting', async () => {
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (name: string, args?: { accountId?: string }) => name === 'bootstrap_accounts' ? { user: profile('a'), needs_refresh: true } : handler(name, args));
    render(<App />); await screen.findByText('Reconnect a@example.com');
    expect(auth.user?.id).toBe('a'); expect(auth.needsRefresh).toBe(true);
    expect(native.invoke.mock.calls.some(([name]) => name === 'logout_user')).toBe(false);
});

it('blocks adding a fourth account before opening Google but still allows reconnecting', async () => {
    profiles.push(profile('c'));
    const handler = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (name: string, args?: { accountId?: string }) => name === 'login_google' ? profile('a') : handler(name, args));
    render(<App />); await screen.findByText('Active: a');
    await act(async () => { await expect(auth.addGoogleAccount()).rejects.toThrow('up to 3 accounts'); });
    expect(native.invoke.mock.calls.some(([name]) => name === 'login_google')).toBe(false);
    await act(async () => auth.loginWithGoogle());
    expect(native.invoke.mock.calls.filter(([name]) => name === 'login_google')).toHaveLength(1);
    expect(auth.accounts).toHaveLength(3);
});
