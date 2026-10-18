"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, ChevronLeft, Search, X, ShieldCheck, Zap, Inbox, Rocket, Code2, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { SETTINGS_TABS, SettingsTab, SettingsSearchResult, searchSettings } from '@/components/settings/settingsSearch';
import { SettingsSearchResults } from '@/components/settings/SettingsSearchResults';

// Modular Components
import { AccountSection, SectionHeader } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { SystemSection } from '@/components/settings/SystemSection';
import { DeveloperSection } from '@/components/settings/DeveloperSection';
import { SmartActionsSection } from '@/components/settings/SmartActionsSection';
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
    const { dirtySections, requestNavigation } = useSettings();
    const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery]);
    const isSearching = Boolean(searchQuery.trim());
    const visibleTabs = isSearching ? SETTINGS_TABS.filter(tab => searchResults.some(result => result.section === tab.id)) : SETTINGS_TABS;

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
            const focusable = target.matches('button, input, select') ? target : target.querySelector<HTMLElement>('button, input, select');
            focusable?.focus({ preventScroll: true });
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
        <div className="flex h-full w-full bg-[#FAFAFA] dark:bg-black text-slate-900 dark:text-white transition-colors duration-200">
            <aside className="w-60 lg:w-64 shrink-0 flex flex-col border-r border-black/[0.07] dark:border-white/[0.07] bg-[#f5f5f7] dark:bg-[#17181b]">
                <div className="px-4 pt-6 pb-4">
                    <div className="mb-5 flex items-center justify-between gap-3">
                        <h1 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Settings</h1>
                        <button type="button" onClick={handleBackClick} className="flex items-center gap-1.5 rounded-lg border border-black/[0.07] dark:border-white/[0.08] px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"><ChevronLeft className="size-3.5" />Back</button>
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
                            placeholder="Search settings and options" aria-label="Search settings and options" role="combobox" aria-autocomplete="list" aria-expanded={isSearching} aria-controls={isSearching ? 'settings-search-results' : undefined} aria-activedescendant={isSearching && searchResults[selectedSearchIndex] ? 'settings-search-' + searchResults[selectedSearchIndex].id : undefined}
                            className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-[#101114] py-3 pl-9 pr-8 text-xs text-foreground outline-none transition-shadow focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none" />
                        {searchQuery && <button type="button" aria-label="Clear settings search" onClick={() => { closeSearch(); searchInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"><X className="size-3.5" /></button>}
                    </div>
                </div>
                <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto space-y-1 px-3 pb-4 custom-scrollbar">
                    {visibleTabs.map(tab => {
                        const Icon = tab.icon;
                        const selected = !isSearching && activeTab === tab.id;
                        return <button key={tab.id} type="button" aria-current={selected ? 'page' : undefined} onClick={() => handleTabClick(tab.id)} className={cn('w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium transition-colors', selected ? [tab.active, 'text-foreground'] : 'text-muted-foreground hover:bg-black/[0.035] dark:hover:bg-white/[0.04] hover:text-foreground')}>
                            <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-lg', tab.color)}><Icon className="size-[17px]" strokeWidth={1.8} /></span>
                            <span className="flex-1">{tab.label}</span>
                            {dirtySections[tab.id]?.isDirty && <span aria-label="Unsaved changes" className="size-1.5 rounded-full bg-amber-500" />}
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
            <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto custom-scrollbar bg-white dark:bg-[#101114] relative z-10 pb-24">
                {isSearching && <SettingsSearchResults query={searchQuery} results={searchResults} selectedIndex={selectedSearchIndex} onSelect={focusSetting} onHighlight={setSelectedSearchIndex} />}
                <div hidden={isSearching} className="max-w-4xl mx-auto px-6 py-8 md:p-12">
                    <div>
                        {activeTab === 'account' && (
                            <motion.div key="account" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Account"
                                    description="Manage your profile and security settings."
                                />
                                <AccountSection />
                            </motion.div>
                        )}

                        {activeTab === 'appearance' && (
                            <motion.div key="appearance" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Appearance"
                                    description="Customize the look and feel of your interface."
                                />
                                <AppearanceSection />
                            </motion.div>
                        )}

                        {activeTab === 'notifications' && (
                            <motion.div key="notifications" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Notifications"
                                    description="Manage how and when OrionMail alerts you."
                                />
                                <NotificationsSection />
                            </motion.div>
                        )}

                        {activeTab === 'smartactions' && (
                            <motion.div key="smartactions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Smart Actions"
                                    description="Automate and extract actionable data from your emails."
                                />
                                <SmartActionsSection />
                            </motion.div>
                        )}

                        {activeTab === 'security' && (
                            <motion.div key="security" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Privacy & Security"
                                    description="Control your data, logins, and block unwanted senders."
                                />
                                <SecuritySection />
                            </motion.div>
                        )}

                        {activeTab === 'system' && (
                            <motion.div key="system" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="System & Behavior"
                                    description="Manage startup behavior, system tray, and performance options."
                                />
                                <SystemSection />
                            </motion.div>
                        )}

                        {activeTab === 'developer' && (
                            <motion.div key="developer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Developer Settings"
                                    description="Advanced configuration and testing tools."
                                />
                                <DeveloperSection />
                            </motion.div>
                        )}

                        {activeTab === 'about' && (
                            <motion.div key="about" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                                <SectionHeader title="About OrionMail" description="A focused desktop home for your email, built to feel fast, thoughtful, and at home on Windows." />
                                <div className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-white to-violet-500/10 dark:from-primary/20 dark:via-[#16151b] dark:to-violet-900/20 p-8 md:p-10">
                                    <div className="absolute -right-10 -top-16 size-56 rounded-full bg-primary/10 blur-3xl" />
                                    <div className="relative flex flex-col md:flex-row md:items-center gap-6">
                                        <Image src="/logo.svg" alt="OrionMail logo" width={80} height={80} unoptimized className="size-20 shrink-0 object-contain drop-shadow-lg" />
                                        <div className="flex-1"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Your email, in focus</p><h2 className="mt-2 text-3xl font-bold tracking-tight">OrionMail</h2><p className="mt-2 max-w-xl text-muted-foreground">A native-feeling mail workspace that brings your inbox, smart actions, and desktop workflow together.</p></div>
                                        <div data-setting-id="about.version" className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-black/20 px-5 py-4 min-w-36"><p className="text-xs uppercase tracking-wider text-muted-foreground">Version</p><p className="mt-1 text-xl font-semibold">{packageInfo.version}</p><p className="text-xs text-muted-foreground">Desktop release</p></div>
                                    </div>
                                </div>
                                <div className="grid sm:grid-cols-2 gap-4">
                                    {[
                                        { icon: Inbox, title: 'A calmer inbox', detail: 'Browse, search, and organize your mail with folders, tags, and a focused reading flow.' },
                                        { icon: Zap, title: 'Useful at a glance', detail: 'Surface codes, meeting details, order updates, and travel information as smart actions.' },
                                        { icon: ShieldCheck, title: 'Desktop-minded privacy', detail: 'Account and app-lock controls live alongside your everyday workflow.' },
                                        { icon: Rocket, title: 'Built for Windows', detail: 'Work with system notifications, startup behavior, and the system tray.' },
                                    ].map(feature => { const FeatureIcon = feature.icon; return <div key={feature.title} className="rounded-2xl border border-black/5 dark:border-white/10 bg-secondary/25 dark:bg-white/[0.03] p-5"><div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><FeatureIcon className="size-5" /></div><h3 className="font-semibold">{feature.title}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feature.detail}</p></div>; })}
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-black/5 dark:border-white/10 px-6 py-5"><div className="flex items-center gap-3"><div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Code2 className="size-5" /></div><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Designed and developed by</p><p className="font-semibold">Arunabhajana</p></div></div><p className="flex items-center gap-2 text-sm text-muted-foreground"><Heart className="size-4 text-rose-500" /> Made with care</p></div>
                            </motion.div>
                        )}
                    </div>
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
