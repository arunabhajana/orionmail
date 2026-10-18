"use client";
import React, { memo, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronUp, LogOut, Settings } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthContext';
import { mailInitials } from '@/lib/mail-display';
import { toast } from 'sonner';
export const UserProfile = memo(() => {
    const { user, loading, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) return;
        ref.current?.querySelector<HTMLAnchorElement>("[data-profile-popover] a")?.focus();
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
            <p className="truncate px-3 pb-2 pt-1 text-[10px] text-muted-foreground" title={user.email}>{user.email}</p>
            <Link href="/settings" onClick={() => setOpen(false)} className="mail-profile-action"><Settings className="size-4" />Settings</Link>
            <button type="button" className="mail-profile-action !text-red-500" onClick={() => { setOpen(false); void logout(user.id).catch(() => toast.error('Could not sign out.')); }}><LogOut className="size-4" />Sign out</button>
        </div>}
        <button ref={trigger} type="button" aria-expanded={open} aria-label={`Account: ${user.name || user.email}`} onClick={() => setOpen(value => !value)} className="mail-profile-trigger" title={user.email}>
            {user.picture ? <Image src={user.picture} alt="" width={32} height={32} unoptimized referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="mail-sender-avatar !size-8 !text-[10px]">{mailInitials(user.name || user.email)}</span>}
            <span className="mail-profile-copy min-w-0 flex-1 text-left"><span className="block truncate text-xs font-medium">{user.name || 'Your account'}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{user.email}</span></span><ChevronUp className="mail-profile-copy size-3.5 shrink-0 text-muted-foreground" />
        </button>
    </div>;
});
UserProfile.displayName = 'UserProfile';
