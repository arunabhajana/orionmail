"use client";

import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { PendingSentMessage } from '@/hooks/usePendingSentMessages';
import { Loader2 } from 'lucide-react';

export const PendingEmailListItem = memo(({ pending }: { pending: PendingSentMessage }) => {
    const isSending = pending.status === 'sending';

    return (
        <div className="relative border-b border-black/5 dark:border-white/5 overflow-hidden group">
            <div className="px-4 py-4 relative z-10 bg-background/50 backdrop-blur-md flex flex-col border-l-4 border-transparent opacity-80">
                <div className="flex justify-between items-start mb-1 h-6">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Placeholder for star icon spacing */}
                        <div className="w-6 h-6 shrink-0" />
                        <span className="text-sm truncate tracking-tight flex-1 min-w-0 font-medium text-foreground/80 dark:text-white/70">
                            <span className="text-muted-foreground/60 mr-1 font-normal">To:</span>
                            {pending.recipients.join(', ')}
                        </span>
                    </div>
                    <span className="text-[11px] font-medium whitespace-nowrap ml-2 shrink-0 flex items-center gap-1.5 text-muted-foreground dark:text-white/50">
                        {isSending ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                                <span>Sending...</span>
                            </>
                        ) : (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                                <span>Sent • Waiting for sync</span>
                            </>
                        )}
                    </span>
                </div>
                <h4 className="text-sm mb-1 truncate pr-2 tracking-tight flex-none font-medium text-foreground/70 dark:text-white/70 pl-8">
                    {pending.subject}
                </h4>
                <p className="text-xs text-muted-foreground dark:text-white/50 leading-relaxed line-clamp-2 flex-none pl-8 italic">
                    Pending synchronization...
                </p>
            </div>
        </div>
    );
});
PendingEmailListItem.displayName = "PendingEmailListItem";
