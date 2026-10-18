"use client";
import React, { memo } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
export interface SearchProgressData {
    search_id: string; state: string; matched: number; downloaded: number; indexed: number;
    streamed: number; total: number; progress_text: string;
}
interface SearchBarProps {
    value?: string; onChange?: (value: string) => void; onClear?: () => void; searchProgress?: SearchProgressData | null;
}
export const SearchBar = memo(({ value = '', onChange, onClear, searchProgress }: SearchBarProps) => {
    const searching = Boolean(value && searchProgress && !['Completed', 'Cancelled', 'OfflineLocalOnly', 'Failed'].includes(searchProgress.state) && !/Complete|Offline/.test(searchProgress.progress_text));
    return <div className="mail-search relative w-full">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input aria-label="Search messages" placeholder="Search messages…" type="search" value={value} onChange={event => onChange?.(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && value) { event.preventDefault(); onClear?.(); } }} className="mail-search-input" />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searching && <Loader2 aria-label="Searching server" className="size-3.5 animate-spin text-primary" />}
            {value && <button type="button" aria-label="Clear search" onClick={onClear} className="mail-icon-button !size-6"><X className="size-3.5" /></button>}
        </div>
    </div>;
});
SearchBar.displayName = 'SearchBar';
export type FilterType = 'all' | 'unread' | 'flagged';
export const FilterTabs = memo(({ currentFilter, onFilterChange }: { currentFilter: FilterType; onFilterChange: (filter: FilterType) => void }) => <div role="group" aria-label="Filter messages" className="flex min-w-0 gap-1 rounded-xl bg-black/[0.035] p-1 dark:bg-white/[0.035]">
    {([['all', 'All mail'], ['unread', 'Unread'], ['flagged', 'Starred']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={currentFilter === id} onClick={() => onFilterChange(id)} className={cn('min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', currentFilter === id ? 'bg-white/80 text-foreground shadow-sm dark:bg-white/10' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
</div>);
FilterTabs.displayName = 'FilterTabs';
