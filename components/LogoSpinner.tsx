"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";

export default function LogoSpinner({ message = "Syncing inbox..." }: { message?: string }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const textRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        if (!svgRef.current || !textRef.current) return;

        const tl = gsap.timeline({ repeat: -1 });

        // Breathing effect on the whole logo
        tl.to(svgRef.current, {
            scale: 1.08,
            rotation: 2,
            duration: 1.5,
            ease: "sine.inOut",
            yoyo: true,
            repeat: 1
        }, 0);

        // Twinkling stars inside the logo
        tl.to(".spinner-star", {
            opacity: 0.3,
            scale: 0.7,
            transformOrigin: "center",
            duration: 0.8,
            stagger: 0.2,
            ease: "power1.inOut",
            yoyo: true,
            repeat: 1
        }, 0);

        // Text dot animation
        const dotsTl = gsap.timeline({ repeat: -1 });
        dotsTl.to(textRef.current, {
            opacity: 0.5,
            duration: 0.8,
            ease: "sine.inOut",
            yoyo: true
        });

        return () => {
            tl.kill();
            dotsTl.kill();
        };
    }, []);

    return (
        <div className="flex flex-col items-center justify-center gap-8 p-8">
            <div className="relative flex items-center justify-center">
                {/* Subtle outer pulse */}
                <div className="absolute inset-[-30%] rounded-full animate-ping opacity-20 dark:opacity-10 bg-gradient-to-tr from-primary to-purple-500 duration-1000"></div>

                <svg ref={svgRef} className="w-20 h-20 relative z-10 drop-shadow-xl rounded-2xl" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <clipPath id="envClipSp">
                            <rect x="90" y="160" width="332" height="220" rx="40" />
                        </clipPath>
                    </defs>
                    <g fill="#A970FF">
                        <path className="spinner-star" d="M 410 50 Q 410 100 360 100 Q 410 100 410 150 Q 410 100 460 100 Q 410 100 410 50 Z" />
                        <path className="spinner-star" d="M 470 160 Q 470 180 450 180 Q 470 180 470 200 Q 470 180 490 180 Q 470 180 470 160 Z" />
                        <path className="spinner-star" d="M 320 120 Q 320 140 300 140 Q 320 140 320 160 Q 320 140 340 140 Q 320 140 320 120 Z" />
                    </g>
                    <rect x="90" y="160" width="332" height="220" rx="40" fill="#FFFFFF" stroke="#0050FF" strokeWidth="24" />
                    <g clipPath="url(#envClipSp)">
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
            <p ref={textRef} className="text-muted-foreground/80 dark:text-white/60 font-medium tracking-wide text-sm">
                {message}
            </p>
        </div>
    );
}
