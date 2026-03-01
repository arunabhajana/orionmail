"use client";

import React, { memo } from 'react';
import { Search, Star, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/data';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useVirtualizer } from '@tanstack/react-virtual';

// Global cache states removed as predictive prefetch happens in Rust backend now

// --- Types ---

interface EmailListProps {
    className?: string;
    emails: Email[];
    selectedEmailId: string | null;
    onSelectEmail: (id: string) => void;
    onToggleStar?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onSync?: () => void;
    isSyncing?: boolean;
    onLoadMore?: () => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    listRef?: React.Ref<HTMLDivElement>;
}

// --- Constants ---


// --- Sub-Components ---

const SearchBar = memo(() => (
    <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 transition-colors group-focus-within:text-primary" />
        <input
            className={cn(
                "w-full rounded-lg py-2 pl-9 pr-4 text-sm outline-none transition-all",
                "bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 placeholder:text-muted-foreground/70",
                "focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
            )}
            placeholder="Search messages..."
            type="text"
        />
    </div>
));
SearchBar.displayName = "SearchBar";

const FilterTabs = memo(() => (
    <div className="flex gap-4 border-b border-black/5 dark:border-white/10 pb-1">
        <button className="text-foreground dark:text-white/90 border-b-2 border-primary pb-2 text-sm font-semibold">
            All
        </button>
        <button className="text-muted-foreground dark:text-white/60 pb-2 text-sm font-medium hover:text-foreground dark:hover:text-white/90 transition-colors">
            Unread
        </button>
        <button className="text-muted-foreground dark:text-white/60 pb-2 text-sm font-medium hover:text-foreground dark:hover:text-white/90 transition-colors">
            Flagged
        </button>
    </div>
));
FilterTabs.displayName = "FilterTabs";

const EmailListItem = memo(({
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

// --- Main Component ---

const EmailList: React.FC<EmailListProps> = ({
    className,
    emails,
    selectedEmailId,
    onSelectEmail,
    onToggleStar,
    onSync,
    isSyncing,
    onLoadMore,
    hasMore,
    isLoadingMore,
    listRef
}) => {
    const parentRef = React.useRef<HTMLDivElement>(null);
    const loadingRef = React.useRef(false);

    // Share the ref if passed
    React.useEffect(() => {
        if (!listRef) return;
        if (typeof listRef === 'function') {
            listRef(parentRef.current);
        } else {
            (listRef as React.MutableRefObject<HTMLDivElement | null>).current = parentRef.current;
        }
    }, [listRef]);

    const rowVirtualizer = useVirtualizer({
        count: emails.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 72,
        overscan: 8,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    React.useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || loadingRef.current) return;

        const lastItem = virtualItems[virtualItems.length - 1];
        if (!lastItem) return;

        if (lastItem.index >= emails.length - 5) {
            loadingRef.current = true;
            onLoadMore();
            setTimeout(() => {
                loadingRef.current = false;
            }, 500);
        }
    }, [virtualItems, hasMore, isLoadingMore, emails.length, onLoadMore]);

    return (
        <main
            className={cn(
                "glass-list flex flex-col h-full border-r transition-colors",
                "bg-white/60 dark:bg-black/80 backdrop-blur-2xl border-black/5 dark:border-white/5",
                className
            )}
        >
            {/* 1. Header Area with Search & Filter */}
            <div className="p-4 space-y-4 shrink-0 z-10">
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <SearchBar />
                    </div>
                    <button
                        onClick={onSync}
                        disabled={isSyncing}
                        className={cn(
                            "p-2 rounded-lg bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/10 transition-colors flex items-center justify-center",
                            isSyncing && "opacity-70 cursor-not-allowed"
                        )}
                        title="Sync Emails"
                    >
                        <RefreshCw className={cn("w-4 h-4 text-muted-foreground", isSyncing && "animate-spin text-primary")} />
                    </button>
                </div>
                <FilterTabs />
            </div>

            {/* 2. Scrollable List */}
            <div ref={parentRef} className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    <AnimatePresence>
                        {virtualItems.map((virtualRow) => {
                            const email = emails[virtualRow.index];
                            return (
                                <div
                                    key={`${email.folder}-${email.id}`}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <EmailListItem
                                        email={email}
                                        isSelected={selectedEmailId === email.id}
                                        onSelect={onSelectEmail}
                                        onToggleStar={onToggleStar}
                                    />
                                </div>
                            );
                        })}
                    </AnimatePresence>
                </div>
                {/* Loader showing below the items if loading more */}
                {hasMore && isLoadingMore && (
                    <div className="h-8 w-full flex justify-center items-center shrink-0">
                        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                )}
            </div>
        </main>
    );
};

export default EmailList;
