"use client";

import React, { useEffect, useState } from 'react';
import Image from "next/image";
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthContext';
import { useSettings } from './SettingsContext';
import { invoke } from '@tauri-apps/api/core';
import { ExternalLink, RefreshCw, LogOut } from 'lucide-react';
import { SettingGroup, SettingRow, settingButton } from './SettingsControls';

export const SectionHeader = ({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) => (
    <div className="flex items-start justify-between mb-8">
        <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
        </div>
        {action}
    </div>
);
SectionHeader.displayName = "SectionHeader";

export const AccountSection = () => {
    const { user, updateDisplayName, loginWithGoogle, mailboxConnected, logout } = useAuth();
    const [reconnecting, setReconnecting] = useState(false);
    const { registerSection, unregisterSection, markDirty, requestNavigation } = useSettings();
    const [alias, setAlias] = useState(user?.name ?? '');
    const [savedAlias, setSavedAlias] = useState(user?.name ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const normalizedAlias = alias.trim();
    const isDirty = normalizedAlias !== savedAlias;

    useEffect(() => {
        const currentName = user?.name ?? '';
        setAlias(currentName);
        setSavedAlias(currentName);
    }, [user?.id, user?.name]);

    useEffect(() => {
        registerSection({
            id: 'account',
            isDirty,
            save: async () => {
                if (!normalizedAlias) throw new Error('Alias cannot be empty.');
                if (normalizedAlias.length > 50) throw new Error('Alias must be 50 characters or fewer.');
                setIsSaving(true);
                try {
                    await updateDisplayName(normalizedAlias);
                    setAlias(normalizedAlias);
                    setSavedAlias(normalizedAlias);
                    toast.success('Alias updated.');
                } catch (error) {
                    toast.error(typeof error === 'string' ? error : 'Could not update alias.');
                    throw error;
                } finally {
                    setIsSaving(false);
                }
            },
            reset: () => setAlias(savedAlias),
        });
        return () => unregisterSection('account');
    }, [normalizedAlias, isDirty, savedAlias, registerSection, unregisterSection, updateDisplayName]);

    useEffect(() => {
        markDirty('account', isDirty);
    }, [isDirty, markDirty]);

    const initials = (normalizedAlias || user?.email || 'U').split(/[\s@.]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="settings-group p-6">
                <div className="flex items-center gap-6">
                    {user?.picture ? (
                        <Image unoptimized width={56} height={56} src={user.picture} referrerPolicy="no-referrer" className="w-14 h-14 rounded-full object-cover border-4 border-white/20 shadow-xl shrink-0" alt="Account avatar" />
                    ) : (
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary/60 border-4 border-white/20 dark:border-white/10 shadow-xl flex items-center justify-center shrink-0">
                            <span className="text-xl font-semibold text-white">{initials}</span>
                        </div>
                    )}
                    <div className="min-w-0">
                        <h2 className="text-xl font-semibold text-foreground mb-1 truncate">{normalizedAlias || 'Your alias'}</h2>
                        <p className="text-sm text-muted-foreground">Connected via {user?.provider?.type || 'Google'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                    <div data-setting-id="account.alias" className="space-y-2 rounded-xl">
                        <label htmlFor="account-alias" className="text-sm font-semibold text-muted-foreground ml-1">Alias</label>
                        <input id="account-alias" type="text" value={alias} maxLength={50} onChange={event => setAlias(event.target.value)} placeholder="Choose a display name" autoComplete="nickname" className="settings-input w-full" />
                        <p className="text-xs text-muted-foreground px-1">This name appears in your OrionMail profile.</p>
                    </div>
                    <div data-setting-id="account.email" className="space-y-2 rounded-xl">
                        <label htmlFor="account-email" className="text-sm font-semibold text-muted-foreground ml-1">Email Address</label>
                        <input id="account-email" type="email" value={user?.email ?? ''} readOnly className="w-full px-4 py-3 rounded-xl bg-white/10 dark:bg-black/40 border border-white/10 dark:border-white/5 outline-none opacity-70 cursor-not-allowed select-none text-foreground" />
                    </div>
                </div>
                {isDirty && <p role="status" className="mt-5 text-sm text-primary">Alias changes are ready to save.</p>}
                {isSaving && <p role="status" className="sr-only">Saving alias…</p>}
            </div>
            <SettingGroup title="Google account">
                <SettingRow id="account.connection" title="Mailbox connection" description={mailboxConnected ? "Your Google mailbox is connected." : "Reconnect if your session has expired or mail cannot connect."}><span className="text-xs text-muted-foreground">{mailboxConnected ? "Connected" : "Check connection"}</span></SettingRow>
                <SettingRow id="account.reconnect" title="Reconnect Google" description="Sign in through Google again to renew access."><button className={settingButton} disabled={reconnecting} onClick={() => requestNavigation(() => { setReconnecting(true); void loginWithGoogle().catch(() => toast.error("Could not reconnect Google.")).finally(() => setReconnecting(false)); })}><RefreshCw className={`size-3.5 ${reconnecting ? "animate-spin" : ""}`} />{reconnecting ? "Connecting…" : "Reconnect"}</button></SettingRow>
                <SettingRow id="account.google" title="Google security" description="Manage your password, two-step verification, and connected apps at Google."><button className={settingButton} onClick={() => invoke("open_url", { url: "https://myaccount.google.com/security" }).catch(() => toast.error("Could not open Google security."))}>Open Google<ExternalLink className="size-3.5" /></button></SettingRow>
                <SettingRow id="account.signout" title="Sign out" description="Disconnect this account from OrionMail on this device."><button className={`${settingButton} text-red-600 dark:text-red-400`} onClick={() => requestNavigation(() => { if (user) void logout(user.id).catch(() => toast.error("Could not sign out.")); })}><LogOut className="size-3.5" />Sign out</button></SettingRow>
            </SettingGroup>
        </motion.div>
    );
};
AccountSection.displayName = "AccountSection";
