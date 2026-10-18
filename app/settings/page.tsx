"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, ChevronLeft, Search, X, Inbox, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SETTINGS_TABS, SettingsTab, SettingsSearchResult, searchSettings } from '@/components/settings/settingsSearch';
import { SettingsSearchResults } from '@/components/settings/SettingsSearchResults';

// Modular Components
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { SystemSection } from '@/components/settings/SystemSection';
import { PreferencesSection } from '@/components/settings/PreferencesSection';
import { MailDataSection } from '@/components/settings/MailDataSection';
import { AboutSection } from '@/components/settings/AboutSection';
import { useAuth } from '@/components/AuthContext';
import { SettingsProvider, useSettings } from '@/components/settings/SettingsContext';
import { UnsavedChangesBar } from '@/components/settings/UnsavedChangesBar';
import { ConfirmNavigationDialog } from '@/components/settings/ConfirmNavigationDialog';
import { useRouter } from 'next/navigation';
import packageInfo from '@/package.json';
import { toast } from 'sonner';

// --- Main Page Component ---

function SettingsPageInner() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
    const [pendingSearchResult, setPendingSearchResult] = useState<SettingsSearchResult | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLElement>(null);
    const { user, logout } = useAuth();
    const router = useRouter();
    const { dirtySections, requestNavigation, hasUnsavedChanges, isSaving } = useSettings();
    const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery]);
    const isSearching = Boolean(searchQuery.trim());
    const visibleTabs = SETTINGS_TABS;
    const activeSection = SETTINGS_TABS.find(tab => tab.id === activeTab)!;
    const ActiveIcon = activeSection.icon;

    const closeSearch = () => {
        setSearchQuery('');
        setSelectedSearchIndex(0);
        setPendingSearchResult(null);
        contentRef.current?.scrollTo({ top: 0 });
    };

    const focusSetting = (result: SettingsSearchResult) => {
        const openResult = () => {
            closeSearch();
            setActiveTab(result.section);
            setPendingSearchResult(result);
        };
        if (result.section === activeTab) openResult();
        else requestNavigation(openResult);
    };

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
    }, []);

    useEffect(() => {
        if (!pendingSearchResult || pendingSearchResult.section !== activeTab) return;
        let target: HTMLElement | null = null;
        let highlightTimer: ReturnType<typeof setTimeout> | undefined;
        const tryFocus = () => {
            if (target) return;
            target = contentRef.current?.querySelector<HTMLElement>(`[data-setting-id="${pendingSearchResult.id}"]`) ?? null;
            if (!target) return;
            observer.disconnect();
            clearTimeout(waitTimer);
            target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
            target.classList.add('ring-2', 'ring-primary/50');
            const focusable = target.matches('button, input, select, textarea') ? target : target.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
            if (focusable) focusable.focus({ preventScroll: true });
            else { target.tabIndex = -1; target.focus({ preventScroll: true }); }
            highlightTimer = setTimeout(() => setPendingSearchResult(null), 1800);
        };
        // Some controls, such as Windows Hello, appear after native availability
        // checks. Wait for that control rather than losing the requested focus.
        const observer = new MutationObserver(tryFocus);
        const waitTimer = setTimeout(() => {
            toast.info('This setting is not available on this device.');
            setPendingSearchResult(null);
        }, 3000);
        if (contentRef.current) observer.observe(contentRef.current, { childList: true, subtree: true });
        tryFocus();
        return () => {
            observer.disconnect();
            clearTimeout(waitTimer);
            clearTimeout(highlightTimer);
            target?.classList.remove('ring-2', 'ring-primary/50');
        };
    }, [activeTab, pendingSearchResult]);

    const handleTabClick = (tabId: SettingsTab) => {
        if (tabId === activeTab) {
            if (isSearching) closeSearch();
            return;
        }
        requestNavigation(() => {
            closeSearch();
            setActiveTab(tabId);
            contentRef.current?.scrollTo({ top: 0 });
        });
    };

    const handleBackClick = () => {
        requestNavigation(() => {
            router.push('/inbox');
        });
    };

    return (
        <div className="settings-shell flex h-full w-full text-foreground overflow-hidden">
            <aside className="settings-sidebar w-56 lg:w-64 shrink-0 flex flex-col border-r border-white/40 dark:border-white/[0.08]">
                <div className="px-4 pt-6 pb-4">
                    <div className="mb-5 flex items-center justify-between gap-3">
                        <h1 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Settings</h1>
                        <button type="button" aria-label="Back to Inbox" onClick={handleBackClick} className="flex items-center gap-1.5 rounded-lg border border-black/[0.07] dark:border-white/[0.08] px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><ChevronLeft className="size-3.5" /><span className="settings-nav-label">Back</span></button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        <input ref={searchInputRef} type="search" value={searchQuery} maxLength={200}
                            onChange={event => { setSearchQuery(event.target.value); setSelectedSearchIndex(0); contentRef.current?.scrollTo({ top: 0 }); }}
                            onKeyDown={event => {
                                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchResults.length) {
                                    event.preventDefault();
                                    const next = (selectedSearchIndex + (event.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
                                    setSelectedSearchIndex(next);
                                    document.getElementById('settings-search-' + searchResults[next].id)?.scrollIntoView({ block: 'nearest' });
                                }
                                if (event.key === 'Enter' && searchResults[selectedSearchIndex]) { event.preventDefault(); focusSetting(searchResults[selectedSearchIndex]); }
                                if (event.key === 'Escape') closeSearch();
                            }}
                            placeholder="Find a setting…" aria-label="Find a setting…" role="combobox" aria-autocomplete="list" aria-expanded={isSearching} aria-controls={isSearching ? 'settings-search-results' : undefined} aria-activedescendant={isSearching && searchResults[selectedSearchIndex] ? 'settings-search-' + searchResults[selectedSearchIndex].id : undefined}
                            className="settings-input w-full py-3 pl-9 pr-8 text-xs shadow-sm [&::-webkit-search-cancel-button]:appearance-none" />
                        {searchQuery && <button type="button" aria-label="Clear settings search" onClick={() => { closeSearch(); searchInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"><X className="size-3.5" /></button>}
                    </div>
                </div>
                <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto space-y-1 px-3 pb-4 custom-scrollbar">
                    {visibleTabs.map(tab => {
                        const Icon = tab.icon;
                        const selected = !isSearching && activeTab === tab.id;
                        return <button key={tab.id} type="button" aria-label={tab.label} title={tab.label} aria-current={selected ? 'page' : undefined} onClick={() => handleTabClick(tab.id)} className={cn('settings-nav-item w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors', selected ? [tab.active, 'text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'] : 'text-muted-foreground hover:bg-black/[0.035] dark:hover:bg-white/[0.04] hover:text-foreground')}>
                            <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-lg', tab.color)}><Icon className="size-[17px]" strokeWidth={1.8} /></span>
                            <span className="settings-nav-label flex-1">{tab.label}</span>
                            {selected && <ChevronRight className="settings-nav-label size-3.5 opacity-40" />}
                            {(dirtySections[tab.id]?.isDirty || (tab.id === 'security' && dirtySections.privacy?.isDirty)) && <span aria-label="Unsaved changes" className="size-1.5 rounded-full bg-amber-500" />}
                        </button>;
                    })}
                </nav>
                <div className="mx-4 border-t border-black/[0.07] dark:border-white/[0.07] py-4 space-y-2">
                    <button type="button" onClick={handleBackClick} className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:text-foreground"><Inbox className="size-4" />Back to Inbox</button>
                    <button type="button" onClick={() => requestNavigation(() => { if (user) void logout(user.id); })} className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"><LogOut className="size-4" />Sign out</button>
                    <p className="px-2 pt-2 text-[10px] text-muted-foreground/70">OrionMail · {packageInfo.version}</p>
                </div>
            </aside>

            {/* Main Content Area */}
            <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto custom-scrollbar relative z-10 pb-28">
                {isSearching && <SettingsSearchResults query={searchQuery} results={searchResults} selectedIndex={selectedSearchIndex} onSelect={focusSetting} onHighlight={setSelectedSearchIndex} />}
                <div hidden={isSearching} className="max-w-[960px] mx-auto px-6 py-8 lg:px-12 lg:py-10">
                    <header className="mb-8">
                        <div className="mb-5 flex items-center gap-2 text-[11px] text-muted-foreground"><span>Settings</span><ChevronRight className="size-3" /><span>{activeSection.label}</span><span className="ml-auto hidden lg:inline">{hasUnsavedChanges ? "Changes waiting to be saved" : "Preferences on this device"}</span></div>
                        <div className="flex items-start gap-4"><span className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/30 dark:border-white/5", activeSection.color)}><ActiveIcon className="size-5" /></span><div><h1 className="text-[28px] leading-tight font-semibold tracking-tight">{activeSection.label}</h1><p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{activeSection.description}</p></div></div>
                    </header>
                    <fieldset key={activeTab} disabled={isSaving} className="settings-section-enter min-w-0">
                        {activeTab === 'account' && <AccountSection />}
                        {activeTab === 'appearance' && <AppearanceSection />}
                        {['compose', 'reading', 'notifications', 'smartactions', 'shortcuts'].includes(activeTab) && <PreferencesSection key={activeTab} section={activeTab} />}
                        {activeTab === 'security' && <SecuritySection />}
                        {(activeTab === 'sync' || activeTab === 'storage') && <MailDataSection key={activeTab} section={activeTab} />}
                        {activeTab === 'system' && <SystemSection />}
                        {activeTab === 'about' && <AboutSection />}
                    </fieldset>
                </div>
                
                <UnsavedChangesBar />
            </main>
        </div>
    );
}

export default function SettingsPage() {
    const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

    const handleInterceptNavigation = (cb: () => void) => {
        // Must wrap in a thunk so React doesn't execute cb as a state updater
        setPendingCallback(() => cb);
    };

    return (
        <SettingsProvider onInterceptNavigation={handleInterceptNavigation}>
            <SettingsPageInner />
            <ConfirmNavigationDialog
                pendingCallback={pendingCallback}
                onResolve={() => setPendingCallback(null)}
            />
        </SettingsProvider>
    );
}
