"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Email, Tag } from '@/lib/types';

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
    useEffect(() => { dialog.current?.showModal(); }, []);
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
        className="m-auto w-[380px] max-w-[calc(100vw-32px)] rounded-2xl border border-black/10 bg-white/95 p-0 text-foreground shadow-2xl backdrop-blur-2xl backdrop:bg-black/35 dark:border-white/10 dark:bg-[#1c2029]/95">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/10">
            <h2 id="message-tags-title" className="text-sm font-semibold">Manage tags</h2>
            <button type="button" onClick={onClose} aria-label="Close tag picker" className="mail-icon-button"><X className="size-4" /></button>
        </div>
        <div className="p-4">
            <p className="mb-3 truncate text-xs text-muted-foreground" title={email.subject}>{email.subject}</p>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <input autoFocus aria-label="Search tags" placeholder="Search tags..." value={query} onChange={event => setQuery(event.target.value)}
                    className="h-10 w-full rounded-xl border border-black/10 bg-transparent pl-9 pr-3 text-sm outline-none focus:border-primary dark:border-white/10" />
            </div>
            <div className="mt-3 max-h-[40vh] overflow-y-auto overscroll-contain">
                {filtered.map(tag => {
                    const assigned = email.tags.includes(tag.id);
                    return <label key={tag.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                        <input type="checkbox" checked={selected.includes(tag.id)} disabled={added.length >= 100 && !selected.includes(tag.id)}
                            onChange={event => setSelected(prev => event.target.checked ? [...prev, tag.id] : prev.filter(id => id !== tag.id))} className="accent-primary" />
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.bg_color || '#94a3b8' }} />
                        <span className="min-w-0 flex-1 truncate" title={tag.name}>{tag.name}</span>
                        {assigned && <span className="text-[10px] text-muted-foreground">{selected.includes(tag.id)?'Applied':'Will remove'}</span>}
                    </label>;
                })}
                {!filtered.length && <p className="py-6 text-center text-xs text-muted-foreground">{available.length ? 'No matching tags.' : 'Create a tag using + in the sidebar first.'}</p>}
            </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/10">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-muted-foreground">Cancel</button>
            <button type="button" disabled={!added.length && !removed.length} onClick={apply} className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40">Save changes</button>
        </div>
    </dialog>;
}
