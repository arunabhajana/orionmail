"use client";
import React, { memo,useEffect,useRef,useState } from 'react';
import { Search, X, Loader2,SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {AdvancedSearch} from './AdvancedSearch';
import {searchTokens} from '@/lib/search-query';
export interface SearchProgressData {
    search_id: string; state: string; matched: number; downloaded: number; indexed: number;
    streamed: number; total: number; progress_text: string;
}
interface SearchBarProps {
    unified?:boolean;
    placeholder?:string; value?: string; onChange?: (value: string) => void; onClear?: () => void; searchProgress?: SearchProgressData | null;
}
export const SearchBar = memo(({ placeholder='Search messages…', value = '', onChange, onClear, searchProgress,unified }: SearchBarProps) => {
    const input=useRef<HTMLInputElement>(null);const [advanced,setAdvanced]=useState(false);
    const tokens=searchTokens(value);const filters=tokens.map((token,index)=>({token,index})).filter(item=>/^-?[a-z]+:/i.test(item.token));
    useEffect(()=>{const search=(event:Event)=>{if(input.current?.closest('[hidden],[inert]'))return;const query=(event as CustomEvent<{query:string}>).detail?.query;if(typeof query==='string'){onChange?.(query);input.current?.focus();}};window.addEventListener('orion:search',search);return()=>window.removeEventListener('orion:search',search);},[onChange]);
    const searching = Boolean(value && searchProgress && !['Completed', 'Cancelled', 'OfflineLocalOnly', 'Failed'].includes(searchProgress.state) && !/Complete|Offline/.test(searchProgress.progress_text));
    return <div><div className="mail-search relative w-full">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input ref={input} data-mail-search="true" aria-label="Search messages" placeholder={placeholder} type="search" maxLength={2048} value={value} onChange={event => onChange?.(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && value) { event.preventDefault(); onClear?.(); } }} className="mail-search-input" style={{paddingRight:value?84:94}} />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searching && <Loader2 aria-label="Searching server" className="size-3.5 animate-spin text-primary" />}
            {value && <button type="button" aria-label="Clear search" onClick={onClear} className="mail-icon-button !size-6"><X className="size-3.5" /></button>}
            {!value&&<kbd aria-hidden="true" className="mr-1 text-[9px] text-muted-foreground/70">Ctrl S</kbd>}
            <button type="button" aria-label="Advanced search" aria-expanded={advanced} onClick={()=>setAdvanced(true)} className={cn('mail-icon-button !size-7',filters.length>0&&'bg-primary/10 text-primary')}><SlidersHorizontal className="size-3.5"/></button>
        </div>
    </div>{filters.length>0&&<div aria-label="Active search filters" className="mt-2 flex flex-wrap gap-1.5">{filters.slice(0,3).map(({token,index})=><button key={index} type="button" title={'Remove '+token} aria-label={'Remove filter '+token} onClick={()=>onChange?.(tokens.filter((_,i)=>i!==index).join(' '))} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-primary/[0.08] px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary/15"><span className="max-w-40 truncate">{token}</span><X className="size-2.5 shrink-0"/></button>)}{filters.length>3&&<button type="button" onClick={()=>setAdvanced(true)} className="text-[10px] text-muted-foreground">+{filters.length-3} filters</button>}</div>}{searchProgress?.state==='Failed'&&<p role="alert" className="mt-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">{searchProgress.progress_text}</p>}{advanced&&<AdvancedSearch value={value} unified={unified} onClose={()=>setAdvanced(false)} onApply={query=>{onChange?.(query);setAdvanced(false);}}/>}</div>;
});
SearchBar.displayName = 'SearchBar';
export type FilterType = 'all' | 'unread' | 'flagged';
export const FilterTabs = memo(({ currentFilter, onFilterChange }: { currentFilter: FilterType; onFilterChange: (filter: FilterType) => void }) => <div role="group" aria-label="Filter messages" className="flex min-w-0 gap-1 rounded-xl bg-black/[0.035] p-1 dark:bg-white/[0.035]">
    {([['all', 'All mail'], ['unread', 'Unread'], ['flagged', 'Starred']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={currentFilter === id} onClick={() => onFilterChange(id)} className={cn('min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', currentFilter === id ? 'bg-white/80 text-foreground shadow-sm dark:bg-white/10' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
</div>);
FilterTabs.displayName = 'FilterTabs';
