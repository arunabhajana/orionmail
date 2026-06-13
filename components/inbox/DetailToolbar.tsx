"use client";

import React, { memo } from 'react';
import { Archive, Trash2, Reply, MoreVertical, AlertOctagon, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export const ToolbarButton = memo(({
    icon: Icon,
    onClick,
    className,
    title
}: {
    icon: React.ElementType;
    onClick?: () => void;
    className?: string;
    title?: string;
}) => (
    <button
        onClick={onClick}
        title={title}
        className={cn(
            "p-2 rounded-lg transition-colors",
            "text-muted-foreground dark:text-white/60 hover:bg-muted dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white/90",
            className
        )}
    >
        <Icon className="w-5 h-5" />
    </button>
));
ToolbarButton.displayName = "ToolbarButton";

export const DetailToolbar = memo(({ isStarred, onToggleStar, onDelete }: { isStarred?: boolean; onToggleStar?: () => void; onDelete?: () => void }) => (
    <div className="h-16 px-6 flex items-center justify-between border-b border-border/60 shrink-0 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
            <ToolbarButton icon={Archive} title="Archive" />
            <ToolbarButton icon={AlertOctagon} title="Report Spam" />
            <ToolbarButton icon={Trash2} onClick={onDelete} title="Delete" />
            <div className="w-px h-6 bg-border mx-2" />
            <button
                onClick={onToggleStar}
                title={isStarred ? "Unstar" : "Star"}
                className="p-2 rounded-lg transition-colors text-muted-foreground dark:text-white/60 hover:bg-muted dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white/90 group"
            >
                <Star className={cn(
                    "w-5 h-5 transition-all",
                    isStarred ? "fill-yellow-400 text-yellow-400" : "group-hover:text-yellow-400"
                )} />
            </button>
        </div>
        <div className="flex items-center gap-2">
            <button
                title="Reply"
                className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    "border border-border dark:border-white/10 text-foreground dark:text-white/90 hover:bg-muted dark:hover:bg-white/10"
                )}
            >
                <Reply className="w-[18px] h-[18px]" />
                Reply
            </button>
            <ToolbarButton icon={MoreVertical} title="More Options" />
        </div>
    </div>
));
DetailToolbar.displayName = "DetailToolbar";
