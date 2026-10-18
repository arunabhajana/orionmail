"use client";

import React, { memo } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { useAppPreferences } from '../AppPreferencesContext';

const formatRecipient = (toHeader: string | undefined): string => {
    if (!toHeader) return "";
    const recipients = toHeader.split(',').map(r => r.trim());
    const parsed = recipients.map(r => {
        let name = r.split('<')[0].trim();
        name = name.replace(/^["']|["']$/g, '');
        if (name) return name;
        
        const emailMatch = r.match(/<([^>]+)>/);
        if (emailMatch) return emailMatch[1].split('@')[0];
        
        return r.split('@')[0];
    });
    return parsed.filter(p => p).join(', ');
};

export const EmailListItem = memo(({
    email,
    isSelected,
    onSelect,
    onToggleStar,
    onContextMenu,
    allTags = {}
}: {
    email: Email;
    isSelected: boolean;
    onSelect?: (id: string) => void;
    onToggleStar?: (id: string) => void;
    onToggleRead?: (id: string) => void;
    onDelete?: (id: string) => void;
    onContextMenu?: (e: React.MouseEvent, id: string) => void;
    allTags?: Record<string, import('@/lib/types').Tag>;
}) => {
    const { preferences } = useAppPreferences();
    const previewText = email.preview || "No preview available";

    const isSent = email.folder === 'sent';
    const displaySender = isSent && email.to ? formatRecipient(email.to) : email.sender;

    return (
        <div
            onContextMenu={(e) => onContextMenu?.(e, email.id)}
            className="relative border-b border-black/5 dark:border-white/5 overflow-hidden group"
        >
            <div
                onClick={() => onSelect?.(email.id)}
                className={cn(
                    "px-4 cursor-pointer transition-all duration-200 relative z-10 bg-background/50 backdrop-blur-md flex flex-col",
                    preferences.density === "compact" ? "py-2" : preferences.density === "relaxed" ? "py-6" : "py-4",
                    isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary" // Selected
                        : "border-l-4 border-transparent hover:bg-white/40 dark:hover:bg-white/5" // Regular
                )}
            >
                <div className="flex justify-between items-start mb-1 h-6">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleStar?.(email.id);
                            }}
                            className="group/star p-1 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                        >
                            <Star
                                className={cn(
                                    "w-4 h-4 transition-all duration-200",
                                    email.starred
                                        ? "fill-yellow-400 text-yellow-400 scale-110"
                                        : "text-muted-foreground/40 group-hover/star:text-muted-foreground group-hover/star:scale-110"
                                )}
                            />
                        </button>
                        {email.unread && !isSelected && (
                            <div className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                        )}
                        {preferences.showAvatars && <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{displaySender.slice(0, 2).toUpperCase()}</span>}
                        <span className={cn(
                            "text-sm truncate tracking-tight flex-1 min-w-0",
                            isSelected || email.unread
                                ? "font-semibold text-foreground dark:text-white/90"
                                : "font-medium text-foreground/80 dark:text-white/70"
                        )}>
                            {isSent && <span className="text-muted-foreground/60 mr-1 font-normal">To:</span>}
                            {displaySender}
                        </span>
                    </div>
                    <span className={cn(
                        "text-[11px] font-medium whitespace-nowrap ml-2 shrink-0",
                        isSelected ? "text-primary dark:text-white/90" : "text-muted-foreground dark:text-white/50"
                    )}>
                        {preferences.dateFormat === "absolute" ? new Date(email.timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : email.time}
                    </span>
                </div>
                
                {email.tags && email.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5 overflow-hidden">
                        {email.tags.map(tid => {
                            const tag = allTags[tid];
                            if (!tag) return null;
                            if (tag.tag_type === 'system') return null; // Hide system tags from the preview
                            return (
                                <span key={tid} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: tag.bg_color || '#e5e7eb', color: tag.text_color || '#374151' }}>
                                    {tag.name}
                                </span>
                            );
                        })}
                    </div>
                )}
                
                <h4 className={cn(
                    "text-sm mb-1 truncate pr-2 tracking-tight flex-none",
                    isSelected ? "font-semibold text-foreground/90 dark:text-white/90" : "font-medium text-foreground/70 dark:text-white/70"
                )}>
                    {email.subject}
                </h4>
                {preferences.previewLines !== "0" && <p className={cn("text-xs text-muted-foreground dark:text-white/50 leading-relaxed flex-none", preferences.previewLines === "1" ? "line-clamp-1" : "line-clamp-2")}>
                    {previewText}
                </p>}
            </div>
        </div>
    );
});
EmailListItem.displayName = "EmailListItem";
