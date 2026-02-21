"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "next/navigation";

export interface User {
    email: string;
    name: string;
    picture: string;
    provider: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    mailboxLoading: boolean;
    setMailboxLoading: (loading: boolean) => void;
    isBootstrappingInbox: boolean;
    setBootstrappingInbox: (bootstrap: boolean) => void;
    needsRefresh: boolean;
    isAuthenticated: boolean;
    loginWithGoogle: () => Promise<void>;
    logout: (accountId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Global authentication provider.
 * Manages user state, session persistence, and primary auth flows.
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [mailboxLoading, setMailboxLoading] = useState(false);
    const [isBootstrappingInbox, setBootstrappingInbox] = useState(false);
    const router = useRouter();

    useEffect(() => {
        bootstrap();
    }, []);

    /**
     * Bootstraps the application session.
     * Fetches active account status and validates tokens.
     */
    const bootstrap = async () => {
        try {
            const result = await invoke<{ user: User | null; needs_refresh: boolean }>("bootstrap_accounts");

            if (result.user) {
                setUser(result.user);
                setNeedsRefresh(result.needs_refresh);
            } else {
                const storedUser = localStorage.getItem("orion_user");
                if (storedUser) {
                    setUser(JSON.parse(storedUser));
                }
            }
        } catch (error) {
            console.error("Auth: Bootstrap failed", error);
        } finally {
            setLoading(false);
        }
    };

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
        } finally {
            setLoading(false);
        }
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
                mailboxLoading,
                setMailboxLoading,
                isBootstrappingInbox,
                setBootstrappingInbox,
                needsRefresh,
                isAuthenticated: !!user,
                loginWithGoogle,
                logout,
            }}
        >
            {children}
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
