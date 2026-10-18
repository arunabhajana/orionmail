import { User, Palette, Bell, Shield, Info, MonitorSmartphone, Terminal, Sparkles } from 'lucide-react';

export type SettingsTab = 'account' | 'appearance' | 'notifications' | 'smartactions' | 'security' | 'system' | 'developer' | 'about';
export const SETTINGS_TABS = [
    { id: 'account', label: 'Account', icon: User, color: 'text-pink-600 dark:text-pink-400 bg-pink-500/10', active: 'bg-pink-500/10 dark:bg-pink-400/15' },
    { id: 'appearance', label: 'Appearance', icon: Palette, color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10', active: 'bg-violet-500/10 dark:bg-violet-400/15' },
    { id: 'notifications', label: 'Notifications', icon: Bell, color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', active: 'bg-amber-500/10 dark:bg-amber-400/15' },
    { id: 'smartactions', label: 'Smart Actions', icon: Sparkles, color: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10', active: 'bg-cyan-500/10 dark:bg-cyan-400/15' },
    { id: 'security', label: 'Privacy & Security', icon: Shield, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', active: 'bg-emerald-500/10 dark:bg-emerald-400/15' },
    { id: 'system', label: 'System & Behavior', icon: MonitorSmartphone, color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10', active: 'bg-blue-500/10 dark:bg-blue-400/15' },
    { id: 'developer', label: 'Developer', icon: Terminal, color: 'text-orange-600 dark:text-orange-400 bg-orange-500/10', active: 'bg-orange-500/10 dark:bg-orange-400/15' },
    { id: 'about', label: 'About', icon: Info, color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10', active: 'bg-rose-500/10 dark:bg-rose-400/15' },
] as const;

export interface SettingsSearchResult { id: string; title: string; section: SettingsTab; description: string; keywords: string; }
export const SETTINGS_SEARCH_INDEX: SettingsSearchResult[] = [
    { id: 'account.alias', title: 'Alias', section: 'account', description: 'Change the display name shown in OrionMail.', keywords: 'display name profile nickname' },
    { id: 'account.email', title: 'Email address', section: 'account', description: 'View the email address connected to your account.', keywords: 'connected account mailbox' },
    { id: 'appearance.light', title: 'Light mode', section: 'appearance', description: 'Use a bright appearance for your mailbox.', keywords: 'theme brightness white' },
    { id: 'appearance.dark', title: 'Dark mode', section: 'appearance', description: 'Use a darker appearance for your mailbox.', keywords: 'theme night black' },
    { id: 'appearance.system', title: 'Use system theme', section: 'appearance', description: 'Follow your operating system’s light or dark theme.', keywords: 'theme automatic windows' },
    { id: 'appearance.density', title: 'Message density', section: 'appearance', description: 'Choose compact, default, or relaxed message spacing.', keywords: 'spacing layout' },
    { id: 'appearance.accent', title: 'Accent color', section: 'appearance', description: 'Choose the accent used throughout OrionMail.', keywords: 'blue purple rose emerald orange colour' },
    { id: 'notifications.desktop', title: 'Desktop notifications', section: 'notifications', description: 'Manage desktop alerts for incoming email.', keywords: 'new email push notification' },
    { id: 'notifications.sound-toggle', title: 'Play notification sound', section: 'notifications', description: 'Control whether email alerts play a sound.', keywords: 'audio ping alert mute' },
    { id: 'notifications.sound', title: 'Notification sound', section: 'notifications', description: 'Choose a notification tone.', keywords: 'chime bell orbit audio' },
    { id: 'notifications.unread', title: 'Show unread count', section: 'notifications', description: 'Manage the unread badge on your mailbox.', keywords: 'sidebar taskbar count' },
    { id: 'smartactions.global', title: 'Smart Actions', section: 'smartactions', description: 'Control smart information cards in your emails.', keywords: 'automatically extract information' },
    { id: 'smartactions.otp', title: 'Authentication codes (OTP)', section: 'smartactions', description: 'Show one-time codes as quick actions.', keywords: '2fa password login code' },
    { id: 'smartactions.meetings', title: 'Meetings & events', section: 'smartactions', description: 'Surface meeting links and calendar information.', keywords: 'join links invites' },
    { id: 'smartactions.commerce', title: 'Commerce & tracking', section: 'smartactions', description: 'Show order, receipt, and delivery information.', keywords: 'packages shipping shopping' },
    { id: 'smartactions.travel', title: 'Travel & bookings', section: 'smartactions', description: 'Surface flight, hotel, and itinerary details.', keywords: 'trip reservations' },
    { id: 'security.2fa', title: 'Two-factor authentication', section: 'security', description: 'Find the account authentication preferences.', keywords: '2fa login' },
    { id: 'security.app-lock', title: 'Windows Hello app lock', section: 'security', description: 'Require Windows Hello when opening OrionMail.', keywords: 'password biometric launch unlock pin' },
    { id: 'security.images', title: 'Block external images', section: 'security', description: 'Find the external image privacy preference.', keywords: 'tracking pixels remote images' },
    { id: 'security.blocklist', title: 'Blocked senders', section: 'security', description: 'Find sender blocking preferences.', keywords: 'blocklist spam addresses' },
    { id: 'security.cache', title: 'Clear local cache', section: 'security', description: 'Review the option to clear downloaded mail data.', keywords: 'delete storage' },
    { id: 'system.autostart', title: 'Launch at startup', section: 'system', description: 'Start OrionMail when you sign in to Windows.', keywords: 'login boot automatically' },
    { id: 'system.hidden', title: 'Start hidden', section: 'system', description: 'Start the app in the tray instead of opening a window.', keywords: 'startup minimized' },
    { id: 'system.tray', title: 'Minimize to tray', section: 'system', description: 'Keep OrionMail running when you close its window.', keywords: 'background behavior' },
    { id: 'system.cache', title: 'Clear local cache', section: 'system', description: 'Remove cached mail and let the app download it again.', keywords: 'delete emails storage resync' },
    { id: 'developer.tools', title: 'Developer tools', section: 'developer', description: 'Open advanced diagnostics and testing controls.', keywords: 'debug experimental simulate errors' },
    { id: 'about.version', title: 'App version', section: 'about', description: 'See the installed OrionMail version and developer information.', keywords: 'release build about' },
];

export function searchSettings(query: string): SettingsSearchResult[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return SETTINGS_TABS.flatMap(tab => SETTINGS_SEARCH_INDEX
        .filter(item => item.section === tab.id)
        .map(item => {
            const title = item.title.toLowerCase();
            const haystack = `${title} ${item.description} ${item.keywords} ${tab.label}`.toLowerCase();
            return { item, matches: words.every(word => haystack.includes(word)), score: words.reduce((total, word) => total + (title === word ? 10 : title.startsWith(word) ? 6 : title.includes(word) ? 4 : 1), 0) };
        })
        .filter(result => result.matches)
        .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
        .map(result => result.item));
}
