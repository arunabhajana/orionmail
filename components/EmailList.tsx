"use client";

import React, { memo } from 'react';
import { Search, Star, RefreshCw, Mailbox, CheckCircle2, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchBar, FilterTabs, FilterType } from './inbox/EmailListHeader';
import { EmailListItem } from './inbox/EmailListItem';
import { useVirtualEmailList } from '@/hooks/useVirtualEmailList';
import OrbitLoader from './inbox/OrbitLoader';
import { invoke } from '@tauri-apps/api/core';

// Global cache states removed as predictive prefetch happens in Rust backend now

// --- Types ---

interface EmailListProps {
    className?: string;
    emails: Email[];
    selectedEmailId: string | null;
    onSelectEmail: (id: string) => void;
    onToggleStar?: (emailId: string) => void;
    onToggleRead?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onSync?: () => void;
    isSyncing?: boolean;
    onLoadMore?: () => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    listRef?: React.Ref<HTMLDivElement>;
    currentFolder?: string;
}

// --- Constants ---

// --- Main Component ---

const EmailList: React.FC<EmailListProps> = ({
    className,
    emails,
    selectedEmailId,
    onSelectEmail,
    onToggleStar,
    onToggleRead,
    onDeleteMessage,
    onSync,
    isSyncing,
    onLoadMore,
    hasMore,
    isLoadingMore,
    listRef,
    currentFolder
}) => {
    const [currentFilter, setCurrentFilter] = React.useState<FilterType>('all');

    React.useEffect(() => {
        setCurrentFilter('all');
    }, [currentFolder]);

    const displayedEmails = React.useMemo(() => {
        switch (currentFilter) {
            case 'unread': return emails.filter(e => e.unread);
            case 'flagged': return emails.filter(e => e.starred);
            default: return emails;
        }
    }, [emails, currentFilter]);

    const { parentRef, rowVirtualizer, virtualItems } = useVirtualEmailList({
        itemCount: displayedEmails.length,
        hasMore,
        isLoadingMore,
        onLoadMore,
        listRef,
        getItemKey: (index) => displayedEmails[index]?.id || index,
    });

    React.useEffect(() => {
        if (!virtualItems || virtualItems.length === 0) return;

        const timer = setTimeout(() => {
            const firstVisible = virtualItems[0].index;
            const lastVisible = virtualItems[virtualItems.length - 1].index;
            
            // +/- 5 rows for prefetch window
            const startIdx = Math.max(0, firstVisible - 5);
            const endIdx = Math.min(emails.length - 1, lastVisible + 5);
            
            const requests = [];
            for (let i = startIdx; i <= endIdx; i++) {
                const email = displayedEmails[i];
                if (email) {
                    requests.push({ folder: email.folder, uid: email.uid });
                }
            }
            
            if (requests.length > 0) {
                invoke('prefetch_messages', { requests }).catch(console.error);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [virtualItems, displayedEmails]);

    const pullDistance = React.useRef(0);
    const touchStart = React.useRef(0);

    const handleWheel = (e: React.WheelEvent) => {
        if (parentRef.current && parentRef.current.scrollTop <= 0 && e.deltaY < 0) {
            pullDistance.current -= e.deltaY;
            if (pullDistance.current > 150 && !isSyncing) {
                pullDistance.current = 0;
                onSync?.();
            }
        } else {
            pullDistance.current = 0;
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (parentRef.current && parentRef.current.scrollTop <= 0) {
            touchStart.current = e.touches[0].clientY;
        } else {
            touchStart.current = 0;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStart.current > 0 && parentRef.current && parentRef.current.scrollTop <= 0) {
            const delta = e.touches[0].clientY - touchStart.current;
            if (delta > 100 && !isSyncing) {
                touchStart.current = 0;
                onSync?.();
            }
        }
    };

    const handleTouchEnd = () => {
        touchStart.current = 0;
    };

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
                <FilterTabs currentFilter={currentFilter} onFilterChange={setCurrentFilter} />
            </div>

            {/* 2. Scrollable List or Placeholder */}
            {(currentFolder === "drafts" || currentFolder === "trash") ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                        <Mailbox className="w-10 h-10 text-primary opacity-80" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">Folder in progress</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        This folder will be implemented soon!
                    </p>
                </motion.div>
            ) : emails.length === 0 && isSyncing ? (
                // Loading skeleton shown while the folder is being fetched / synced
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="flex-1 flex flex-col px-3 pt-2 gap-2"
                >
                    {[...Array(7)].map((_, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-3 p-3 rounded-xl bg-white/30 dark:bg-white/5 animate-pulse"
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            <div className="w-9 h-9 rounded-full bg-gray-200/70 dark:bg-white/10 shrink-0" />
                            <div className="flex-1 space-y-2 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="h-3 bg-gray-200/70 dark:bg-white/10 rounded-full w-28" />
                                    <div className="h-2.5 bg-gray-200/50 dark:bg-white/5 rounded-full w-12" />
                                </div>
                                <div className="h-2.5 bg-gray-200/60 dark:bg-white/8 rounded-full w-3/4" />
                                <div className="h-2 bg-gray-200/40 dark:bg-white/5 rounded-full w-1/2" />
                            </div>
                        </div>
                    ))}
                </motion.div>
            ) : emails.length === 0 && !isSyncing ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                        <Mailbox className="w-10 h-10 text-primary opacity-80" />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">No messages here</h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        Your {currentFolder} is completely empty.
                    </p>
                </motion.div>
            ) : displayedEmails.length === 0 && !isSyncing ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }} className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className={cn(
                        "w-20 h-20 rounded-full flex items-center justify-center mb-6",
                        currentFilter === 'unread' ? "bg-green-500/10" : "bg-amber-500/10"
                    )}>
                        {currentFilter === 'unread' ? (
                            <CheckCircle2 className="w-10 h-10 text-green-500 opacity-80" />
                        ) : (
                            <Flag className="w-10 h-10 text-amber-500 opacity-80" />
                        )}
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                        {currentFilter === 'unread' ? "All caught up!" : "No flagged messages"}
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-[250px]">
                        {currentFilter === 'unread' 
                            ? "You've read all the messages in this view." 
                            : "Star some messages to see them here for quick access."}
                    </p>
                </motion.div>
            ) : (
                <div 
                    ref={parentRef} 
                    className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar relative"
                    onWheel={handleWheel}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {virtualItems.map((virtualRow) => {
                            const email = displayedEmails[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
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
                                        onToggleRead={onToggleRead}
                                        onDelete={onDeleteMessage}
                                    />
                                </div>
                            );
                        })}
                </div>
                {/* Loader showing below the items if loading more */}
                {hasMore && isLoadingMore && (
                    <div className="py-6 w-full flex justify-center items-center shrink-0">
                        <OrbitLoader size="sm" message="" />
                    </div>
                )}
            </div>
            )}
        </main>
    );
};

export default EmailList;
