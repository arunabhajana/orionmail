"use client";

import React, { memo } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export interface SearchProgressData {
    search_id: string;
    state: string;
    matched: number;
    downloaded: number;
    indexed: number;
    streamed: number;
    total: number;
    progress_text: string;
}

interface SearchBarProps {
    value?: string;
    onChange?: (value: string) => void;
    onClear?: () => void;
    searchProgress?: SearchProgressData | null;
}

export const SearchBar = memo(({ value = '', onChange, onClear, searchProgress }: SearchBarProps) => {
    const isSearchingServer = value && searchProgress && searchProgress.state !== 'Completed' && searchProgress.state !== 'Cancelled' && searchProgress.state !== 'OfflineLocalOnly' && !searchProgress.progress_text.includes('Complete') && !searchProgress.progress_text.includes('Offline');

    return (
        <div className="w-full">
            <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 transition-colors group-focus-within:text-primary" />
                <input
                    className={cn(
                        "w-full rounded-lg py-2 pl-9 pr-20 text-sm outline-none transition-all",
                        "bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 placeholder:text-muted-foreground/70",
                        "focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                    )}
                    placeholder="Search messages..."
                    type="text"
                    value={value}
                    onChange={(e) => onChange?.(e.target.value)}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <AnimatePresence>
                        {isSearchingServer && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-medium border border-primary/20"
                                title="Checking mail server for updates..."
                            >
                                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                <span>Server</span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    {value && (
                        <button
                            onClick={onClear}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/20 transition-colors"
                            title="Clear search"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});
SearchBar.displayName = "SearchBar";

export type FilterType = 'all' | 'unread' | 'flagged';

interface FilterTabsProps {
    currentFilter: FilterType;
    onFilterChange: (filter: FilterType) => void;
}

export const FilterTabs = memo(({ currentFilter, onFilterChange }: FilterTabsProps) => (
    <div className="flex gap-4 border-b border-black/5 dark:border-white/10 pb-1">
        <button 
            onClick={() => onFilterChange('all')}
            className={cn(
                "pb-2 text-sm transition-colors",
                currentFilter === 'all' 
                    ? "text-foreground dark:text-white/90 border-b-2 border-primary font-semibold" 
                    : "text-muted-foreground dark:text-white/60 font-medium hover:text-foreground dark:hover:text-white/90"
            )}
        >
            All
        </button>
        <button 
            onClick={() => onFilterChange('unread')}
            className={cn(
                "pb-2 text-sm transition-colors",
                currentFilter === 'unread' 
                    ? "text-foreground dark:text-white/90 border-b-2 border-primary font-semibold" 
                    : "text-muted-foreground dark:text-white/60 font-medium hover:text-foreground dark:hover:text-white/90"
            )}
        >
            Unread
        </button>
        <button 
            onClick={() => onFilterChange('flagged')}
            className={cn(
                "pb-2 text-sm transition-colors",
                currentFilter === 'flagged' 
                    ? "text-foreground dark:text-white/90 border-b-2 border-primary font-semibold" 
                    : "text-muted-foreground dark:text-white/60 font-medium hover:text-foreground dark:hover:text-white/90"
            )}
        >
            Flagged
        </button>
    </div>
));
FilterTabs.displayName = "FilterTabs";
