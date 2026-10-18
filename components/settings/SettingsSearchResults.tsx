"use client";

import { ChevronRight, Search, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SETTINGS_TABS, SettingsSearchResult } from './settingsSearch';

export function SettingsSearchResults({ query, results, selectedIndex, onSelect, onHighlight }: {
    query: string; results: SettingsSearchResult[]; selectedIndex: number;
    onSelect: (result: SettingsSearchResult) => void; onHighlight: (index: number) => void;
}) {
    return <section aria-label="Settings search results">
        <header className="border-b border-black/[0.07] dark:border-white/[0.07] px-6 py-8 md:px-12 md:py-10">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-pink-600 dark:text-pink-400"><Search className="size-4" />Search results</p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">Results for “{query.trim()}”</h1>
            <p role="status" className="mt-3 text-sm text-muted-foreground">{results.length} matching {results.length === 1 ? 'setting' : 'settings'} across your preferences.</p>
        </header>
        <div id="settings-search-results" role="listbox" aria-label="Matching settings" className="max-w-5xl mx-auto space-y-7 px-6 py-7 md:px-12 md:py-8">
            {SETTINGS_TABS.map(tab => {
                const entries = results.filter(result => result.section === tab.id);
                if (!entries.length) return null;
                const Icon = tab.icon;
                return <div key={tab.id} role="group" aria-labelledby={`search-group-${tab.id}`}>
                    <div className="mb-3 flex items-center gap-2.5"><span className={cn('inline-flex size-7 items-center justify-center rounded-lg', tab.color)}><Icon className="size-4" /></span><h2 id={`search-group-${tab.id}`} className="text-sm font-semibold">{tab.label}</h2><span className="ml-auto text-xs text-muted-foreground">{entries.length}</span></div>
                    <div className="space-y-2">{entries.map(result => {
                        const index = results.findIndex(item => item.id === result.id);
                        return <button id={`settings-search-${result.id}`} key={result.id} type="button" role="option" aria-selected={selectedIndex === index} onMouseEnter={() => onHighlight(index)} onFocus={() => onHighlight(index)} onClick={() => onSelect(result)}
                            className={cn('group w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', selectedIndex === index ? 'border-primary/40 bg-primary/[0.04] dark:bg-white/[0.045]' : 'border-white/60 dark:border-white/[0.08] bg-white/40 dark:bg-white/[0.03] backdrop-blur-xl hover:border-primary/30')}>
                            <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-xl', tab.color)}><Icon className="size-[18px]" /></span>
                            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{result.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{result.description}</span></span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </button>;
                    })}</div>
                </div>;
            })}
            {!results.length && <div className="py-16 text-center"><SearchX className="mx-auto mb-4 size-9 text-muted-foreground/60" /><h2 className="font-semibold">No matching settings</h2><p className="mt-2 text-sm text-muted-foreground">Try a setting like “app lock”, “accent”, or “startup”.</p></div>}
        </div>
    </section>;
}
