"use client";
import {useAccountIdentities} from './AccountIdentityControls';
import {useAccountUnreadOverview} from '@/hooks/useAccountUnreadOverview';
import {SidebarHint} from '../sidebar/SidebarHint';
import Image from 'next/image';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthContext';
import { mailInitials } from '@/lib/mail-display';
import { toast } from 'sonner';

export function AccountList({ onSelected }: { onSelected?: () => void }) {
    const { user, accounts, accountBusy, switchAccount } = useAuth();
    const overview=useAccountUnreadOverview();
    const identities=useAccountIdentities();
    const profiles = accounts?.length ? accounts : user ? [user] : [];
    return <><p className="mb-2 px-3 text-[11px] text-muted-foreground" role="status">All accounts · {overview.total===null ? 'Unread count unavailable' : `${overview.total.toLocaleString()} unread`}</p><ul aria-label="Connected accounts" className="max-h-64 space-y-1 overflow-y-auto custom-scrollbar">
        {[...profiles].sort((a,b)=>(identities.accounts?.[a.id]?.rank??999)-(identities.accounts?.[b.id]?.rank??999)).map(account => <li key={account.id}>
            <SidebarHint label={`${account.name || account.email} · ${account.email}`} className="w-full"><button type="button" disabled={accountBusy} aria-current={user?.id === account.id ? 'true' : undefined}
                aria-label={`${account.name || account.email}, ${account.email}${user?.id === account.id ? ', active account' : ''}${account.needs_reauth ? ', reconnect required' : ''}`}
                onClick={() => { void switchAccount(account.id).then(onSelected).catch(error => toast.error('Could not switch accounts', { description: String(error) })); }}
                className={'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60 ' + (user?.id === account.id ? 'bg-primary/[0.08]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')}>
                <span className="relative size-[30px] shrink-0">
                {account.picture ? <Image src={account.picture} alt="" width={30} height={30} unoptimized referrerPolicy="no-referrer" className="size-[30px] shrink-0 rounded-full object-cover" /> : <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{mailInitials(account.name || account.email)}</span>}
                <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background" style={{backgroundColor:identities.accounts?.[account.id]?.color||'#3b82f6'}}/>
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{account.name || account.email}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{account.email}</span>{account.needs_reauth && <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">Reconnect required</span>}</span>
                <span className="shrink-0 rounded-md bg-foreground/5 px-2 py-1 text-[10px] tabular-nums text-muted-foreground" aria-label={`${overview.counts[account.id] ?? 'Unknown'} unread`}>{overview.counts[account.id]===undefined?'—':overview.counts[account.id]>999?'999+':overview.counts[account.id]}</span>
                {user?.id === account.id && accountBusy && <LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />}
            </button></SidebarHint>
        </li>)}
    </ul></>;
}
