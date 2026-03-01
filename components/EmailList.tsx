"use client";

import React, { memo } from 'react';
import { Search, Star, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchBar, FilterTabs } from './inbox/EmailListHeader';
import { EmailListItem } from './inbox/EmailListItem';
import { useVirtualEmailList } from '@/hooks/useVirtualEmailList';

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
    const { parentRef, rowVirtualizer, virtualItems } = useVirtualEmailList({
        itemCount: emails.length,
        hasMore,
        isLoadingMore,
        onLoadMore,
        listRef,
    });

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
