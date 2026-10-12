"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthContext';
import { useSettings } from './SettingsContext';

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
    const { user, updateDisplayName } = useAuth();
    const { registerSection, unregisterSection, markDirty } = useSettings();
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
    }, [alias, isDirty, savedAlias, registerSection, unregisterSection, updateDisplayName]);

    useEffect(() => {
        markDirty('account', isDirty);
    }, [isDirty, markDirty]);

    const initials = (normalizedAlias || user?.email || 'U').split(/[\s@.]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div className="p-8 rounded-3xl bg-secondary/30 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-md">
                <div className="flex items-center gap-6">
                    {user?.picture ? (
                        <img src={user.picture} referrerPolicy="no-referrer" className="w-20 h-20 rounded-full object-cover border-4 border-white/20 shadow-xl shrink-0" alt="Account avatar" />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 border-4 border-white/20 dark:border-white/10 shadow-xl flex items-center justify-center shrink-0">
                            <span className="text-2xl font-bold text-white">{initials}</span>
                        </div>
                    )}
                    <div className="min-w-0">
                        <h2 className="text-2xl font-bold text-foreground mb-1 truncate">{normalizedAlias || 'Your alias'}</h2>
                        <p className="text-sm text-muted-foreground">Connected via {user?.provider?.type || 'Google'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                    <div className="space-y-2">
                        <label htmlFor="account-alias" className="text-sm font-semibold text-muted-foreground ml-1">Alias</label>
                        <input id="account-alias" type="text" value={alias} maxLength={50} onChange={event => setAlias(event.target.value)} placeholder="Choose a display name" autoComplete="nickname" className="w-full px-4 py-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground placeholder:text-muted-foreground/50" />
                        <p className="text-xs text-muted-foreground px-1">This name appears in your OrionMail profile.</p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="account-email" className="text-sm font-semibold text-muted-foreground ml-1">Email Address</label>
                        <input id="account-email" type="email" value={user?.email ?? ''} readOnly className="w-full px-4 py-3 rounded-xl bg-white/10 dark:bg-black/40 border border-white/10 dark:border-white/5 outline-none opacity-70 cursor-not-allowed select-none text-foreground" />
                    </div>
                </div>
                {isDirty && <p role="status" className="mt-5 text-sm text-primary">Alias changes are ready to save.</p>}
                {isSaving && <p role="status" className="sr-only">Saving alias…</p>}
            </div>
        </motion.div>
    );
};
AccountSection.displayName = "AccountSection";
