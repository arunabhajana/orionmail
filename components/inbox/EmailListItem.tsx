"use client";

import React, { memo } from 'react';
import { Loader2, Paperclip, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email, Tag } from '@/lib/types';
import { mailInitials, contactFromHeader, splitHeaderAddresses } from '@/lib/mail-display';
import { useAppPreferences } from '../AppPreferencesContext';

export const EmailListItem = memo(({ email, isSelected, onSelect, onToggleStar, onContextMenu, allTags = {} }: {
    email: Email;
    isSelected: boolean;
    onSelect?: (id: string) => void;
    onToggleStar?: (id: string) => void;
    onToggleRead?: (id: string) => void;
    onDelete?: (id: string) => void;
    onContextMenu?: (event: React.MouseEvent, id: string) => void;
    allTags?: Record<string, Tag>;
}) => {
    const { preferences } = useAppPreferences();
    const sent = email.folder === 'sent';
    const sender = sent && email.to ? splitHeaderAddresses(email.to).map(value => contactFromHeader(value).name).join(", ") : contactFromHeader(email.sender).name;
    const tags = email.tags.map(id => allTags[id]).filter(tag => tag && tag.tag_type !== 'system');
    const validDate = Number.isFinite(new Date(email.timestamp).getTime());
    const timestamp = preferences.dateFormat === 'absolute'
        ? new Date(email.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : email.time;

    return <article onContextMenu={event => onContextMenu?.(event, email.id)} className={cn('mail-message-card group', isSelected && 'is-selected', email.unread && 'is-unread')} data-density={preferences.density}>
        <button type="button" onClick={() => onSelect?.(email.id)} className="mail-message-hit" aria-label={`${email.unread ? 'Unread: ' : ''}${sender}, ${email.subject}`} aria-current={isSelected ? 'true' : undefined} />
        <div className="pointer-events-none relative flex min-w-0 gap-3">
            {preferences.showAvatars && <span aria-hidden="true" className="mail-sender-avatar">{mailInitials(sender)}</span>}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', email.unread ? 'bg-primary' : 'bg-transparent')} />
                    <span className={cn('min-w-0 flex-1 truncate text-[13px] leading-5', email.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/75')} title={sender}>{sent && <span className="mr-1 font-normal text-muted-foreground">To</span>}{sender || 'Unknown sender'}</span>
                    <time title={email.date} dateTime={validDate ? new Date(email.timestamp).toISOString() : undefined} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timestamp}</time>
                    <button type="button" aria-label={email.starred ? 'Unstar message' : 'Star message'} aria-pressed={email.starred} disabled={!onToggleStar} onClick={() => onToggleStar?.(email.id)} className={cn('mail-star-button pointer-events-auto relative z-10 -mr-1', email.starred && 'is-starred')}><Star className={cn('size-3.5', email.starred && 'fill-current')} /></button>
                </div>
                <h3 className={cn('mt-1 truncate text-[13px] leading-5', email.unread ? 'font-semibold text-foreground/90' : 'font-medium text-foreground/80')} title={email.subject}>{email.subject || '(No subject)'}</h3>
                {preferences.previewLines !== '0' && <p className={cn('mt-1 text-xs leading-[1.65] text-muted-foreground', preferences.previewLines === '1' ? 'line-clamp-1' : 'line-clamp-2')}>{email.preview || 'No preview available'}</p>}
                {(tags.length > 0 || email.attachments.length > 0) && <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden">
                    {tags.slice(0, 2).map(tag => <span key={tag.id} className="inline-flex max-w-28 items-center gap-1.5 truncate rounded-md bg-black/[0.035] px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/[0.05]" title={tag.name}><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.bg_color || '#94a3b8' }} /><span className="truncate">{tag.name}</span></span>)}
                    {tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>}
                    {email.tagsPending && <Loader2 aria-label="Saving tags to Gmail" className="size-3 shrink-0 animate-spin text-primary" />}
                    {email.attachments.length > 0 && <Paperclip aria-label="Has attachments" className="ml-auto size-3 text-muted-foreground" />}
                </div>}
            </div>
        </div>
    </article>;
});
EmailListItem.displayName = 'EmailListItem';
