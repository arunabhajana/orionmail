"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, Tags, X } from 'lucide-react';
import { Email, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';

export function MessageTagPicker({ email, tags, onApply, onClose }: {
    email: Email;
    tags: Tag[];
    onApply: (email: Email, addIds: string[], removeIds: string[]) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [query, setQuery] = useState('');
    const initial = email.tags.filter(id => tags.some(tag => tag.id === id && tag.tag_type === 'user'));
    const [selected, setSelected] = useState<string[]>(initial);
    const applied = useRef(false);
    useEffect(() => { const element=dialog.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();if(previous?.isConnected)previous.focus();}; }, []);
    const available = useMemo(() => tags.filter(tag => tag.tag_type === 'user' && tag.provider === 'google')
        .sort((a, b) => a.name.localeCompare(b.name)), [tags]);
    const filtered = available.filter(tag => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const added = selected.filter(id => !initial.includes(id));
    const removed = initial.filter(id => !selected.includes(id));
    const apply = () => {
        if ((!added.length && !removed.length) || applied.current) return;
        applied.current = true;
        onApply(email, added, removed);
        onClose();
    };
    return <dialog ref={dialog} aria-labelledby="message-tags-title"
        onCancel={event => { event.preventDefault(); onClose(); }}
        onClick={event => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}
        aria-describedby="message-tags-description"
        className="m-auto w-[420px] max-w-[calc(100vw_-_32px)] overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-0 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm dark:border-white/[0.12] dark:bg-[#1c2029]/95">
        <div className="flex max-h-[calc(100dvh_-_48px)] flex-col">
            <header className="flex shrink-0 items-start gap-3.5 border-b border-black/[0.05] px-5 py-5 dark:border-white/[0.07]">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/[0.08] text-primary"><Tags size={18} /></span>
                <div className="min-w-0 flex-1"><h2 id="message-tags-title" className="text-sm font-semibold tracking-tight">Manage tags</h2><p id="message-tags-description" className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose the tags for this message.</p></div>
                <button type="button" onClick={onClose} aria-label="Close tag picker" className="mail-icon-button mail-toolbar-action -mr-1 -mt-1"><X className="size-4" /></button>
            </header>
            <div className="shrink-0 px-5 pt-4"><p className="mb-3 truncate text-xs text-muted-foreground" title={email.subject}>{email.subject || '(No subject)'}</p>
                <div className="group relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                    <input autoFocus aria-label="Search tags" placeholder="Search tags…" value={query} onChange={event => setQuery(event.target.value)} className="h-10 w-full rounded-xl border border-black/[0.08] bg-black/[0.02] pl-9 pr-9 text-xs outline-none transition-[border-color,box-shadow] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-black/10" />
                    {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"><X size={13} /></button>}
                </div>
                <div className="flex items-center justify-between pb-2 pt-4 text-[10px] font-medium text-muted-foreground"><span>{query ? 'Search results' : 'Available tags'}</span><span className="tabular-nums">{selected.length} selected</span></div>
            </div>
            <div role="group" aria-label="Available tags" className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                <div className="space-y-1.5">{filtered.map(tag => {
                    const checked = selected.includes(tag.id);
                    const assigned = initial.includes(tag.id);
                    const disabled = added.length >= 100 && !checked && !assigned;
                    const state = assigned ? checked ? 'Applied' : 'Will remove' : checked ? 'Will add' : '';
                    return <button key={tag.id} type="button" role="checkbox" aria-checked={checked} disabled={disabled}
                        onClick={() => setSelected(previous => previous.includes(tag.id) ? previous.filter(id => id !== tag.id) : [...previous, tag.id])}
                        className={cn('tag-choice-row group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40', checked ? 'border-primary/25 bg-primary/[0.07] hover:bg-primary/[0.11]' : 'border-transparent bg-black/[0.015] hover:border-black/[0.08] hover:bg-black/[0.035] dark:bg-white/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.045]')}>
                        <span aria-hidden="true" className={cn('tag-choice-check flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border', checked ? 'border-primary bg-primary text-white shadow-sm' : 'border-black/20 bg-white/50 group-hover:border-primary/50 dark:border-white/20 dark:bg-white/[0.03]')}><Check size={12} strokeWidth={3} className={cn('tag-choice-mark', checked ? 'scale-100 opacity-100' : 'scale-75 opacity-0')} /></span>
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.bg_color || '#94a3b8' }} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={tag.name}>{tag.name}</span>
                        {state && <span className={cn('shrink-0 text-[10px]', !assigned && checked ? 'text-primary' : 'text-muted-foreground')}>{state}</span>}
                    </button>;
                })}</div>
                {!filtered.length && <div className="py-7 text-center"><Tags className="mx-auto mb-2 size-5 text-muted-foreground/50" /><p className="text-xs font-medium">{available.length ? 'No matching tags' : 'No tags yet'}</p><p className="mt-1 text-[11px] text-muted-foreground">{available.length ? 'Try a different search.' : 'Create a tag with + in the sidebar to get started.'}</p></div>}
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-black/[0.05] bg-black/[0.015] px-5 py-4 dark:border-white/[0.07] dark:bg-white/[0.015]">
                <span role="status" className="text-[10px] text-muted-foreground">{added.length || removed.length ? [added.length ? added.length+' to add' : '', removed.length ? removed.length+' to remove' : ''].filter(Boolean).join(' · ') : 'No changes yet'}</span>
                <div className="flex gap-2"><button type="button" onClick={onClose} className="tag-picker-button rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-white/5">Cancel</button><button type="button" disabled={!added.length && !removed.length} onClick={apply} className="tag-picker-button rounded-lg border border-primary bg-primary px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none">Save changes</button></div>
            </footer>
        </div>
    </dialog>;
}
