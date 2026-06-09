"use client";

import React, { useLayoutEffect, useRef, useEffect } from "react";
import gsap from "gsap";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LoadingOrionProps {
    isPreview?: boolean;
    onClose?: () => void;
    message?: string;
    subMessage?: string;
}

const LoadingOrion = ({ 
    isPreview = false, 
    onClose,
    message = "Launching Orion",
    subMessage = "Preparing your unified inbox..."
}: LoadingOrionProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const starContainerRef = useRef<HTMLDivElement>(null);
    const logoRef = useRef<SVGSVGElement>(null);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            // 1. Create a "warp" field of stars
            const stars = Array.from({ length: 50 });
            const tl = gsap.timeline({ repeat: -1 });

            // Animate Logo - subtle pulse and float
            gsap.to(logoRef.current, {
                y: -15,
                rotation: 1,
                duration: 2.5,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut"
            });
            
            // Star Twinkle Animation
            gsap.to(".om-star", {
                opacity: 0.5,
                scale: 0.8,
                transformOrigin: "center",
                duration: 1.5,
                stagger: {
                    each: 0.3,
                    repeat: -1,
                    yoyo: true
                },
                ease: "power1.inOut"
            });

            // Animate background "warp" stars
            const starsEls = starContainerRef.current?.children;
            if (starsEls) {
                gsap.set(starsEls, {
                    x: () => (Math.random() - 0.5) * window.innerWidth * 1.5,
                    y: () => (Math.random() - 0.5) * window.innerHeight * 1.5,
                    z: () => Math.random() * 1000,
                    opacity: 0,
                    scale: 0
                });

                gsap.to(starsEls, {
                    z: -500,
                    opacity: 1,
                    scale: 1,
                    duration: 3,
                    stagger: {
                        amount: 3,
                        repeat: -1
                    },
                    ease: "power2.in",
                });
            }

            // We removed the GSAP .loading-text animation here because 
            // Framer Motion will handle swapping and animating the DOM nodes!

        }, containerRef);

        return () => ctx.revert();
    }, []);

    useEffect(() => {
        if (!isPreview || !onClose) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isPreview, onClose]);

    return (
        <div ref={containerRef} className="fixed inset-0 z-[100] bg-white dark:bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden perspective-1000">
            {isPreview && onClose && (
                <button
                    onClick={onClose}
                    className="absolute top-10 right-10 z-[110] p-2 rounded-full bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 transition-colors text-foreground dark:text-white"
                >
                    <X size={24} />
                </button>
            )}

            {/* Warp Particles Layer (Light Theme: Deep Blue/Violet) */}
            <div ref={starContainerRef} className="absolute inset-0 pointer-events-none">
                {Array.from({ length: 100 }).map((_, i) => (
                    <div
                        key={i}
                        className="absolute w-1 h-1 bg-primary/40 rounded-full"
                        style={{ boxShadow: '0 0 8px rgba(37, 99, 235, 0.2)' }}
                    />
                ))}
            </div>

            {/* Branded Element */}
            <div className="relative z-10 flex flex-col items-center gap-6">
                <div className="relative">
                    {/* Animated Glow behind logo */}
                    <div className="absolute inset-0 bg-primary/10 blur-[60px] rounded-full animate-pulse"></div>

                    <svg ref={logoRef} className="w-28 h-28 relative shadow-2xl rounded-3xl" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <clipPath id="envClipLg">
                                <rect x="90" y="160" width="332" height="220" rx="40" />
                            </clipPath>
                        </defs>
                        <g fill="#A970FF">
                            <path className="om-star" d="M 410 50 Q 410 100 360 100 Q 410 100 410 150 Q 410 100 460 100 Q 410 100 410 50 Z" />
                            <path className="om-star" d="M 470 160 Q 470 180 450 180 Q 470 180 470 200 Q 470 180 490 180 Q 470 180 470 160 Z" />
                            <path className="om-star" d="M 320 120 Q 320 140 300 140 Q 320 140 320 160 Q 320 140 340 140 Q 320 140 320 120 Z" />
                        </g>
                        <rect x="90" y="160" width="332" height="220" rx="40" fill="#FFFFFF" stroke="#0050FF" strokeWidth="24" />
                        <g clipPath="url(#envClipLg)">
                            <path d="M 70 140 C 180 320, 332 320, 442 140" fill="none" stroke="#0050FF" strokeWidth="24" strokeLinecap="round" />
                            <path d="M 70 410 L 210 280" fill="none" stroke="#0050FF" strokeWidth="24" strokeLinecap="round" />
                            <path d="M 442 410 L 302 280" fill="none" stroke="#0050FF" strokeWidth="24" strokeLinecap="round" />
                        </g>
                        {process.env.NODE_ENV === 'development' && (
                            <>
                                <rect x="272" y="380" width="180" height="80" rx="20" fill="#FFB000" stroke="#0050FF" strokeWidth="12" />
                                <text x="362" y="435" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="52" fill="#0050FF" textAnchor="middle" letterSpacing="4">DEV</text>
                            </>
                        )}
                    </svg>
                </div>

                <div className="text-center relative z-10 h-16 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={message + subMessage}
                            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                            transition={{ duration: 0.4, ease: "easeInOut" }}
                            className="flex flex-col items-center"
                        >
                            <h2 className="animate-pulse text-slate-900 dark:text-white text-xl font-bold tracking-[0.2em] uppercase">
                                {message}
                            </h2>
                            {subMessage && (
                                <p className="text-slate-500 dark:text-white/60 text-sm mt-2 font-medium">{subMessage}</p>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>

            {/* Mesh Overlay for texture */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay"></div>
        </div>
    );
};

export default LoadingOrion;
