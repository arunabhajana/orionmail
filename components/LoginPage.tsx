"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import {useInstalledVersion} from "@/hooks/useInstalledVersion";
import {currentRelease} from "@/lib/generated/releases";
import {RequestAccess} from './RequestAccess';

export default function LoginPage() {
    const version=useInstalledVersion();
    const { loginWithGoogle } = useAuth();
    const guard = useRef(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const handleGoogleLogin = async () => {
        if (guard.current) return;
        guard.current = true; setPending(true); setError('');
        try { await loginWithGoogle(); }
        catch (failure) {
            const message = String(failure);
            setError(/cancelled|denied|access_denied/i.test(message) ? 'Sign-in was cancelled. You can try again whenever you’re ready.' : /timed out|timeout/i.test(message) ? 'Sign-in took too long. Please try again and complete the steps in your browser.' : 'Could not connect to Google. Check your connection and try again.');
        } finally { guard.current = false; setPending(false); }
    };
    return <main className="relative flex h-full w-full flex-col items-center overflow-y-auto bg-[#f6f7f8] px-6 py-10 text-foreground dark:bg-[#111216]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(39,123,241,0.07),transparent_55%),radial-gradient(ellipse_at_100%_100%,rgba(169,112,255,0.05),transparent_50%)]" />
        <div className="relative my-auto w-full max-w-[420px] shrink-0">
            <div className="mb-8 flex items-center justify-center gap-3">
                <Image src="/logo-transparent.svg" alt="" width={44} height={40} unoptimized className="-translate-y-1 brightness-0 dark:brightness-100" />
                <span className="text-[24px] font-semibold tracking-tight">OrionMail</span>
            </div>
            <section aria-labelledby="login-title" aria-busy={pending} className="rounded-[22px] border border-black/[0.07] bg-white p-7 shadow-[0_16px_60px_rgba(0,0,0,0.04)] sm:p-9 dark:border-white/[0.08] dark:bg-[#191b21]">
                <h1 id="login-title" className="text-2xl font-semibold tracking-tight">A quieter space for your inbox.</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Connect your Google account to get started.</p>
                <button type="button" disabled={pending} onClick={() => { void handleGoogleLogin(); }} aria-describedby="login-status" className="mt-7 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium transition-colors hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-white/15 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:focus-visible:ring-offset-[#191b21]">
                    {pending ? <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" /> : <svg className="size-5 shrink-0" aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                        fill="#4285F4"
                                    ></path>
                                    <path
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                        fill="#34A853"
                                    ></path>
                                    <path
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                                        fill="#FBBC05"
                                    ></path>
                                    <path
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                        fill="#EA4335"
                                    ></path>
                                </svg>}
                    <span>{pending ? 'Waiting for Google…' : 'Continue with Google'}</span>
                    {!pending && <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />}
                </button>
                <p id="login-status" role="status" className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{pending ? 'Finish signing in in your browser, then return here.' : 'Sign-in opens securely in your browser.'}</p>
                {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/[0.05] p-3 text-xs leading-relaxed text-red-600 dark:text-red-300"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div>}
                <RequestAccess />
            </section>
            <footer className="mt-6 text-center text-[11px] text-muted-foreground">
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                    <Link href="/privacy" className="rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">Privacy Policy</Link>
                    <Link href="/terms" className="rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary">Terms of Use</Link>
                </div>
                <p className="mt-4 tabular-nums">Version {version}{(currentRelease.sample||currentRelease.status==='draft')&&<> <span aria-hidden="true">·</span> Preview</>}</p>
            </footer>
        </div>
    </main>;
}
