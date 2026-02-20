"use client";

import React, { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

const LoadingOrion = () => {
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
                y: -10,
                duration: 2,
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut"
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

            // Text Loading Animation
            gsap.fromTo(".loading-text",
                { opacity: 0.3 },
                { opacity: 1, duration: 1, repeat: -1, yoyo: true, ease: "sine.inOut" }
            );

        }, containerRef);

        return () => ctx.revert();
    }, []);

    return (
        <div ref={containerRef} className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center overflow-hidden perspective-1000">
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

                    <svg ref={logoRef} className="w-24 h-24 relative" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="load-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#2563eb" />
                                <stop offset="50%" stopColor="#7c3aed" />
                                <stop offset="100%" stopColor="#db2777" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M3 7.5L12 13L21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H4.5C3.67157 18 3 17.3284 3 16.5V7.5Z"
                            fill="url(#load-grad)"
                        />
                        <path
                            d="M3 7.5L12 13L21 7.5L12 2L3 7.5Z"
                            fill="url(#load-grad)"
                            opacity="0.8"
                        />
                    </svg>
                </div>

                <div className="text-center">
                    <h2 className="loading-text text-slate-900 text-xl font-bold tracking-[0.2em] uppercase">
                        Launching Orion
                    </h2>
                    <p className="text-slate-500 text-sm mt-2 font-medium">Preparing your unified inbox...</p>
                </div>
            </div>

            {/* Mesh Overlay for texture */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay"></div>
        </div>
    );
};

export default LoadingOrion;
