"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Cloud, FilePenLine, Loader2, Paperclip, Plus, RefreshCw, Search, Trash2, X, AlertCircle } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { draftStatus, type DraftSummary, type MailDraft } from '@/lib/drafts';
import { recoverLocalDrafts } from '@/lib/draft-recovery';

export function DraftFolder({ accountId, onOpen, onCompose, onBeforeOpen }: { accountId: string; onOpen: (draft: MailDraft) => void; onCompose: () => void; onBeforeOpen: () => boolean }) {
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [opening, setOpening] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const scroll = useRef<HTMLDivElement>(null);
    const mounted = useRef(true);
    const syncGuard = useRef(false);
    const generation = useRef(0);
    const load = useCallback(async () => {
        const request = ++generation.current;
        try { const rows = await invoke<DraftSummary[]>('list_drafts', { accountId }); if (mounted.current && request === generation.current) setDrafts(rows); }
        catch (failure) { if (mounted.current) setError(String(failure)); }
        finally { if (mounted.current) setLoading(false); }
    }, [accountId]);
    const sync = useCallback(async () => {
        if (syncGuard.current) return;
        syncGuard.current = true; setSyncing(true); setError(null);
        try { await invoke('sync_drafts', { accountId }); }
        catch (failure) { if (mounted.current) setError(String(failure)); }
        finally { syncGuard.current = false; if (mounted.current) { setSyncing(false); await load(); } }
    }, [accountId, load]);
    useEffect(() => {
        mounted.current = true;
        void recoverLocalDrafts(accountId).then(() => { if (mounted.current) { void load(); void sync(); } }).catch(failure => { if (mounted.current) { setError(`Draft recovery: ${String(failure)}`); void load(); } });
        let disposed = false;
        let stop: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
        void listen<string>('drafts:updated', event => {
            if (event.payload !== accountId) return;
            clearTimeout(timer); timer = setTimeout(() => { if (mounted.current) void load(); }, 180);
        }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => {});
        return () => { disposed = true; mounted.current = false; stop?.(); clearTimeout(timer); };
    }, [accountId, load, sync]);
    const filtered = useMemo(() => {
        const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        return drafts.filter(draft => { const text = `${draft.subject} ${draft.to.join(' ')} ${draft.preview}`.toLocaleLowerCase(); return terms.every(term => text.includes(term)); });
    }, [drafts, query]);
    const rows = useVirtualizer({ count: filtered.length, getScrollElement: () => scroll.current, estimateSize: () => 136, overscan: 3, getItemKey: index => filtered[index].id });
    const open = async (draft: DraftSummary) => {
        if (opening) return;
        if (!onBeforeOpen()) return;
        if (draft.state === 'unsupported') { await invoke('open_url', { url: 'https://mail.google.com/mail/u/0/#drafts' }); return; }
        setOpening(draft.id);
        try { const record = await invoke<MailDraft>('open_draft', { accountId, id: draft.id }); if (mounted.current) onOpen(record); }
        catch (failure) { toast.error(String(failure)); }
        finally { if (mounted.current) setOpening(null); }
    };
    const discard = async (draft: DraftSummary) => {
        if (deleting || !await confirm('Discard this draft on this device and in Gmail? This cannot be undone.', { title: 'Discard draft', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Cancel' })) return;
        setDeleting(draft.id);
        try { await invoke('discard_draft', { accountId, id: draft.id, expectedRevision: draft.revision }); await load(); }
        catch (failure) { toast.error(String(failure)); }
        finally { if (mounted.current) setDeleting(null); }
    };
    const skeleton = loading || drafts.length === 0 && syncing;
    return <>
        <section className="mail-list-column flex min-h-0 flex-col" aria-label="Draft messages">
            <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-black/5 px-5 dark:border-white/5">
                <h1 className="text-sm font-semibold">Drafts <span className="ml-2 text-xs font-normal text-muted-foreground">{drafts.length || ''}</span></h1>
                <button type="button" onClick={() => { void sync(); }} disabled={syncing} aria-label="Sync drafts" title="Sync drafts" className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button>
            </header>
            <div className="px-3 py-3"><label className="flex h-10 items-center gap-2 rounded-xl border border-black/10 bg-white/30 px-3 focus-within:ring-2 focus-within:ring-primary/50 dark:border-white/10 dark:bg-black/10"><Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search drafts" placeholder="Search drafts…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />{query && <button type="button" aria-label="Clear draft search" onClick={() => setQuery('')}><X className="size-3.5" /></button>}</label></div>
            {error && <div role="status" className="mx-3 mb-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300"><span className="font-medium">Draft sync needs attention.</span><p className="mt-1 break-words text-muted-foreground">{error}</p><button type="button" onClick={() => { void sync(); }} disabled={syncing} className="mt-1 font-medium text-primary">Retry Gmail sync</button></div>}
            <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" aria-busy={loading}>
                {skeleton ? <div aria-label="Loading drafts" className="space-y-2 px-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3 rounded-xl bg-white/30 p-4 motion-safe:animate-pulse dark:bg-white/[0.035]"><div className="h-3 w-3/5 rounded bg-muted" /><div className="h-2.5 w-4/5 rounded bg-muted" /><div className="h-2.5 w-1/2 rounded bg-muted" /></div>)}</div>
                    : filtered.length === 0 ? <div className="flex flex-col items-center gap-3 px-6 py-14 text-center"><FilePenLine className="size-8 text-muted-foreground/50" /><h2 className="text-sm font-medium">{query ? 'No matching drafts' : 'A place to pick up later'}</h2><p className="text-xs leading-5 text-muted-foreground">{query ? 'Try another subject or recipient.' : 'Messages save here as you write. Gmail drafts appear after syncing.'}</p>{!query && <button type="button" onClick={onCompose} className="mt-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Write a message</button>}</div>
                    : <div style={{ height: rows.getTotalSize(), position: 'relative' }}>{rows.getVirtualItems().map(row => {
                        const draft = filtered[row.index];
                        return <article key={draft.id} data-index={row.index} ref={rows.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }} className="px-3 pb-2">
                            <div className="group relative rounded-xl border border-black/[0.04] bg-white/35 transition-colors hover:bg-white/65 dark:border-white/[0.04] dark:bg-white/[0.025] dark:hover:bg-white/[0.055]">
                                <button type="button" onClick={() => { void open(draft); }} disabled={opening !== null} className="w-full rounded-xl p-3.5 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="min-w-0 flex-1 truncate">{draft.to.join(', ') || 'No recipients yet'}</span><time dateTime={new Date(draft.updated_at).toISOString()}>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(draft.updated_at)}</time></div>
                                    <h2 className="mt-1.5 truncate text-[13px] font-semibold">{draft.subject || '(No subject)'}</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{draft.preview || 'Empty message'}</p>
                                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">{opening === draft.id ? <Loader2 className="size-3 animate-spin" /> : draft.conflict || draft.state === 'send_unknown' ? <AlertCircle className="size-3 text-amber-500" /> : <Cloud className="size-3" />}<span>{draft.conflict ? 'Separate copy · ' : ''}{draftStatus(draft.state)}</span>{draft.attachments > 0 && <span className="ml-auto flex items-center gap-1"><Paperclip className="size-3" />{draft.attachments}</span>}</div>
                                </button>
                                <button type="button" disabled={deleting !== null || ['sending', 'send_unknown'].includes(draft.state)} onClick={() => { void discard(draft); }} aria-label={`Discard ${draft.subject || 'draft'}`} className="absolute right-1.5 top-2 rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Trash2 className="size-3.5" /></button>
                            </div>
                        </article>;
                    })}</div>}
            </div>
        </section>
        <section className="mail-detail-pane flex min-h-0 min-w-0 flex-1 items-center justify-center p-8"><div className="max-w-xs text-center"><span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FilePenLine className="size-6" /></span><h2 className="mt-5 text-lg font-semibold tracking-tight">Ready when you are</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Open a draft to keep writing. Changes save on this device first and sync with Gmail in the background.</p><button type="button" onClick={onCompose} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" />New message</button></div></section>
    </>;
}
