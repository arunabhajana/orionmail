"use client";

import React, { memo } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export const SearchBar = memo(() => (
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
