import React from 'react';
import { SmartAction, SmartActionCommand, SmartActionKind, TrustLevel } from '@/lib/smart-actions';
import { CheckCircle, ShieldAlert, Video, Truck, CreditCard, Plane, ShieldCheck, Key, Copy, ExternalLink, CalendarPlus, Shield, ReceiptText, PackageCheck, RefreshCcw, Repeat } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
    action: SmartAction;
}

export function SmartActionCard({ action }: Props) {
    const [copied, setCopied] = React.useState(false);
    const isCommerceAction = [
        SmartActionKind.PURCHASE,
        SmartActionKind.ORDER,
        SmartActionKind.INVOICE,
        SmartActionKind.REFUND,
        SmartActionKind.SUBSCRIPTION,
        SmartActionKind.TRANSACTION,
    ].includes(action.kind);

    const handleCommand = async (cmd: SmartActionCommand, data?: Record<string, unknown>) => {
        if (cmd === SmartActionCommand.CopyOtp) {
            navigator.clipboard.writeText(String(data?.code || ''));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else if (cmd === SmartActionCommand.JoinMeeting || cmd === SmartActionCommand.TrackPackage || cmd === SmartActionCommand.OpenLink || cmd === SmartActionCommand.ResetPassword || cmd === SmartActionCommand.VerifyAccount) {
            if (typeof data?.url === 'string') {
                invoke('open_url', { url: data.url }).catch(console.error);
            }
        } else if (cmd === SmartActionCommand.AddToCalendar) {
            const event = isRecord(data?.event) ? data.event : {};
            const title = encodeURIComponent(String(event.summary || data?.title || "Meeting"));
            
            let start = new Date();
            let end = new Date(start.getTime() + 60 * 60 * 1000); // default +1 hour
            
            if (typeof data?.date === 'string') {
                const parsed = new Date(data.date);
                if (!isNaN(parsed.getTime())) {
                    start = parsed;
                    end = new Date(start.getTime() + 60 * 60 * 1000);
                }
            }

            const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const dates = `${formatDate(start)}/${formatDate(end)}`;
            const details = encodeURIComponent(String(event.description || ""));
            const location = encodeURIComponent(String(event.location || ""));
            
            const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
            invoke('open_url', { url }).catch(console.error);
        }
        // Handle others as needed
    };

    const isRecord = (value: unknown): value is Record<string, unknown> => {
        return typeof value === 'object' && value !== null;
    };

    const getIcon = () => {
        switch (action.kind) {
            case SmartActionKind.OTP: return <Key className="w-5 h-5" />;
            case SmartActionKind.MEETING: return <Video className="w-5 h-5" />;
            case SmartActionKind.DELIVERY: return <Truck className="w-5 h-5" />;
            case SmartActionKind.PAYMENT: return <CreditCard className="w-5 h-5" />;
            case SmartActionKind.PURCHASE: return <ReceiptText className="w-5 h-5" />;
            case SmartActionKind.ORDER: return <PackageCheck className="w-5 h-5" />;
            case SmartActionKind.INVOICE: return <ReceiptText className="w-5 h-5" />;
            case SmartActionKind.REFUND: return <RefreshCcw className="w-5 h-5" />;
            case SmartActionKind.SUBSCRIPTION: return <Repeat className="w-5 h-5" />;
            case SmartActionKind.TRANSACTION: return <CreditCard className="w-5 h-5" />;
            case SmartActionKind.TRAVEL: return <Plane className="w-5 h-5" />;
            case SmartActionKind.SECURITY: return <ShieldAlert className="w-5 h-5" />;
            default: return <ExternalLink className="w-5 h-5" />;
        }
    };

    const getTrustBadge = () => {
        if (action.trustLevel === TrustLevel.Trusted) {
            return <div className="flex items-center justify-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full"><ShieldCheck className="w-3 h-3" /> Trusted</div>;
        } else if (action.trustLevel === TrustLevel.Verified) {
            return <div className="flex items-center justify-center gap-1 text-xs font-medium text-blue-600 bg-blue-500/10 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" /> Verified</div>;
        }
        return <div className="flex items-center justify-center gap-1 text-xs font-medium text-gray-500 bg-gray-500/10 px-2 py-0.5 rounded-full"><Shield className="w-3 h-3" /> Unverified</div>;
    };

    const commerceRows = getCommerceRows(action);
    const commerceItems = getCommerceItems(action);
    
    const isRightAlignedActions = action.kind === SmartActionKind.OTP || action.kind === SmartActionKind.MEETING;

    const renderButtons = () => {
        return action.actions.map((btn, i) => (
            <button
                key={i}
                onClick={() => handleCommand(btn.command, btn.data)}
                className={`relative text-sm font-medium px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm
                    ${btn.command === SmartActionCommand.AddToCalendar
                        ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'
                        : btn.primary 
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md' 
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-md'}`}
            >
                {btn.command === SmartActionCommand.CopyOtp && (copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />)}
                {btn.command === SmartActionCommand.JoinMeeting && <Video className="w-4 h-4" />}
                {btn.command === SmartActionCommand.AddToCalendar && <CalendarPlus className="w-4 h-4" />}
                {btn.command === SmartActionCommand.TrackPackage && <Truck className="w-4 h-4" />}
                {btn.command === SmartActionCommand.TrackOrder && <PackageCheck className="w-4 h-4" />}
                {(btn.command === SmartActionCommand.ViewReceipt || btn.command === SmartActionCommand.ViewInvoice) && <ReceiptText className="w-4 h-4" />}
                {btn.command === SmartActionCommand.ViewTransaction && <CreditCard className="w-4 h-4" />}
                {btn.command === SmartActionCommand.ManageSubscription && <Repeat className="w-4 h-4" />}
                {btn.label}
                
                {btn.command === SmartActionCommand.CopyOtp && copied && (
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-[#222222] dark:bg-white dark:text-black text-white text-xs px-3 py-1.5 rounded-md shadow-lg whitespace-nowrap pointer-events-none animate-in fade-in zoom-in duration-200">
                        Code Copied!
                    </div>
                )}
            </button>
        ));
    };

    return (
        <div className="mb-4 bg-white dark:bg-[#1A1A1A] border border-black/5 dark:border-white/10 rounded-2xl p-5 shadow-sm flex flex-col gap-5 transition-all hover:shadow-md">
            <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    {getIcon()}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                        <h4 className="font-semibold text-base truncate">{action.title}</h4>
                        {getTrustBadge()}
                    </div>
                    {action.subtitle && <p className="text-sm text-muted-foreground leading-relaxed">{action.subtitle}</p>}
                </div>
                
                {isRightAlignedActions && action.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2.5 shrink-0 ml-4 items-center self-center">
                        {renderButtons()}
                    </div>
                )}
            </div>

            {isCommerceAction && (commerceRows.length > 0 || commerceItems.length > 0) && (
                <div className="ml-16 grid gap-3">
                    {commerceRows.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            {commerceRows.map((row) => (
                                <div key={row.label} className="flex items-baseline justify-between gap-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
                                    <span className="text-muted-foreground">{row.label}</span>
                                    <span className="font-medium text-right">{row.value}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {commerceItems.length > 0 && (
                        <div className="rounded-lg border border-black/5 dark:border-white/10 overflow-hidden">
                            {commerceItems.map((item, index) => (
                                <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm border-t first:border-t-0 border-black/5 dark:border-white/10">
                                    <span className="font-medium">{item.name}</span>
                                    {item.quantity && <span className="text-muted-foreground">x{item.quantity}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            
            {!isRightAlignedActions && action.actions.length > 0 && (
                <div className="flex flex-wrap gap-2.5 shrink-0 ml-16">
                    {renderButtons()}
                </div>
            )}
        </div>
    );
}

function getCommerceRows(action: SmartAction): Array<{ label: string; value: string }> {
    const metadata = action.metadata || {};
    const rows = [
        ['Seller', stringValue(metadata.merchant)],
        ['Company', stringValue(metadata.company) || stringValue(metadata.provider)],
        ['Reference', stringValue(metadata.referenceLabel)],
        ['Total', stringValue(metadata.formattedAmount) || formatAmount(metadata.amount)],
        ['Status', stringValue(metadata.status)],
    ] as const;

    return rows
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => ({ label, value: value as string }));
}

function getCommerceItems(action: SmartAction): Array<{ name: string; quantity?: number }> {
    const items = action.metadata?.items;
    if (!Array.isArray(items)) return [];

    return items.flatMap((item) => {
        if (!isRecordValue(item) || typeof item.name !== 'string' || !item.name.trim()) return [];
        const quantity = typeof item.quantity === 'number' ? item.quantity : undefined;
        return [{ name: item.name.trim(), quantity }];
    });
}

function formatAmount(amount: unknown): string | undefined {
    if (!isRecordValue(amount) || typeof amount.value !== 'number' || typeof amount.currency !== 'string') return undefined;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: amount.currency,
            maximumFractionDigits: 2,
        }).format(amount.value);
    } catch {
        return `${amount.currency} ${amount.value}`;
    }
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
