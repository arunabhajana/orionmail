"use client";

import React, { memo } from 'react';
import { Search, Star, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchBar, FilterTabs } from './inbox/EmailListHeader';
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
    const { parentRef, rowVirtualizer, virtualItems } = useVirtualEmailList({
        itemCount: emails.length,
        hasMore,
        isLoadingMore,
        onLoadMore,
        listRef,
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
                const email = emails[i];
                if (email) {
                    requests.push({ folder: email.folder, uid: email.uid });
                }
            }
            
            if (requests.length > 0) {
                invoke('prefetch_messages', { requests }).catch(console.error);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [virtualItems, emails]);

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
                <FilterTabs />
            </div>

            {/* 2. Scrollable List or Placeholder */}
            {(currentFolder === "drafts" || currentFolder === "trash") ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/50 italic px-4 text-center">
                    This folder will be implemented soon!
                </div>
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
                    <AnimatePresence>
                        {virtualItems.map((virtualRow) => {
                            const email = emails[virtualRow.index];
                            return (
                                <div
                                    key={email.id}
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
                    </AnimatePresence>
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
