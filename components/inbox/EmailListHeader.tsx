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

export const FilterTabs = memo(() => (
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
