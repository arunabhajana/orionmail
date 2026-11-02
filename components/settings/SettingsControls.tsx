"use client";
import React, { useId, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
export function SettingGroup({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return <section className="settings-group"><div className="px-5 pt-5 pb-2"><h2 className="text-[13px] font-semibold tracking-wide">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div><div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">{children}</div></section>;
}
export function SettingRow({ id, title, description, children, unavailable = false }: { id: string; title: string; description: string; children?: React.ReactNode; unavailable?: boolean }) {
    return <div data-setting-id={id} className="setting-row flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 rounded-xl scroll-mt-8"><div className="min-w-0 flex-1 basis-48"><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>{unavailable ? <span className="rounded-full border border-black/10 dark:border-white/10 px-2.5 py-1 text-[10px] text-muted-foreground">Not available yet</span> : children}</div>;
}
export function SettingToggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
    return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${checked ? "bg-primary" : "bg-black/15 dark:bg-white/20"}`}><span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></button>;
}
export function SettingSelect({ label, value, options, onChange, disabled = false, compact = false }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; disabled?: boolean; compact?: boolean }) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<React.CSSProperties | null>(null);
    const [active, setActive] = useState(0);
    const search = useRef({ text: '', time: 0 });
    const close = (restore = false) => { setPosition(null); if (restore) trigger.current?.focus(); };
    const show = (last = false) => {
        if (disabled || !options.length || !trigger.current) return;
        const rect = trigger.current.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const up = below < Math.min(240, options.length * 36 + 8) && above > below;
        const width = Math.min(Math.max(rect.width, compact ? 100 : 208), window.innerWidth - 16);
        setActive(last ? options.length - 1 : Math.max(0, options.findIndex(([key]) => key === value)));
        setPosition({ position: 'fixed', width, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }), maxHeight: Math.max(40, Math.min(280, up ? above : below)) });
    };
    useEffect(() => {
        if (!position) return;
        menu.current?.focus();
        const outside = (event: PointerEvent) => {
            if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
        };
        const dismiss = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setPosition(null); };
        const blur = () => setPosition(null);
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', blur);
        window.addEventListener('blur', blur);
        return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', blur); window.removeEventListener('blur', blur); };
    }, [position]);
    const [wasDisabled, setWasDisabled] = useState(disabled);
    if (wasDisabled !== disabled) { setWasDisabled(disabled); if (disabled) setPosition(null); }
    useEffect(() => { if (position) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, position]);
    return <>
        <button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={!!position} aria-controls={position ? id : undefined} disabled={disabled}
            onClick={() => position ? close() : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); show(event.key === 'End'); } }}
            className={`settings-input inline-flex max-w-full ${compact ? 'min-w-16' : 'min-w-40'} items-center justify-between gap-3 text-left text-xs hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed`}>
            <span className="truncate">{options.find(([key]) => key === value)?.[1] || value}</span><ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${position ? 'rotate-180' : ''}`} />
        </button>
        {position && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} style={position}
            className="z-[60] overflow-y-auto overscroll-contain rounded-xl border border-black/10 bg-white p-1 text-foreground shadow-xl outline-none dark:border-white/10 dark:bg-[#202024]"
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(); }}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); close(true); }
                else if (event.key === 'Tab') { close(true); }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (options[active]) onChange(options[active][0]); close(true); }
                else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault(); setActive(previous => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (previous + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    const now = Date.now(); search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
                    const index = options.findIndex(([, title]) => title.toLowerCase().startsWith(search.current.text)); if (index >= 0) setActive(index);
                }
            }}>
            {options.map(([key, title], index) => <div key={key} id={`${id}-${index}`} data-index={index} role="option" aria-selected={key === value}
                onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(key); close(true); }}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${active === index ? 'bg-primary/10 text-primary' : ''}`}>
                <span className="min-w-0 flex-1">{title}</span><Check size={14} className={key === value ? 'shrink-0 text-primary' : 'invisible shrink-0'} />
            </div>)}
        </div>, document.body)}
    </>;
}
const hours = Array.from({ length: 24 }, (_, i) => { const n = String(i).padStart(2, '0'); return [n, n] as const; });
const minutes = Array.from({ length: 60 }, (_, i) => { const n = String(i).padStart(2, '0'); return [n, n] as const; });
export function SettingTimePicker({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
    const [hour, minute] = value.split(':');
    return <div role="group" aria-label={label} className="flex items-center gap-2">
        <SettingSelect compact label={`${label}, hour`} value={hour} options={hours} disabled={disabled} onChange={next => onChange(`${next}:${minute}`)} />
        <span aria-hidden="true" className="text-muted-foreground">:</span>
        <SettingSelect compact label={`${label}, minute`} value={minute} options={minutes} disabled={disabled} onChange={next => onChange(`${hour}:${next}`)} />
        <span className="text-[10px] text-muted-foreground">24-hour</span>
    </div>;
}
export const settingButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-black/[0.08] dark:border-white/10 bg-white/40 dark:bg-white/5 px-3.5 py-2 text-xs font-medium hover:bg-white/80 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
