"use client";

import React, { memo } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion } from 'framer-motion';

export const EmailListItem = memo(({
    email,
    isSelected,
    onSelect,
    onToggleStar
}: {
    email: Email;
    isSelected: boolean;
    onSelect?: (id: string) => void;
    onToggleStar?: (id: string) => void;
}) => {
    const [previewText, setPreviewText] = React.useState(email.preview || "");
    const itemRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        // We now rely solely on the background prefetcher (Rust) and the sqlite cache 
        // to populate the snippet without clogging the IPC command channel.
        setPreviewText(email.preview || "No preview available");
    }, [email.preview]);

    return (
        <motion.div
            ref={itemRef}
            layoutId={`email-${email.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            whileHover={{ scale: 1.01 }}
            onClick={() => onSelect?.(email.id)}
            className={cn(
                "px-4 py-4 cursor-pointer transition-all duration-200 border-b border-black/5 dark:border-white/5 hover:bg-white/40 dark:hover:bg-white/5",
                isSelected
                    ? "bg-primary/10 border-l-4 border-l-primary" // Selected
                    : "border-l-4 border-transparent" // Regular
            )}
        >
            <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar?.(email.id);
                        }}
                        className="group/star p-1 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                    )}
                    <span className={cn(
                        "text-sm truncate max-w-[160px] tracking-tight",
                        isSelected || email.unread
                            ? "font-semibold text-foreground dark:text-white/90"
                            : "font-medium text-foreground/80 dark:text-white/70"
                    )}>
                        {email.sender}
                    </span>
                </div>
                <span className={cn(
                    "text-[11px] font-medium whitespace-nowrap",
                    isSelected ? "text-primary dark:text-white/90" : "text-muted-foreground dark:text-white/50"
                )}>
                    {email.time}
                </span>
            </div>
            <h4 className={cn(
                "text-sm mb-1 truncate pr-2 tracking-tight",
                isSelected ? "font-semibold text-foreground/90 dark:text-white/90" : "font-medium text-foreground/70 dark:text-white/70"
            )}>
                {email.subject}
            </h4>
            <p className="text-xs text-muted-foreground dark:text-white/50 leading-relaxed line-clamp-2">
                {previewText}
            </p>
        </motion.div>
    );
});
EmailListItem.displayName = "EmailListItem";
