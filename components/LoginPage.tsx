"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2, Lock, ShieldCheck } from "lucide-react";
import gsap from "gsap";
import LoadingOrion from "./LoadingOrion";
import { useAuth } from "./AuthContext";

const LoginPage = () => {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const { loginWithGoogle } = useAuth();

    const handleGoogleLogin = () => {
        const tl = gsap.timeline();

        // 1. Exit Animation for Card
        tl.to(cardRef.current, {
            scale: 0.8,
            opacity: 0,
            filter: "blur(20px)",
            duration: 0.6,
            ease: "power3.inOut"
        });

        // 2. Warp Background
        const decorationElements = containerRef.current?.querySelectorAll(".bg-decoration");
        if (decorationElements && decorationElements.length > 0) {
            tl.to(decorationElements, {
                scale: 5,
                opacity: 0,
                duration: 1,
                stagger: 0.1,
                ease: "power2.in",
                onComplete: () => {
                    setIsLoading(true);
                    loginWithGoogle();
                }
            }, "-=0.4");
        } else {
            // Fallback if decorations missing
            setIsLoading(true);
            loginWithGoogle();
        }
    };

    return (
        <>
            {isLoading && <LoadingOrion />}
            <div ref={containerRef} className="bg-mesh dark:bg-[#111111] h-full w-full flex items-center justify-center p-6 antialiased relative overflow-hidden transition-colors">
                {/* Top Navigation Bar */}
                <nav className="fixed top-[30px] left-0 w-full px-6 py-4 flex justify-between items-center z-50">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                    <linearGradient id="space-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#2563eb" />
                                        <stop offset="50%" stopColor="#7c3aed" />
                                        <stop offset="100%" stopColor="#db2777" />
                                    </linearGradient>
                                </defs>
                                {/* Gmail-inspired 'M' shape but with space themed colors */}
                                <path
                                    d="M3 7.5L12 13L21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H4.5C3.67157 18 3 17.3284 3 16.5V7.5Z"
                                    fill="url(#space-grad)"
                                />
                                <path
                                    d="M3 7.5L12 13L21 7.5L12 2L3 7.5Z"
                                    fill="url(#space-grad)"
                                    opacity="0.8"
                                />
                            </svg>
                        </div>
                        <span className="text-slate-900 dark:text-white/90 font-bold text-xl tracking-tight">OrionMail</span>
                    </div>
                    <button className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-white/60 hover:text-primary transition-colors">
                        Help Center
                    </button>
                </nav>

                {/* Main Glassmorphic Login Card */}
                <main ref={cardRef} className="w-full max-w-[440px] z-10 transition-all">
                    <div className="glass-card dark:bg-[#1C1C21]/70 dark:backdrop-blur-2xl rounded-xl p-8 md:p-10 flex flex-col items-center border border-white/40 dark:border-white/10 shadow-2xl transition-colors">
                        {/* Branding Header */}
                        <div className="text-center mb-8">
                            <h1 className="text-slate-900 dark:text-white/90 text-3xl font-bold tracking-tight mb-2">OrionMail</h1>
                            <p className="text-slate-600 dark:text-white/60 font-medium">Your unified inbox, reimagined.</p>
                        </div>
                        {/* Login Section */}
                        <div className="w-full space-y-4">
                            <div className="mb-6 text-center">
                                <h2 className="text-slate-900 dark:text-white/90 text-lg font-semibold mb-1">Connect Email</h2>
                                <p className="text-slate-500 dark:text-white/50 text-sm">Select your provider to get started</p>
                            </div>
                            {/* Google Sign In */}
                            <button
                                onClick={handleGoogleLogin}
                                className="w-full h-12 flex items-center justify-center gap-3 px-4 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 rounded-lg shadow-sm transition-all duration-200 group cursor-pointer"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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
                                </svg>
                                <span className="text-slate-700 dark:text-white/90 font-semibold text-[15px]">Continue with Google</span>
                            </button>
                            {/* Outlook Sign In */}
                            <button className="w-full h-12 flex items-center justify-center gap-3 px-4 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 rounded-lg shadow-sm transition-all duration-200 group">
                                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.3 8.5L12 3L1.7 8.5V15.5L12 21L22.3 15.5V8.5Z" fill="#0078D4"></path>
                                    <path d="M12 3V21L22.3 15.5V8.5L12 3Z" fill="#106EBE"></path>
                                    <path d="M12 3L1.7 8.5V15.5L12 12.3V3Z" fill="#28A8EA"></path>
                                </svg>
                                <span className="text-slate-700 dark:text-white/90 font-semibold text-[15px]">Continue with Outlook</span>
                            </button>
                            <div className="relative py-4">
                                <div aria-hidden="true" className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-300/40 dark:border-white/10"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-transparent px-2 text-slate-500 dark:text-white/40 font-medium whitespace-nowrap">or manual setup</span>
                                </div>
                            </div>
                            {/* IMAP Sign In */}
                            <button className="w-full h-12 flex items-center justify-center gap-3 px-4 bg-primary text-white hover:bg-primary/90 rounded-lg shadow-lg shadow-primary/20 transition-all duration-200">
                                <Settings2 size={20} />
                                <span className="font-semibold text-[15px]">Configure IMAP/SMTP</span>
                            </button>
                        </div>
                        {/* Footer Section */}
                        <div className="mt-10 text-center">
                            <p className="text-slate-500 dark:text-white/50 text-xs leading-relaxed">
                                By signing in, you agree to our <br />
                                <a className="text-primary hover:underline font-medium" href="#">
                                    Terms of Service
                                </a>{" "}
                                and{" "}
                                <a className="text-primary hover:underline font-medium" href="#">
                                    Privacy Policy
                                </a>
                                .
                            </p>
                        </div>
                    </div>
                    {/* Decorative elements around the card */}
                    <div className="mt-8 flex justify-center gap-6 opacity-60">
                        <div className="flex items-center gap-1.5 text-slate-500 dark:text-white/50 text-xs font-medium">
                            <Lock size={16} />
                            End-to-end Encrypted
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500 dark:text-white/50 text-xs font-medium">
                            <ShieldCheck size={16} />
                            Privacy Focused
                        </div>
                    </div>
                </main>

                {/* Background Decoration */}
                <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
                    {/* Light Mode Blobs */}
                    <div className="bg-decoration absolute dark:hidden -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[120px]"></div>
                    <div className="bg-decoration absolute dark:hidden -bottom-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px]"></div>
                    <div className="bg-decoration absolute dark:hidden top-[20%] right-[15%] w-[100px] h-[100px] bg-blue-400/20 blur-[60px]"></div>

                    {/* Dark Mode Mesh */}
                    <div className="bg-decoration absolute hidden dark:block top-[-20%] left-[-10%] w-[70%] h-[70%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/40 via-violet-900/10 to-transparent blur-[120px] rounded-full mix-blend-screen opacity-50" />
                    <div className="bg-decoration absolute hidden dark:block bottom-[-20%] right-[-10%] w-[70%] h-[70%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-fuchsia-900/30 via-purple-900/10 to-transparent blur-[120px] rounded-full mix-blend-screen opacity-50" />
                </div>
            </div>
        </>
    );
};

export default LoginPage;
