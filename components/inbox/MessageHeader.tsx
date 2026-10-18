"use client";
import React, { memo, useEffect, useState } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Email, Tag } from '@/lib/types';
import { contactFromHeader, mailInitials, splitHeaderAddresses } from '@/lib/mail-display';
import { toast } from 'sonner';
export { AttachmentCard } from './AttachmentCard';

export const MessageHeader = memo(({ email }: { email: Email }) => {
    const [expanded, setExpanded] = useState(false);
    const [tags, setTags] = useState<Tag[]>([]);
    useEffect(() => {
        let active = true;
        invoke<Tag[]>('get_all_tags').then(value => { if (active) setTags(value); }).catch(() => {});
        return () => { active = false; };
    }, []);
    const sender = contactFromHeader(email.senderEmail || email.sender);
    const senderName = contactFromHeader(email.sender).name || sender.name;
    const recipients = splitHeaderAddresses(email.to || '').map(contactFromHeader);
    const visibleTags = tags.filter(tag => email.tags.includes(tag.id) && tag.tag_type !== 'system');
    const date = new Date(email.timestamp);
    const validDate = Number.isFinite(date.getTime());
    const copy = async (value: string) => {
        try { await navigator.clipboard.writeText(value); toast.success('Email address copied.'); }
        catch { toast.error('Could not copy the email address.'); }
    };
    return <header className="mail-message-heading">
        {visibleTags.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{visibleTags.map(tag => <span key={tag.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-black/[0.035] px-2 py-1 text-[10px] text-muted-foreground dark:bg-white/5"><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.bg_color || '#94a3b8' }} /><span className="truncate">{tag.name}</span></span>)}</div>}
        <h1 className="break-words text-[22px] font-semibold leading-[1.4] tracking-tight text-foreground">{email.subject || '(No subject)'}</h1>
        <div className="mt-6 flex min-w-0 items-start gap-3">
            <span className="mail-sender-avatar !size-10 !text-xs" aria-hidden="true">{mailInitials(senderName)}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><p className="min-w-0 break-words text-[13px] font-semibold">{senderName}</p>{validDate && <time dateTime={date.toISOString()} className="text-[11px] leading-5 text-muted-foreground" title={date.toLocaleString()}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}<span className="mx-1.5" aria-hidden="true">·</span>{date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>}</div>
                {sender.email && <button type="button" onClick={() => { void copy(sender.email); }} title="Copy sender address" className="group mt-1 flex max-w-full items-center gap-2 rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="truncate">{sender.email}</span><Copy className="size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" /></button>}
                <button type="button" aria-expanded={expanded} aria-controls="message-recipient-details" onClick={() => setExpanded(value => !value)} className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><span className="truncate">To {recipients.length ? recipients.slice(0, 2).map(recipient => recipient.name).join(', ') : 'me'}{recipients.length > 2 ? ` +${recipients.length - 2}` : ''}</span><ChevronDown className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button>
            </div>
        </div>
        {expanded && <div id="message-recipient-details" className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-black/[0.06] bg-white/40 p-3 text-xs dark:border-white/[0.07] dark:bg-white/[0.03]"><p className="mb-2 text-[10px] font-medium text-muted-foreground">Recipients</p>{recipients.length ? recipients.map((recipient, index) => <button key={`${recipient.email}-${index}`} type="button" disabled={!recipient.email} onClick={() => { void copy(recipient.email); }} className="flex w-full min-w-0 flex-wrap items-center gap-x-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-white/5"><span className="break-words font-medium">{recipient.name}</span><span className="break-all text-muted-foreground">{recipient.email}</span></button>) : <span className="text-muted-foreground">Recipient details are unavailable.</span>}</div>}
    </header>;
});
MessageHeader.displayName = 'MessageHeader';
