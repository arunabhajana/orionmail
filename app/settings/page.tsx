"use client";

import React, { useState } from 'react';
import {
    User,
    Palette,
    Bell,
    Shield,
    Info,
    LogOut,
    ChevronLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';

// Modular Components
import { AccountSection, SectionHeader } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';

// --- Types ---

type SettingsTab = 'account' | 'appearance' | 'notifications' | 'security' | 'about';

interface SettingsTabConfig {
    id: SettingsTab;
    label: string;
    icon: React.ElementType;
}

const SETTINGS_TABS: SettingsTabConfig[] = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Privacy & Security', icon: Shield },
];

// --- Main Page Component ---

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');

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
                    <div className="mb-8 px-2">
                        <Link href="/inbox" className="flex items-center gap-2 text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 transition-colors mb-6 font-medium dark:font-normal">
                            <ChevronLeft className="w-4 h-4" />
                            <span className="text-sm">Back to Inbox</span>
                        </Link>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white/90">Settings</h1>
                    </div>

                    <nav className="flex-1 space-y-1">
                        {SETTINGS_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                                        isActive
                                            ? "bg-white/60 dark:bg-white/10 text-foreground dark:text-white/90 font-medium shadow-sm ring-1 ring-black/5 dark:ring-white/5"
                                            : "text-muted-foreground dark:text-white/60 hover:text-foreground dark:hover:text-white/90 hover:bg-white/40 dark:hover:bg-white/5 font-medium"
                                    )}
                                >
                                    <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} strokeWidth={2} />
                                    {tab.label}
                                </button>
                            );
                        })}

                        <div className="my-4 h-px bg-black/5 dark:bg-white/5 mx-2" />

                        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/50 dark:hover:bg-white/10 hover:text-foreground transition-all duration-200">
                            <Info className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
                            About
                        </button>
                        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-500/10 transition-all duration-200">
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
                                    action={
                                        <button className="px-6 py-2 bg-primary text-white font-semibold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all active:scale-95">
                                            Save Changes
                                        </button>
                                    }
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

                        {activeTab === 'security' && (
                            <motion.div key="security" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title="Privacy & Security"
                                    description="Control your data, logins, and block unwanted senders."
                                />
                                <SecuritySection />
                            </motion.div>
                        )}

                        {/* Placeholders for other tabs */}
                        {(!['account', 'appearance', 'notifications', 'security'].includes(activeTab)) && (
                            <motion.div key="placeholder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <SectionHeader
                                    title={SETTINGS_TABS.find(t => t.id === activeTab)?.label || 'Settings'}
                                    description="This section is under development."
                                />
                                <div className="p-12 text-center border-2 border-dashed border-black/5 rounded-3xl text-muted-foreground">
                                    Work in progress...
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main>
        </div>
    );
}
