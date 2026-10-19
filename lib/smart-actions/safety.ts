import { SmartActionCommand } from './types';

export const URL_COMMANDS = new Set<SmartActionCommand>([
    SmartActionCommand.JoinMeeting, SmartActionCommand.TrackPackage, SmartActionCommand.TrackOrder,
    SmartActionCommand.ViewReceipt, SmartActionCommand.ViewInvoice, SmartActionCommand.ViewTransaction,
    SmartActionCommand.ManageSubscription, SmartActionCommand.OpenReservation, SmartActionCommand.OpenLink,
    SmartActionCommand.VerifyAccount, SmartActionCommand.ResetPassword,
]);

export function safeUrl(raw: unknown): URL | null {
    if (typeof raw !== 'string' || raw.length > 8192 || raw.trim() !== raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url : null;
    } catch { return null; }
}

export function domainMatches(host: string, domain: string): boolean {
    return host === domain || host.endsWith(`.${domain}`);
}

export function meetingUrl(raw: unknown): URL | null {
    const url = safeUrl(raw);
    if (!url || url.port && url.port !== '443') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'meet.google.com' && /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[a-z0-9_-]{3,200})(?:\/|$)/i.test(url.pathname)) return url;
    if (domainMatches(host, 'zoom.us') && /^\/(?:j|s|w|my|wc\/join)\//.test(url.pathname)) return url;
    if (['teams.microsoft.com', 'teams.live.com'].some(domain => domainMatches(host, domain)) && /\/(?:l\/meetup-join|meet)\//i.test(url.pathname)) return url;
    if (domainMatches(host, 'webex.com') && (/\/(?:meet|join|wbxmjs\/joinservice)\//i.test(url.pathname)
        || /\/(?:j|m)\.php$/i.test(url.pathname) && Boolean(url.searchParams.get('MTID')))) return url;
    return null;
}

export function textValue(value: unknown, max = 300): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

export function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
