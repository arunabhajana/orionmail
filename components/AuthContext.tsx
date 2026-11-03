"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRouter } from "next/navigation";
import { SessionExpiredPopup } from "./SessionExpiredPopup";
import { ACCOUNT_LIMIT_MESSAGE, MAX_CONNECTED_ACCOUNTS } from '@/lib/account-policy';

export interface User {
    id: string;
    email: string;
    name: string;
    picture: string;
    provider: { type: string; [key: string]: unknown };
    needs_reauth?: boolean;
}

interface AuthContextType {
    user: User | null;
    accounts: User[];
    accountBusy: boolean;
    accountEpoch: number;
    switchAccount: (id: string, openInbox?: boolean) => Promise<void>;
    refreshAccounts: () => Promise<void>;
    isAccountCurrent: (id: string, epoch?: number) => boolean;
    registerAccountGuard: (guard: () => Promise<void>) => () => void;
    loading: boolean;
    appLockStatus: "checking" | "locked" | "unlocked" | "error";
    appLockError: string | null;
    retryAppUnlock: () => Promise<void>;
    mailboxLoading: boolean;
    setMailboxLoading: (loading: boolean) => void;
    mailboxConnected: boolean;
    setMailboxConnected: (connected: boolean) => void;
    isBootstrappingInbox: boolean;
    setBootstrappingInbox: (bootstrap: boolean) => void;
    needsRefresh: boolean;
    isAuthenticated: boolean;
    loginWithGoogle: () => Promise<void>;
    addGoogleAccount: () => Promise<void>;
    updateDisplayName: (displayName: string) => Promise<void>;
    logout: (accountId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type HelloVerification = { verified: boolean; error?: string };
let helloVerificationPromise: Promise<HelloVerification> | null = null;
let helloVerificationResult: HelloVerification | null = null;

function verifyHelloOnce(retry = false): Promise<HelloVerification> {
    if (retry) helloVerificationResult = null;
    if (helloVerificationResult) return Promise.resolve(helloVerificationResult);
    if (helloVerificationPromise) return helloVerificationPromise;

    helloVerificationPromise = (async () => {
        try {
            const verified = await invoke<boolean>("authenticate_hello", { message: "Unlock OrionMail" });
            helloVerificationResult = { verified };
        } catch (error) {
            helloVerificationResult = { verified: false, error: String(error) };
        } finally {
            helloVerificationPromise = null;
        }
        return helloVerificationResult!;
    })();

    return helloVerificationPromise;
}


/** Native account metadata is authoritative; cached browser identity never restores a signed-out user. */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [accounts, setAccounts] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [accountBusy, setAccountBusy] = useState(false);
    const [accountEpoch, setAccountEpoch] = useState(0);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [mailboxLoading, setMailboxLoadingState] = useState(false);
    const [mailboxConnected, setMailboxConnectedState] = useState(false);
    const [isBootstrappingInbox, setBootstrappingState] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [appLockStatus, setAppLockStatus] = useState<AuthContextType['appLockStatus']>('checking');
    const [appLockError, setAppLockError] = useState<string | null>(null);
    const initializationRef = useRef<Promise<void> | null>(null);
    const active = useRef<User | null>(null);
    const activeEpoch = useRef(0);
    const operation = useRef(false);
    const generation = useRef(0);
    const guards = useRef(new Set<() => Promise<void>>());
    const expiredNotices = useRef(new Set<string>());
    const router = useRouter();
    const isAccountCurrent = useCallback((id: string, epoch?: number) => active.current?.id === id && (epoch === undefined || epoch === activeEpoch.current), []);
    const registerAccountGuard = useCallback((guard: () => Promise<void>) => {
        guards.current.add(guard);
        return () => { guards.current.delete(guard); };
    }, []);
    const commit = useCallback((profile: User | null, reconnect = false) => {
        if (active.current?.id !== profile?.id) { activeEpoch.current++; setAccountEpoch(activeEpoch.current); }
        active.current = profile;
        setUser(profile);
        if (profile) setAccounts(previous => previous.some(entry => entry.id === profile.id) ? previous.map(entry => entry.id === profile.id ? profile : entry) : [...previous, profile]);
        setNeedsRefresh(reconnect || Boolean(profile?.needs_reauth));
        const expired = reconnect || Boolean(profile?.needs_reauth);
        setSessionExpired(Boolean(profile && expired && !expiredNotices.current.has(profile.id)));
        if (profile) { if (expired) expiredNotices.current.add(profile.id); else expiredNotices.current.delete(profile.id); }
        setMailboxLoadingState(false); setMailboxConnectedState(false); setBootstrappingState(false);
        // Retain this legacy display cache for compatibility, never as authentication authority.
        try { if (profile) localStorage.setItem('orion_user', JSON.stringify(profile)); else localStorage.removeItem('orion_user'); } catch {}
    }, []);
    const refreshAccounts = useCallback(async () => {
        const profiles = await invoke<User[]>('list_accounts');
        setAccounts(profiles);
        const selected = profiles.find(profile => profile.id === active.current?.id);
        if (selected?.needs_reauth) {
            active.current = selected; setUser(selected); setNeedsRefresh(true);
            if (!expiredNotices.current.has(selected.id)) { expiredNotices.current.add(selected.id); setSessionExpired(true); }
        }
    }, []);
    const bootstrap = useCallback(async () => {
        const revision = generation.current;
        try {
            const result = await invoke<{ user: User | null; needs_refresh: boolean }>('bootstrap_accounts');
            if (revision !== generation.current) return;
            commit(result.user, result.needs_refresh);
            await refreshAccounts();
            if (!result.user) router.push('/');
        } catch (error) {
            console.error('Auth: Bootstrap failed', error);
            // Do not remove any accounts for a network or transient native error.
            const profile = await invoke<User | null>('get_current_user').catch(() => null);
            if (revision === generation.current) {
                commit(profile);
                await refreshAccounts().catch(() => {});
                if (!profile) router.push('/');
            }
        } finally { setLoading(false); }
    }, [commit, refreshAccounts, router]);

    const unlock = useCallback(async (retry: boolean) => {
        setAppLockStatus('checking'); setAppLockError(null);
        try {
            const settings = await invoke<{ app_lock_enabled?: boolean }>('get_app_settings');
            if (settings.app_lock_enabled) {
                const result = await verifyHelloOnce(retry);
                if (result.error) throw new Error(result.error);
                if (!result.verified) { setAppLockStatus('locked'); return; }
            }
            setAppLockStatus('unlocked');
            await bootstrap();
        } catch (error) { setAppLockError(String(error)); setAppLockStatus('error'); }
    }, [bootstrap]);
    const retryAppUnlock = useCallback(() => unlock(true), [unlock]);
    useEffect(() => {
        initializationRef.current ??= unlock(false);
        const expire = (id: string | undefined) => {
            if (id && active.current?.id === id) {
                setNeedsRefresh(true);
                if (!expiredNotices.current.has(id)) { expiredNotices.current.add(id); setSessionExpired(true); }
                setUser(previous => previous?.id === id ? { ...previous, needs_reauth: true } : previous);
            }
            void refreshAccounts().catch(console.error);
        };
        const stops = [
            listen<{ account_id: string }>('auth:session_expired', event => expire(event.payload?.account_id)),
            listen<{ account_id: string }>('auth:account_expired', event => expire(event.payload?.account_id)),
        ];
        const online = () => { if (!operation.current && active.current) void bootstrap(); };
        window.addEventListener('online', online);
        return () => { stops.forEach(stop => { void stop.then(fn => fn()).catch(console.error); }); window.removeEventListener('online', online); };
    }, [unlock, bootstrap, refreshAccounts]);

    const transition = useCallback(async (action: () => Promise<void>) => {
        if (operation.current) throw new Error('An account change is already in progress.');
        operation.current = true; generation.current++; setAccountBusy(true);
        try {
            for (const guard of [...guards.current]) await guard();
            await action();
        } finally { operation.current = false; setAccountBusy(false); }
    }, []);
    const switchAccount = useCallback(async (id: string, openInbox = false) => {
        if (active.current?.id === id && !openInbox) return;
        await transition(async () => {
            if (active.current?.id !== id) {
                const profile = await invoke<User>('switch_account', { accountId: id });
                commit(profile);
                await refreshAccounts().catch(console.error);
            }
            if (openInbox) router.push('/inbox');
        });
    }, [commit, refreshAccounts, router, transition]);
    const connectGoogle = useCallback(async (adding: boolean) => {
        await transition(async () => {
            if (adding) {
                const connected = await invoke<User[]>('list_accounts');
                if (connected.length >= MAX_CONNECTED_ACCOUNTS) throw new Error(ACCOUNT_LIMIT_MESSAGE);
            }
            const profile = await invoke<User>('login_google');
            commit(profile);
            await refreshAccounts().catch(console.error);
            router.push('/inbox');
            // Native login already queues sync. No duplicate polling/timers per account.
        });
    }, [commit, refreshAccounts, router, transition]);
    const loginWithGoogle = useCallback(() => connectGoogle(false), [connectGoogle]);
    const addGoogleAccount = useCallback(() => connectGoogle(true), [connectGoogle]);
    const updateDisplayName = useCallback(async (displayName: string) => {
        const owner = active.current?.id;
        if (!owner) throw new Error('No active account');
        const profile = await invoke<User>('update_display_name', { accountId: owner, displayName });
        if (active.current?.id !== owner) return;
        active.current = profile; setUser(profile);
        await refreshAccounts();
    }, [refreshAccounts]);
    const logout = useCallback(async (accountId: string) => {
        await transition(async () => {
            const profile = await invoke<User | null>('logout_user', { accountId });
            setAccounts(previous => previous.filter(entry => entry.id !== accountId));
            commit(profile);
            await refreshAccounts().catch(console.error);
            if (!profile) router.push('/');
        });
    }, [commit, refreshAccounts, router, transition]);
    const owner = user?.id;
    const setMailboxLoading = useCallback((value: boolean) => { if (owner && isAccountCurrent(owner, accountEpoch)) setMailboxLoadingState(value); }, [owner, accountEpoch, isAccountCurrent]);
    const setMailboxConnected = useCallback((value: boolean) => { if (owner && isAccountCurrent(owner, accountEpoch)) setMailboxConnectedState(value); }, [owner, accountEpoch, isAccountCurrent]);
    const setBootstrappingInbox = useCallback((value: boolean) => { if (owner && isAccountCurrent(owner, accountEpoch)) setBootstrappingState(value); }, [owner, accountEpoch, isAccountCurrent]);
    return <AuthContext.Provider value={{ user, accounts, accountBusy, accountEpoch, switchAccount, refreshAccounts, isAccountCurrent, registerAccountGuard,
        loading, appLockStatus, appLockError, retryAppUnlock, mailboxLoading, setMailboxLoading, mailboxConnected, setMailboxConnected,
        isBootstrappingInbox, setBootstrappingInbox, needsRefresh, isAuthenticated: Boolean(user), loginWithGoogle, addGoogleAccount, updateDisplayName, logout }}>
        {children}
        <SessionExpiredPopup email={user?.email} isOpen={sessionExpired} onClose={() => setSessionExpired(false)} onLogin={() => { setSessionExpired(false); void loginWithGoogle().catch(console.error); }} />
    </AuthContext.Provider>;
};
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
