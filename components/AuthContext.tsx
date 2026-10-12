"use client";

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRouter } from "next/navigation";
import { SessionExpiredPopup } from "./SessionExpiredPopup";

export interface User {
    id: string;
    email: string;
    name: string;
    picture: string;
    provider: { type: string; [key: string]: any };
}

interface AuthContextType {
    user: User | null;
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

/**
 * Global authentication provider.
 * Manages user state, session persistence, and primary auth flows.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [mailboxLoading, setMailboxLoading] = useState(false);
    const [mailboxConnected, setMailboxConnected] = useState(false);
    const [isBootstrappingInbox, setBootstrappingInbox] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [appLockStatus, setAppLockStatus] = useState<AuthContextType["appLockStatus"]>("checking");
    const [appLockError, setAppLockError] = useState<string | null>(null);
    const initializationRef = useRef<Promise<void> | null>(null);
    const bootstrapStartedRef = useRef(false);
    const router = useRouter();

    const bootstrapOnce = async () => {
        if (bootstrapStartedRef.current) return;
        bootstrapStartedRef.current = true;
        await bootstrap();
    };

    useEffect(() => {
        const checkAppLock = async (): Promise<boolean> => {
            setAppLockStatus("checking");
            setAppLockError(null);
            try {
                const settings = await invoke<{ app_lock_enabled?: boolean }>("get_app_settings");
                if (!settings.app_lock_enabled) {
                    setAppLockStatus("unlocked");
                    return true;
                }

                const result = await verifyHelloOnce();
                if (result.error) {
                    setAppLockError(result.error);
                    setAppLockStatus("error");
                    return false;
                }

                setAppLockStatus(result.verified ? "unlocked" : "locked");
                return result.verified;
            } catch (error) {
                console.error("App lock verification failed", error);
                setAppLockError(String(error));
                setAppLockStatus("error");
                return false;
            }
        };

        // Keep the shell hidden until the lock preference and Windows Hello result are known.
        // Reuse the same initialization promise across React Strict Mode effect replays.
        initializationRef.current ??= (async () => {
            if (await checkAppLock()) await bootstrapOnce();
        })();

        const unlisten = listen("auth:session_expired", () => {
            setSessionExpired(true);
        });

        const handleOnline = () => {
            // Retry bootstrap when internet becomes available to refresh tokens if needed
            if (bootstrapStartedRef.current) void bootstrap();
        };
        window.addEventListener("online", handleOnline);

        return () => {
            unlisten.then(f => f());
            window.removeEventListener("online", handleOnline);
        };
    }, []);

    const retryAppUnlock = async () => {
        setAppLockError(null);
        setAppLockStatus("checking");
        try {
            const settings = await invoke<{ app_lock_enabled?: boolean }>("get_app_settings");
            if (!settings.app_lock_enabled) {
                setAppLockStatus("unlocked");
                await bootstrapOnce();
                return;
            }

            const result = await verifyHelloOnce(true);
            if (result.error) {
                setAppLockError(result.error);
                setAppLockStatus("error");
                return;
            }

            setAppLockStatus(result.verified ? "unlocked" : "locked");
            if (result.verified) await bootstrapOnce();
        } catch (error) {
            console.error("App unlock failed", error);
            setAppLockError(String(error));
            setAppLockStatus("error");
        }
    };

    /**
     * Bootstraps the application session.
     * Fetches active account status and validates tokens.
     */
    async function bootstrap() {
        try {
            const result = await invoke<{ user: User | null; needs_refresh: boolean }>("bootstrap_accounts");

            if (result.needs_refresh) {
                // Token is invalid or expired and couldn't be refreshed. Force user to sign in again.
                setUser(null);
                setNeedsRefresh(true);
                localStorage.removeItem("orion_user");
                if (result.user?.id) {
                    await invoke("logout_user", { accountId: result.user.id }).catch(() => {});
                }
                router.push("/");
            } else if (result.user) {
                setUser(result.user);
                setNeedsRefresh(false);
                // Also update local storage with the freshest info
                localStorage.setItem("orion_user", JSON.stringify(result.user));
            } else {
                // No active user returned from backend
                const storedUser = localStorage.getItem("orion_user");
                if (storedUser) {
                    // Try to fall back to local storage if backend didn't return one (rare edge case)
                    setUser(JSON.parse(storedUser));
                } else {
                    router.push("/");
                }
            }
        } catch (error) {
            console.error("Auth: Bootstrap failed", error);
            router.push("/");
        } finally {
            setLoading(false);
        }
    }

    /**
     * Initiates the Google OAuth login flow via Tauri.
     */
    const loginWithGoogle = async () => {
        setLoading(true);
        try {
            const profile = await invoke<User>("login_google");
            setUser(profile);
            localStorage.setItem("orion_user", JSON.stringify(profile));

            // First login loading sequence
            setBootstrappingInbox(true);
            router.push("/inbox");

            // Kick off sync
            invoke("sync_inbox").catch(console.error);

            // Poll for local database population
            const pollInterval = setInterval(async () => {
                try {
                    const messages = await invoke<any[]>("get_cached_messages");
                    if (messages && messages.length > 0) {
                        setBootstrappingInbox(false);
                        clearInterval(pollInterval);
                    }
                } catch (err) {
                    // Safe to ignore, probably DB not fully ready
                }
            }, 500);

            // Safety timeout (2 minutes max)
            setTimeout(() => {
                setBootstrappingInbox(false);
                clearInterval(pollInterval);
            }, 120000);

        } catch (error) {
            console.error("Auth: Google login failed", error);
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const updateDisplayName = async (displayName: string) => {
        const updatedUser = await invoke<User>("update_display_name", { displayName });
        setUser(updatedUser);
        localStorage.setItem("orion_user", JSON.stringify(updatedUser));
    };

    /**
     * Terminates the current account session.
     */
    const logout = async (accountId: string) => {
        try {
            await invoke("logout_user", { accountId });
            setUser(null);
            localStorage.removeItem("orion_user");
            router.push("/");
        } catch (error) {
            console.error("Auth: Logout failed", error);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                appLockStatus,
                appLockError,
                retryAppUnlock,
                mailboxLoading,
                setMailboxLoading,
                mailboxConnected,
                setMailboxConnected,
                isBootstrappingInbox,
                setBootstrappingInbox,
                needsRefresh,
                isAuthenticated: !!user,
                loginWithGoogle,
                updateDisplayName,
                logout,
            }}
        >
            {children}
            <SessionExpiredPopup 
                isOpen={sessionExpired} 
                onClose={() => setSessionExpired(false)} 
                onLogin={() => {
                    setSessionExpired(false);
                    loginWithGoogle().catch(console.error);
                }} 
            />
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
