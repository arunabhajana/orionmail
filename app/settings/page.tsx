"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    User,
    Palette,
    Bell,
    Shield,
    Info,
    LogOut,
    ChevronLeft,
    MonitorSmartphone,
    Terminal,
    Sparkles,
    Search, X, Mail, ShieldCheck, Zap, Inbox, Rocket, Code2, Heart
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';

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

// --- Types ---

type SettingsTab = 'account' | 'appearance' | 'notifications' | 'smartactions' | 'security' | 'system' | 'developer' | 'about';

interface SettingsTabConfig {
    id: SettingsTab;
    label: string;
    icon: React.ElementType;
}

interface SettingsSearchResult {
    id: string;
    title: string;
    section: SettingsTab;
    keywords: string;
}

const SETTINGS_TABS: SettingsTabConfig[] = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'smartactions', label: 'Smart Actions', icon: Sparkles },
    { id: 'security', label: 'Privacy & Security', icon: Shield },
    { id: 'system', label: 'System & Behavior', icon: MonitorSmartphone },
    { id: 'developer', label: 'Developer', icon: Terminal },
    { id: 'about', label: 'About', icon: Info },
];

const SETTINGS_SEARCH_INDEX: SettingsSearchResult[] = [
    { id: 'account.alias', title: 'Alias', section: 'account', keywords: 'display name profile name nickname' },
    { id: 'account.email', title: 'Email address', section: 'account', keywords: 'connected account mailbox' },
    { id: 'appearance.light', title: 'Light mode', section: 'appearance', keywords: 'theme brightness white' },
    { id: 'appearance.dark', title: 'Dark mode', section: 'appearance', keywords: 'theme night black' },
    { id: 'appearance.system', title: 'Use system theme', section: 'appearance', keywords: 'theme automatic windows' },
    { id: 'appearance.density', title: 'Message density', section: 'appearance', keywords: 'compact default relaxed spacing' },
    { id: 'appearance.accent', title: 'Accent color', section: 'appearance', keywords: 'blue purple rose emerald orange color' },
    { id: 'notifications.desktop', title: 'Desktop notifications', section: 'notifications', keywords: 'new email alerts push notification' },
    { id: 'notifications.sound-toggle', title: 'Play notification sound', section: 'notifications', keywords: 'audio ping alert' },
    { id: 'notifications.sound', title: 'Notification sound', section: 'notifications', keywords: 'tone chime bell orbit' },
    { id: 'notifications.unread', title: 'Show unread count', section: 'notifications', keywords: 'badge sidebar taskbar count' },
    { id: 'smartactions.global', title: 'Smart Actions', section: 'smartactions', keywords: 'automatically extract email information' },
    { id: 'smartactions.otp', title: 'Authentication codes (OTP)', section: 'smartactions', keywords: '2fa one-time password login code' },
    { id: 'smartactions.meetings', title: 'Meetings & events', section: 'smartactions', keywords: 'calendar join links invites' },
    { id: 'smartactions.commerce', title: 'Commerce & tracking', section: 'smartactions', keywords: 'orders receipts packages shipping' },
    { id: 'smartactions.travel', title: 'Travel & bookings', section: 'smartactions', keywords: 'flight hotel itinerary' },
    { id: 'security.2fa', title: 'Two-factor authentication', section: 'security', keywords: '2fa account login' },
    { id: 'security.app-lock', title: 'Windows Hello app lock', section: 'security', keywords: 'require password biometric launch unlock pin' },
    { id: 'security.images', title: 'Block external images', section: 'security', keywords: 'privacy tracking pixels remote images' },
    { id: 'security.blocklist', title: 'Blocked senders', section: 'security', keywords: 'blocklist spam addresses' },
    { id: 'security.cache', title: 'Clear local cache', section: 'security', keywords: 'delete downloaded mail storage data' },
    { id: 'system.autostart', title: 'Launch at startup', section: 'system', keywords: 'start windows login boot automatically' },
    { id: 'system.hidden', title: 'Start hidden', section: 'system', keywords: 'startup tray minimized' },
    { id: 'system.tray', title: 'Minimize to tray', section: 'system', keywords: 'close window background behavior' },
    { id: 'system.cache', title: 'Clear local cache', section: 'system', keywords: 'delete downloaded emails storage resync' },
    { id: 'developer.tools', title: 'Developer tools', section: 'developer', keywords: 'debug experimental diagnostics simulate errors' },
    { id: 'about.version', title: 'App version', section: 'about', keywords: 'release build about OrionMail' },
];

// --- Main Page Component ---

function SettingsPageInner() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
    const [pendingSearchResult, setPendingSearchResult] = useState<SettingsSearchResult | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchPanelRef = useRef<HTMLDivElement>(null);
    const { user, logout } = useAuth();
    const router = useRouter();
    const { dirtySections, requestNavigation } = useSettings();
    const searchResults = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return [];
        const words = query.split(/\s+/);
        return SETTINGS_SEARCH_INDEX.map(result => {
            const haystack = `${result.title} ${result.keywords} ${SETTINGS_TABS.find(tab => tab.id === result.section)?.label ?? ''}`.toLowerCase();
            const score = words.reduce((total, word) => {
                if (result.title.toLowerCase() === word) return total + 10;
                if (result.title.toLowerCase().startsWith(word)) return total + 6;
                if (result.title.toLowerCase().includes(word)) return total + 4;
                if (haystack.includes(word)) return total + 1;
                return total;
            }, 0);
            return { ...result, score, matches: words.every(word => haystack.includes(word)) };
        }).filter(result => result.matches)
            .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
            .slice(0, 8);
    }, [searchQuery]);

    const closeSearch = () => {
        setSearchOpen(false);
        setSearchQuery('');
        setSelectedSearchIndex(0);
        setPendingSearchResult(null);
    };

    const focusSetting = (result: SettingsSearchResult) => {
        closeSearch();
        requestNavigation(() => {
            setActiveTab(result.section);
            setPendingSearchResult(result);
        });
    };

    useEffect(() => {
        setSelectedSearchIndex(0);
    }, [searchQuery]);

    useEffect(() => {
        if (!searchOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!searchPanelRef.current?.contains(event.target as Node) && !searchInputRef.current?.contains(event.target as Node)) closeSearch();
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [searchOpen]);

    useEffect(() => {
        if (!pendingSearchResult || pendingSearchResult.section !== activeTab) return;
        const frame = window.requestAnimationFrame(() => {
            const target = document.querySelector<HTMLElement>(`[data-setting-id="${pendingSearchResult.id}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('ring-2', 'ring-primary/50', 'rounded-xl');
                const focusable = target.matches('button, input, select') ? target : target.querySelector<HTMLElement>('button, input, select');
                focusable?.focus({ preventScroll: true });
                window.setTimeout(() => target.classList.remove('ring-2', 'ring-primary/50', 'rounded-xl'), 1800);
            }
            setPendingSearchResult(null);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeTab, pendingSearchResult]);

    const handleTabClick = (tabId: SettingsTab) => {
        if (tabId === activeTab) return;
        requestNavigation(() => {
            setActiveTab(tabId);
        });
    };

    const handleBackClick = () => {
        requestNavigation(() => {
            router.push('/inbox');
        });
    };

    return (
        <div className="flex h-full w-full bg-[#FAFAFA] dark:bg-black text-slate-900 dark:text-white transition-colors duration-200">
            {/* Left Sidebar Navigation */}
            <aside className="w-64 flex flex-col border-r border-white/20 dark:border-white/5 bg-white/40 dark:bg-[#1C1C21]/70 backdrop-blur-2xl transition-colors relative overflow-hidden">
                {/* Dark Mode Purple Mesh Overlay */}
                <div className="absolute inset-0 z-0 hidden dark:block pointer-events-none opacity-40">
                    <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[50%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/40 via-violet-900/10 to-transparent blur-3xl rounded-full mix-blend-screen" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[100%] h-[50%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-fuchsia-900/30 via-purple-900/10 to-transparent blur-3xl rounded-full mix-blend-screen" />
                </div>
                {/* Content Wrapper */}
                <div className="relative z-10 flex flex-col h-full w-full p-4">
                    <div className="mb-6 px-2">
                        <button onClick={handleBackClick} className="flex items-center gap-2 text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 transition-colors mb-6 font-medium dark:font-normal">
                            <ChevronLeft className="w-4 h-4" />
                            <span className="text-sm">Back to Inbox</span>
                        </button>
                        <div className="flex items-center justify-between">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white/90">Settings</h1>
                            <button type="button" aria-label={searchOpen ? 'Close settings search' : 'Search settings'} onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); } }} className="p-2 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors">
                                {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {searchOpen && <div ref={searchPanelRef} className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <input ref={searchInputRef} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => {
                            if (event.key === 'ArrowDown' && searchResults.length) { event.preventDefault(); setSelectedSearchIndex(index => (index + 1) % searchResults.length); }
                            if (event.key === 'ArrowUp' && searchResults.length) { event.preventDefault(); setSelectedSearchIndex(index => (index - 1 + searchResults.length) % searchResults.length); }
                            if (event.key === 'Enter' && searchResults[selectedSearchIndex]) { event.preventDefault(); focusSetting(searchResults[selectedSearchIndex]); }
                            if (event.key === 'Escape') closeSearch();
                        }} placeholder="Search settings" aria-label="Search settings" aria-expanded={Boolean(searchQuery)} aria-controls="settings-search-results" aria-activedescendant={searchResults[selectedSearchIndex] ? `settings-search-${searchResults[selectedSearchIndex].id}` : undefined} role="combobox" aria-autocomplete="list" className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white/60 dark:bg-black/30 border border-black/5 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground" />
                        {searchQuery && <button type="button" aria-label="Clear search" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"><X className="size-4" /></button>}
                        {searchQuery && <div id="settings-search-results" role="listbox" className="absolute top-full left-0 right-0 z-30 mt-2 p-1.5 rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#222228] shadow-xl max-h-72 overflow-y-auto">
                            {searchResults.length ? searchResults.map((result, index) => { const ResultIcon = SETTINGS_TABS.find(tab => tab.id === result.section)!.icon; return <button id={`settings-search-${result.id}`} key={result.id} type="button" role="option" aria-selected={selectedSearchIndex === index} onMouseEnter={() => setSelectedSearchIndex(index)} onClick={() => focusSetting(result)} className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left rounded-lg transition-colors", selectedSearchIndex === index ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10")}><ResultIcon className="w-4 h-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{result.title}</span><span className="text-xs text-muted-foreground">{SETTINGS_TABS.find(tab => tab.id === result.section)?.label}</span></button>; }) : <p className="px-3 py-3 text-sm text-muted-foreground">No matching settings found.</p>}
                            <p className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground border-t border-black/5 dark:border-white/10 mt-1">↑↓ to navigate · Enter to open · Esc to close</p>
                        </div>}
                    </div>}

                    <nav className="flex-1 space-y-1">
                        {!searchOpen && SETTINGS_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            const isDirty = dirtySections[tab.id]?.isDirty;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabClick(tab.id)}
                                    className={cn(
                                        "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200",
                                        isActive
                                            ? "bg-white/60 dark:bg-white/10 text-foreground dark:text-white/90 font-medium shadow-sm ring-1 ring-black/5 dark:ring-white/5"
                                            : "text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 hover:bg-white/40 dark:hover:bg-white/5 font-medium"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} strokeWidth={2} />
                                        {tab.label}
                                    </div>
                                    {isDirty && (
                                        <span className="text-orange-500 font-bold px-2 text-lg leading-none">•</span>
                                    )}
                                </button>
                            );
                        })}

                        {!searchOpen && <div className="my-4 h-px bg-black/5 dark:bg-white/5 mx-2" />}

                        <button
                            onClick={() => {
                                if (user) logout(user.id);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-500/10 transition-all duration-200"
                        >
                            <LogOut className="w-5 h-5" strokeWidth={2} />
                            Sign Out
                        </button>
                    </nav>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto custom-scrollbar bg-white dark:bg-[#111111] relative z-10">
                <div className="max-w-4xl mx-auto p-12">
                    <AnimatePresence mode="wait">
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
                                    description="Manage how and when OrbitMail alerts you."
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
                                        <div className="size-16 rounded-2xl bg-primary text-white shadow-lg shadow-primary/25 flex items-center justify-center"><Mail className="size-8" /></div>
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
                    </AnimatePresence>
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
