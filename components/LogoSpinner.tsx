"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";

export default function LogoSpinner() {
    const svgRef = useRef<SVGSVGElement>(null);
    const topPathRef = useRef<SVGPathElement>(null);
    const bottomPathRef = useRef<SVGPathElement>(null);
    const textRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        if (!svgRef.current || !topPathRef.current || !bottomPathRef.current || !textRef.current) return;

        const tl = gsap.timeline({ repeat: -1 });

        // Heartbeat / breathing effect on the M and slight rotation
        tl.to(svgRef.current, {
            scale: 1.15,
            rotation: 2,
            duration: 1.2,
            ease: "power2.inOut",
            yoyo: true,
            repeat: 1
        }, 0);

        // Glowing opacity changes to give a space-like pulse
        tl.to(topPathRef.current, {
            opacity: 0.6,
            duration: 0.6,
            ease: "sine.inOut",
            yoyo: true,
            repeat: 1
        }, 0);

        tl.to(bottomPathRef.current, {
            opacity: 1,
            duration: 0.8,
            ease: "sine.inOut",
            yoyo: true,
            repeat: 1
        }, 0.2);

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
        <div className="flex flex-col items-center justify-center gap-6 p-8">
            <div className="relative flex items-center justify-center w-24 h-24 bg-white/60 backdrop-blur-md rounded-3xl shadow-xl shadow-indigo-500/10 border border-white/50">
                {/* Subtle outer pulse */}
                <div className="absolute inset-0 rounded-3xl animate-ping opacity-20 bg-gradient-to-tr from-blue-500 to-purple-500 duration-1000"></div>

                <svg ref={svgRef} className="w-14 h-14 relative z-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <linearGradient id="spinner-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#2563eb" />
                            <stop offset="50%" stopColor="#7c3aed" />
                            <stop offset="100%" stopColor="#db2777" />
                        </linearGradient>
                    </defs>
                    <path
                        ref={bottomPathRef}
                        d="M3 7.5L12 13L21 7.5V16.5C21 17.3284 20.3284 18 19.5 18H4.5C3.67157 18 3 17.3284 3 16.5V7.5Z"
                        fill="url(#spinner-grad)"
                        opacity="0.9"
                    />
                    <path
                        ref={topPathRef}
                        d="M3 7.5L12 13L21 7.5L12 2L3 7.5Z"
                        fill="url(#spinner-grad)"
                        opacity="0.8"
                    />
                </svg>
            </div>
            <p ref={textRef} className="text-slate-600 font-medium tracking-wide">
                Syncing inbox...
            </p>
        </div>
    );
}
