"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
export function ActionTooltip({ label, children }: { label:string;children:(description:string|undefined)=>ReactNode }) {
    const pathname=usePathname();
    const [previousPath,setPreviousPath]=useState(pathname);
    const id=useId();const anchor=useRef<HTMLSpanElement>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
    const [position,setPosition]=useState<{top:number;left:number}|null>(null);
    if(previousPath!==pathname){setPreviousPath(pathname);setPosition(null);}
    const hide=()=>{if(timer.current)clearTimeout(timer.current);setPosition(null);};
    const show=()=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{const rect=anchor.current?.getBoundingClientRect();if(rect)setPosition({top:rect.bottom+8,left:rect.left+rect.width/2});},180);};
    useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[pathname]);
    useEffect(()=>{if(!position)return;const dismiss=()=>setPosition(null);window.addEventListener('scroll',dismiss,true);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);return()=>{window.removeEventListener('scroll',dismiss,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);};},[position]);
    const placeTooltip=(node:HTMLSpanElement|null)=>{
        const target=anchor.current?.getBoundingClientRect();
        if(!node||!target)return;
        const app=anchor.current?.closest('.app-window')?.getBoundingClientRect();
        const left=Math.max(0,app?.left??0)+8;
        const right=Math.min(window.innerWidth,app?.right??window.innerWidth)-8;
        const top=Math.max(0,app?.top??0)+8;
        const bottom=Math.min(window.innerHeight,app?.bottom??window.innerHeight)-8;
        node.style.maxWidth=Math.max(0,Math.min(224,right-left))+'px';
        const box=node.getBoundingClientRect();
        const center=target.left+target.width/2;
        node.style.left=Math.max(left+box.width/2,Math.min(center,right-box.width/2))+'px';
        const preferred=target.bottom+8;
        node.style.top=Math.max(top,Math.min(preferred+box.height<=bottom?preferred:target.top-box.height-8,bottom-box.height))+'px';
    };
    return <span ref={anchor} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={hide} onKeyDown={event=>{if(event.key==='Escape')hide();}}>{children(position?id:undefined)}{position&&createPortal(<span ref={placeTooltip} id={id} role="tooltip" style={position} className="mail-action-tooltip pointer-events-none fixed z-[90] w-max max-w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-[#242730]/95 px-3 py-2 text-[11px] font-medium text-white shadow-lg backdrop-blur-xl">{label}</span>,document.body)}</span>;
}
