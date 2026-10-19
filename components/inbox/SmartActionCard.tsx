"use client";

import React from 'react';
import { Check, Copy, ExternalLink, CalendarPlus, KeyRound, Video, Truck, CreditCard, Plane, ShieldAlert, ReceiptText, PackageCheck, RefreshCcw, Repeat, Loader2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useAppPreferences } from '@/components/AppPreferencesContext';
import { SmartAction, SmartActionCommand, SmartActionKind } from '@/lib/smart-actions';
import { calendarUrl } from '@/lib/smart-actions/calendar';
import { meetingUrl, record, safeUrl, textValue, URL_COMMANDS } from '@/lib/smart-actions/safety';
import { cn } from '@/lib/utils';

const appearance = {
    OTP: [KeyRound, 'bg-violet-500/10 text-violet-500'], MEETING: [Video, 'bg-blue-500/10 text-blue-500'],
    DELIVERY: [Truck, 'bg-amber-500/10 text-amber-500'], PAYMENT: [CreditCard, 'bg-emerald-500/10 text-emerald-500'],
    PURCHASE: [ReceiptText, 'bg-emerald-500/10 text-emerald-500'], ORDER: [PackageCheck, 'bg-orange-500/10 text-orange-500'],
    INVOICE: [ReceiptText, 'bg-blue-500/10 text-blue-500'], REFUND: [RefreshCcw, 'bg-emerald-500/10 text-emerald-500'],
    SUBSCRIPTION: [Repeat, 'bg-purple-500/10 text-purple-500'], TRANSACTION: [CreditCard, 'bg-emerald-500/10 text-emerald-500'],
    TRAVEL: [Plane, 'bg-sky-500/10 text-sky-500'], SECURITY: [ShieldAlert, 'bg-amber-500/10 text-amber-500'],
} as const;

export const SmartActionCard = React.memo(function SmartActionCard({ action }: { action: SmartAction }) {
    const { preferences } = useAppPreferences();
    const [copied, setCopied] = React.useState(false);
    const [busy, setBusy] = React.useState<SmartActionCommand | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const alive = React.useRef(true);
    const copyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    React.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; if (copyTimer.current) clearTimeout(copyTimer.current); };
    }, []);
    const [Icon, tone] = appearance[action.kind] || [ExternalLink, 'bg-primary/10 text-primary'];
    const metadata = action.metadata || {};
    const otp = action.kind === SmartActionKind.OTP ? textValue(metadata.code, 16) : undefined;
    const amount = textValue(metadata.formattedAmount);
    const facts = actionFacts(action);
    const items = Array.isArray(metadata.items) ? metadata.items.filter(record).filter(item => textValue(item.name)).slice(0, 10) : [];
    const firstUrl = action.actions.map(button => safeUrl(button.data?.url)).find(Boolean);
    const run = async (command: SmartActionCommand, data?: Record<string, unknown>) => {
        if (busy) return;
        setBusy(command); setError(null);
        try {
            if (command === SmartActionCommand.CopyOtp) {
                if (typeof data?.code !== 'string' || !/^(?:G-)?[A-Za-z0-9]{4,8}$/.test(data.code)) throw new Error('Invalid code');
                await navigator.clipboard.writeText(data.code);
                if (!alive.current) return;
                setCopied(true);
                if (copyTimer.current) clearTimeout(copyTimer.current);
                copyTimer.current = setTimeout(() => { if (alive.current) setCopied(false); }, 2000);
            } else {
                const url = command === SmartActionCommand.AddToCalendar ? safeUrl(calendarUrl(data?.event))
                    : command === SmartActionCommand.JoinMeeting ? meetingUrl(data?.url)
                    : URL_COMMANDS.has(command) ? safeUrl(data?.url) : null;
                if (!url) throw new Error('Invalid action');
                if (preferences.confirmExternalLinks && !await confirm(`Open ${url.hostname} in your browser?`, {
                    title: 'Open external link', kind: 'info', okLabel: 'Open link', cancelLabel: 'Cancel',
                })) return;
                await invoke('open_url', { url: url.href });
            }
        } catch {
            if (alive.current) setError(command === SmartActionCommand.CopyOtp
                ? 'Could not copy. You can select the code and copy it manually.' : 'Could not open this link. Please try again.');
        } finally { if (alive.current) setBusy(null); }
    };

    return <article aria-label={action.title} className="overflow-hidden rounded-xl border border-black/[0.07] bg-white/55 p-3.5 dark:border-white/[0.08] dark:bg-white/[0.035]">
        <div className="flex items-start gap-3">
            <span aria-hidden="true" className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tone)}><Icon className="size-4" /></span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="min-w-0 break-words text-[13px] font-semibold leading-5">{action.title}</h3>
                    {amount && <span className="shrink-0 text-base font-semibold tabular-nums tracking-tight">{amount}</span>}
                </div>
                {action.subtitle && <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{action.subtitle}</p>}
                {otp && <p aria-label={`Verification code ${otp}`} className="mt-2.5 select-text break-all font-mono text-[26px] font-semibold leading-none tracking-[0.12em] text-foreground">{otp}</p>}
            </div>
        </div>
        {facts.length > 0 && <dl className="mt-3 grid gap-1.5 border-t border-black/[0.05] pt-3 text-xs dark:border-white/[0.06]">
            {facts.map(({ label, value }) => <div key={label} className="flex min-w-0 justify-between gap-4"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{value}</dd></div>)}
        </dl>}
        {items.length > 0 && <details className="mt-3 text-xs"><summary className="w-fit cursor-pointer rounded py-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Items ({items.length})</summary>
            <ul className="mt-1 space-y-1.5 border-l border-black/[0.08] pl-3 dark:border-white/[0.08]">{items.map((item, index) => <li key={index} className="flex gap-3"><span className="min-w-0 flex-1 break-words">{textValue(item.name)}</span>{typeof item.quantity === 'number' && item.quantity > 0 && <span className="text-muted-foreground">×{item.quantity}</span>}</li>)}</ul>
        </details>}
        {action.actions.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
            {action.actions.map((button, index) => {
                const ButtonIcon = button.command === SmartActionCommand.CopyOtp ? copied ? Check : Copy : button.command === SmartActionCommand.AddToCalendar ? CalendarPlus : ExternalLink;
                return <button type="button" key={`${button.command}:${index}`} disabled={busy !== null} onClick={() => { void run(button.command, button.data); }}
                    className={cn('inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60',
                        button.primary ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-black/[0.045] text-foreground hover:bg-black/[0.075] dark:bg-white/[0.07] dark:hover:bg-white/[0.11]')}>
                    {busy === button.command ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <ButtonIcon aria-hidden="true" className="size-3.5" />}
                    {button.command === SmartActionCommand.CopyOtp && copied ? 'Copied' : button.label}
                </button>;
            })}
            {firstUrl && <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={firstUrl.hostname}>{firstUrl.hostname}</span>}
        </div>}
        <span role="status" className="sr-only">{copied ? 'Code copied to clipboard' : ''}</span>
        {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-500">{error}</p>}
    </article>;
});

function actionFacts(action: SmartAction): Array<{ label: string; value: string }> {
    const metadata = action.metadata || {};
    const facts: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => { const text = textValue(value, 500); if (text) facts.push({ label, value: text }); };
    if (record(metadata.event)) {
        const event = metadata.event;
        if (typeof event.start === 'string') {
            try {
                const allDay = event.allDay === true;
                const date = new Date(allDay ? `${event.start}T00:00:00Z` : event.start);
                const options: Intl.DateTimeFormatOptions = allDay ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' };
                const formatter = new Intl.DateTimeFormat(undefined, options);
                const end = typeof event.end === 'string' ? new Date(allDay ? `${event.end}T00:00:00Z` : event.end) : undefined;
                if (end && allDay) end.setUTCDate(end.getUTCDate() - 1);
                add(allDay ? 'Date' : 'When', end && Number.isFinite(end.getTime()) && end > date ? formatter.formatRange(date, end) : formatter.format(date));
                if (!allDay) add('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone);
            } catch { /* Invalid dates stay in the original invitation. */ }
        }
        add('Location', event.location);
    } else {
        add('Reference', metadata.referenceLabel);
        add('Status', metadata.status);
        if (Array.isArray(metadata.facts)) for (const fact of metadata.facts.slice(0, 6)) {
            if (record(fact) && typeof fact.label === 'string') add(fact.label, fact.value);
        }
    }
    return facts;
}
