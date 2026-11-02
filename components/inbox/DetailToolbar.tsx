"use client";
import React, { memo } from 'react';
import { ArrowLeft, Mail, MailOpen, Reply, ReplyAll, Forward, Tags, Clock, Star, Trash2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionTooltip } from '@/components/ui/ActionTooltip';
export const ToolbarButton = memo(({ icon: Icon, onClick, className, title, pressed }: { icon: React.ElementType; onClick?: () => void; className?: string; title: string; pressed?:boolean }) => <ActionTooltip label={title}>{description=><button type="button" onClick={onClick} disabled={!onClick} aria-label={title} aria-describedby={description} aria-pressed={pressed} className={cn('mail-icon-button mail-toolbar-action', className)}><Icon aria-hidden="true" className={cn('size-[17px]',pressed&&'fill-current')} /></button>}</ActionTooltip>);
ToolbarButton.displayName = 'ToolbarButton';
export const DetailToolbar = memo(({ isStarred, isUnread, onToggleStar, onToggleRead, onDelete, onBack, isTrash, onRestore, onReply, onReplyAll, onForward, onManageTags, onSnooze, isSnoozed }: {
    isStarred?: boolean; isUnread?: boolean; onToggleStar?: () => void; onToggleRead?: () => void; onDelete?: () => void; onBack?: () => void; onReply?:()=>void;onReplyAll?:()=>void;onForward?:()=>void;onManageTags?:()=>void;onSnooze?:()=>void;isSnoozed?:boolean;
    isTrash?: boolean; onRestore?: () => void;
}) => <div className="mail-pane-topbar mail-reading-toolbar">
    <div className="flex min-w-0 items-center gap-2"><span className="mail-back-button"><ToolbarButton icon={ArrowLeft} onClick={onBack} title="Back to messages" /></span><span className="truncate text-xs font-medium text-muted-foreground">{isTrash ? 'Trash' : 'Message'}</span></div>
    <div className="flex shrink-0 items-center gap-1">
        <ToolbarButton icon={Reply} onClick={onReply} title="Reply" />
        <ToolbarButton icon={ReplyAll} onClick={onReplyAll} title="Reply all" />
        <ToolbarButton icon={Forward} onClick={onForward} title="Forward" />
        <ToolbarButton icon={Clock} onClick={onSnooze} title={isSnoozed?'Reschedule snooze':onSnooze?'Snooze':'Snooze (Inbox only)'} className={isSnoozed?'!text-primary':undefined} />
        <ToolbarButton icon={Tags} onClick={onManageTags} title="Manage tags" />
        <ToolbarButton icon={Star} onClick={onToggleStar} title={isStarred ? 'Unstar message' : 'Star message'} pressed={Boolean(isStarred)} className={isStarred?'!text-amber-500':undefined} />
        <ToolbarButton icon={isUnread ? MailOpen : Mail} onClick={onToggleRead} title={isUnread ? 'Mark as read' : 'Mark as unread'} />
        <span aria-hidden="true" className="mx-2 h-4 w-px bg-black/10 dark:bg-white/10" />
        {isTrash && <ToolbarButton icon={Undo2} onClick={onRestore} title="Restore to Inbox" />}
        <ToolbarButton icon={Trash2} onClick={onDelete} title={isTrash ? 'Delete forever' : 'Move to Trash'} className="hover:!bg-red-500/10 hover:!text-red-500" />
    </div>
</div>);
DetailToolbar.displayName = 'DetailToolbar';
