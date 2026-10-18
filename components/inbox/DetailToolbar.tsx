"use client";
import React, { memo } from 'react';
import { ArrowLeft, Mail, MailOpen, Star, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
export const ToolbarButton = memo(({ icon: Icon, onClick, className, title }: { icon: React.ElementType; onClick?: () => void; className?: string; title: string }) => <button type="button" onClick={onClick} disabled={!onClick} title={title} aria-label={title} className={cn('mail-icon-button', className)}><Icon className="size-[17px]" /></button>);
ToolbarButton.displayName = 'ToolbarButton';
export const DetailToolbar = memo(({ isStarred, isUnread, onToggleStar, onToggleRead, onDelete, onBack }: {
    isStarred?: boolean; isUnread?: boolean; onToggleStar?: () => void; onToggleRead?: () => void; onDelete?: () => void; onBack?: () => void;
}) => <div className="mail-pane-topbar mail-reading-toolbar">
    <div className="flex min-w-0 items-center gap-2"><button type="button" onClick={onBack} aria-label="Back to messages" title="Back to messages" className="mail-icon-button mail-back-button"><ArrowLeft className="size-[18px]" /></button><span className="truncate text-xs font-medium text-muted-foreground">Message</span></div>
    <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onToggleStar} disabled={!onToggleStar} aria-label={isStarred ? 'Unstar message' : 'Star message'} aria-pressed={Boolean(isStarred)} title={isStarred ? 'Unstar message' : 'Star message'} className={cn('mail-icon-button', isStarred && '!text-amber-500')}><Star className={cn('size-[17px]', isStarred && 'fill-current')} /></button>
        <ToolbarButton icon={isUnread ? MailOpen : Mail} onClick={onToggleRead} title={isUnread ? 'Mark as read' : 'Mark as unread'} />
        <span aria-hidden="true" className="mx-2 h-4 w-px bg-black/10 dark:bg-white/10" />
        <ToolbarButton icon={Trash2} onClick={onDelete} title="Delete message" className="hover:!bg-red-500/10 hover:!text-red-500" />
    </div>
</div>);
DetailToolbar.displayName = 'DetailToolbar';
