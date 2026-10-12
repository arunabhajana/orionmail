"use client";

import React from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import TitlebarWrapper from "@/components/TitlebarWrapper";

export function AppLockGate({ children }: { children: React.ReactNode }) {
    const { appLockStatus, appLockError, retryAppUnlock } = useAuth();

    if (appLockStatus === "unlocked") return <>{children}</>;

    return (
        <div className="app-window">
            <TitlebarWrapper />
            <main className="pt-[30px] h-full w-full overflow-hidden flex items-center justify-center bg-white dark:bg-black px-6">
                <section className="max-w-sm w-full p-8 text-center" aria-live="polite">
                    <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6">
                        {appLockStatus === "checking" ? (
                            <ShieldCheck className="w-8 h-8 animate-pulse" />
                        ) : (
                            <Lock className="w-8 h-8" />
                        )}
                    </div>
                    <h1 className="text-2xl font-bold text-foreground mb-2">
                        {appLockStatus === "checking" ? "Verifying identity" : "OrionMail is locked"}
                    </h1>
                    <p className="text-sm text-muted-foreground mb-8">
                        {appLockStatus === "checking"
                            ? "Complete Windows Hello to open your mailbox."
                            : appLockError
                                ? "Windows Hello could not verify your identity. Check that it is available, then try again."
                                : "Use Windows Hello to unlock OrionMail."}
                    </p>
                    {appLockStatus !== "checking" && (
                        <button
                            onClick={() => void retryAppUnlock()}
                            className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
                        >
                            Try again
                        </button>
                    )}
                </section>
            </main>
        </div>
    );
}
