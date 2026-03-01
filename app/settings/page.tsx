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
        <div className="flex h-full w-full bg-[#FAFAFA] text-slate-900">
            {/* Left Sidebar Navigation */}
            <aside className="w-64 flex flex-col border-r border-black/5 bg-white/40 backdrop-blur-3xl p-4">
                <div className="mb-8 px-2">
                    <Link href="/inbox" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
                        <ChevronLeft className="w-4 h-4" />
                        <span className="text-sm font-medium">Back to Mail</span>
                    </Link>
                    <h2 className="text-xl font-bold px-2">Settings</h2>
                </div>

                <nav className="space-y-1">
                    <div className="px-2 mb-2 text-xs font-bold text-muted-foreground/50 uppercase tracking-wider">Preferences</div>
                    {SETTINGS_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                                    isActive
                                        ? "bg-primary/10 text-primary shadow-sm"
                                        : "text-muted-foreground hover:bg-white/50 hover:text-foreground"
                                )}
                            >
                                <Icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} strokeWidth={2} />
                                {tab.label}
                            </button>
                        );
                    })}

                    <div className="my-4 h-px bg-black/5 mx-2" />

                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/50 hover:text-foreground transition-all duration-200">
                        <Info className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
                        About
                    </button>
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-500/10 transition-all duration-200">
                        <LogOut className="w-5 h-5" strokeWidth={2} />
                        Sign Out
                    </button>
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto custom-scrollbar">
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
