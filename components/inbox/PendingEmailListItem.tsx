"use client";
import React, { memo } from 'react';
import { Loader2, Send } from 'lucide-react';
import { PendingSentMessage } from '@/hooks/usePendingSentMessages';
export const PendingEmailListItem = memo(({ pending }: { pending: PendingSentMessage }) => <div className="flex min-w-0 items-start gap-3 rounded-xl bg-primary/5 p-3">
    <span className="mt-0.5 text-primary">{pending.status === 'sending' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{pending.subject || '(No subject)'}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">To {pending.recipients.join(', ')}</p><p className="mt-1 text-[10px] text-primary">{pending.status === 'sending' ? 'Sending…' : 'Sent · Waiting for mailbox sync'}</p></div>
</div>);
PendingEmailListItem.displayName = 'PendingEmailListItem';
