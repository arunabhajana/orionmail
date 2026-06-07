import React from 'react';
import { SmartAction, SmartActionCommand, SmartActionKind, TrustLevel } from '@/lib/smart-actions';
import { CheckCircle, ShieldAlert, Video, Truck, CreditCard, Plane, ShieldCheck, Key, Copy, ExternalLink, CalendarPlus, Shield } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
    action: SmartAction;
}

export function SmartActionCard({ action }: Props) {
    const [copied, setCopied] = React.useState(false);

    const handleCommand = async (cmd: SmartActionCommand, data: any) => {
        if (cmd === SmartActionCommand.CopyOtp) {
            navigator.clipboard.writeText(data.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } else if (cmd === SmartActionCommand.JoinMeeting || cmd === SmartActionCommand.TrackPackage || cmd === SmartActionCommand.OpenLink || cmd === SmartActionCommand.ResetPassword || cmd === SmartActionCommand.VerifyAccount) {
            if (data.url) {
                invoke('open_url', { url: data.url }).catch(console.error);
            }
        } else if (cmd === SmartActionCommand.AddToCalendar) {
            const title = encodeURIComponent(data.event?.summary || data.title || "Meeting");
            
            let start = new Date();
            let end = new Date(start.getTime() + 60 * 60 * 1000); // default +1 hour
            
            if (data.date) {
                const parsed = new Date(data.date);
                if (!isNaN(parsed.getTime())) {
                    start = parsed;
                    end = new Date(start.getTime() + 60 * 60 * 1000);
                }
            }

            const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const dates = `${formatDate(start)}/${formatDate(end)}`;
            let details = encodeURIComponent(data.event?.description || "");
            let location = encodeURIComponent(data.event?.location || "");
            
            const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}`;
            invoke('open_url', { url }).catch(console.error);
        }
        // Handle others as needed
    };

    const getIcon = () => {
        switch (action.kind) {
            case SmartActionKind.OTP: return <Key className="w-5 h-5" />;
            case SmartActionKind.MEETING: return <Video className="w-5 h-5" />;
            case SmartActionKind.DELIVERY: return <Truck className="w-5 h-5" />;
            case SmartActionKind.PAYMENT: return <CreditCard className="w-5 h-5" />;
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

    return (
        <div className="mb-4 bg-white dark:bg-[#1A1A1A] border border-black/5 dark:border-white/10 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-5 transition-all hover:shadow-md">
            <div className="flex items-center gap-4 flex-1 min-w-0">
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
            </div>
            
            <div className="flex flex-wrap gap-2.5 shrink-0 ml-16 sm:ml-0">
                {action.actions.map((btn, i) => (
                    <button
                        key={i}
                        onClick={() => handleCommand(btn.command, btn.data)}
                        className={`relative text-sm font-medium px-4 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm
                            ${btn.primary ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-md'}`}
                    >
                        {btn.command === SmartActionCommand.CopyOtp && (copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />)}
                        {btn.command === SmartActionCommand.JoinMeeting && <Video className="w-4 h-4" />}
                        {btn.command === SmartActionCommand.AddToCalendar && <CalendarPlus className="w-4 h-4" />}
                        {btn.command === SmartActionCommand.TrackPackage && <Truck className="w-4 h-4" />}
                        {btn.label}
                        
                        {btn.command === SmartActionCommand.CopyOtp && copied && (
                            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-[#222222] dark:bg-white dark:text-black text-white text-xs px-3 py-1.5 rounded-md shadow-lg whitespace-nowrap pointer-events-none animate-in fade-in zoom-in duration-200">
                                Code Copied!
                            </div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
