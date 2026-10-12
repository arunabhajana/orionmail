"use client";

import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface ContextMenuAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onSelect?: () => void;
    destructive?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
}

export function ContextMenu({ position, items, onClose, label = 'Actions' }: {
    position: { x: number; y: number } | null;
    items: ContextMenuAction[];
    onClose: () => void;
    label?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!position || !ref.current) return;
        const menu = ref.current;
        const previousFocus = document.activeElement;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
        menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        const outside = (event: MouseEvent) => {
            if (!menu.contains(event.target as Node)) onClose();
        };
        const dismiss = () => onClose();
        const scroll = (event: Event) => {
            if (!(event.target instanceof Node) || !menu.contains(event.target)) onClose();
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('contextmenu', outside);
        document.addEventListener('scroll', scroll, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('contextmenu', outside);
            document.removeEventListener('scroll', scroll, true);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('blur', dismiss);
            if ((document.activeElement === document.body || (document.activeElement && menu.contains(document.activeElement))) && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        };
    }, [position, onClose]);

    if (!position || typeof document === 'undefined') return null;
    return createPortal(
        <div ref={ref} role="menu" aria-label={label}
            style={{ left: position.x, top: position.y, maxHeight: 'calc(100vh - 16px)', maxWidth: 'calc(100vw - 16px)' }}
            className="fixed z-[1000] w-56 bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-xl shadow-2xl overflow-y-auto py-1.5"
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
            onKeyDown={event => {
                const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
                else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
                    event.preventDefault();
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                    buttons[next].focus();
                }
            }}>
            {items.map(item => <React.Fragment key={item.id}>
                {item.separatorBefore && <div role="separator" className="h-px bg-black/10 dark:bg-white/10 my-1.5" />}
                <button type="button" role="menuitem" disabled={item.disabled}
                    onClick={event => {
                        event.stopPropagation();
                        onClose();
                        if (item.onSelect) item.onSelect();
                        else toast.info(`${item.label} is not implemented yet`);
                    }}
                    className={cn('w-full px-3 py-1.5 text-sm flex items-center gap-2 text-left hover:bg-black/5 dark:hover:bg-white/10 focus-visible:bg-black/5 dark:focus-visible:bg-white/10 outline-none disabled:opacity-40 disabled:cursor-not-allowed', item.destructive ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200')}>
                    <span className="opacity-70 shrink-0">{item.icon}</span><span>{item.label}</span>
                </button>
            </React.Fragment>)}
        </div>, document.body);
}
