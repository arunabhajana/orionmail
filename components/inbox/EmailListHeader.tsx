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

export const SearchBar = memo(({ value = '', onChange, onClear, searchProgress }: SearchBarProps) => (
    <div className="w-full space-y-2">
        <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4 transition-colors group-focus-within:text-primary" />
            <input
                className={cn(
                    "w-full rounded-lg py-2 pl-9 pr-8 text-sm outline-none transition-all",
                    "bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 placeholder:text-muted-foreground/70",
                    "focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                )}
                placeholder="Search messages..."
                type="text"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
            />
            {value && (
                <button
                    onClick={onClear}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/20 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
        
        <AnimatePresence>
            {value && searchProgress && searchProgress.state !== 'Idle' && searchProgress.state !== 'Cancelled' && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                >
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-md border transition-all",
                        searchProgress.state === 'Completed' || searchProgress.progress_text.includes('Complete')
                            ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" 
                            : searchProgress.state === 'OfflineLocalOnly' || searchProgress.progress_text.includes('Offline')
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            : "bg-primary/10 text-primary border-primary/20"
                    )}>
                        {searchProgress.state !== 'Completed' && searchProgress.state !== 'OfflineLocalOnly' && !searchProgress.progress_text.includes('Offline') && !searchProgress.progress_text.includes('Complete') && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        )}
                        <span className="truncate flex-1">{searchProgress.progress_text}</span>
                        {searchProgress.total > 0 && (
                            <span className="text-[10px] bg-background/50 px-1.5 py-0.5 rounded border border-foreground/10 shrink-0">
                                {searchProgress.downloaded}/{searchProgress.total}
                            </span>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    </div>
));
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
