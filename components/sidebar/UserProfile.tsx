"use client";
import React, { memo, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronUp, LogOut, Settings, Plus } from 'lucide-react';
import { MAX_CONNECTED_ACCOUNTS, ACCOUNT_LIMIT_MESSAGE } from '@/lib/account-policy';
import { AccountList } from '@/components/accounts/AccountList';
import {SidebarHint} from './SidebarHint';
import Link from 'next/link';
import { useAuth } from '@/components/AuthContext';
import { mailInitials } from '@/lib/mail-display';
import { toast } from 'sonner';
export const UserProfile = memo(() => {
    const { user, accounts, accountBusy, loading, logout, addGoogleAccount } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        ref.current?.querySelector<HTMLElement>("[data-profile-popover] button[aria-current='true']")?.focus();
        const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, [open]);
    if (loading) return <div className="mx-3 my-2 h-12 animate-pulse rounded-xl bg-white/10" aria-label="Loading account" />;
    if (!user) return <Link href="/" className="mail-nav-item justify-center">Sign in</Link>;
    return <div ref={ref} className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        {open && <div data-profile-popover className="mail-profile-popover">
            <p className="px-3 pb-2 pt-1 text-[10px] font-medium text-muted-foreground">Accounts · {accounts?.length || 1} / {MAX_CONNECTED_ACCOUNTS}</p>
            <AccountList onSelected={() => setOpen(false)} />
            {(accounts?.length ?? 0) >= MAX_CONNECTED_ACCOUNTS && <p className="px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">{ACCOUNT_LIMIT_MESSAGE}</p>}
            <SidebarHint label="Add Google account" className="w-full"><button type="button" disabled={accountBusy || (accounts?.length ?? 0) >= MAX_CONNECTED_ACCOUNTS} className="mail-profile-action mt-2" onClick={() => { void addGoogleAccount().then(() => setOpen(false)).catch(error => toast.error('Could not add account', { description: String(error) })); }}><Plus className="size-4" />Add Google account</button></SidebarHint>
            <div className="my-2 border-t border-black/[0.06] dark:border-white/[0.08]" />
            <SidebarHint label="Settings" className="w-full"><Link href="/settings" onClick={() => setOpen(false)} className="mail-profile-action"><Settings className="size-4" />Settings</Link></SidebarHint>
            <SidebarHint label="Sign out of this account" className="w-full"><button type="button" disabled={accountBusy} className="mail-profile-action !text-red-500" onClick={() => { setOpen(false); void logout(user.id).catch(error => toast.error('Could not sign out', { description: String(error) })); }}><LogOut className="size-4" />Sign out of this account</button></SidebarHint>
        </div>}
        <SidebarHint label={`Accounts · ${user.email}`} className="w-full"><button ref={trigger} type="button" aria-expanded={open} aria-label={`Account: ${user.name || user.email}`} onClick={() => setOpen(value => !value)} className="mail-profile-trigger" title={user.email}>
            {user.picture ? <Image src={user.picture} alt="" width={32} height={32} unoptimized referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="mail-sender-avatar !size-8 !text-[10px]">{mailInitials(user.name || user.email)}</span>}
            <span className="mail-profile-copy min-w-0 flex-1 text-left"><span className="block truncate text-xs font-medium">{user.name || 'Your account'}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{user.email}</span></span><ChevronUp className="mail-profile-copy size-3.5 shrink-0 text-muted-foreground" />
        </button></SidebarHint>
    </div>;
});
UserProfile.displayName = 'UserProfile';
