import { User, Palette, Bell, Shield, Info, MonitorSmartphone, Sparkles, PenLine, BookOpen, RefreshCw, HardDrive, Keyboard } from 'lucide-react';
import { preferenceGroups } from './preferenceDefinitions';
export type SettingsTab = 'account' | 'appearance' | 'compose' | 'reading' | 'notifications' | 'smartactions' | 'security' | 'sync' | 'storage' | 'shortcuts' | 'system' | 'about';
export const SETTINGS_TABS = [
    { id: 'account', label: 'Account', description: 'Your profile and Google connection.', icon: User, color: 'text-pink-600 dark:text-pink-400 bg-pink-500/10', active: 'bg-pink-500/10' },
    { id: 'appearance', label: 'Appearance', description: 'Make yourself at home.', icon: Palette, color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10', active: 'bg-violet-500/10' },
    { id: 'compose', label: 'Compose', description: 'Write your way, with fewer interruptions.', icon: PenLine, color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10', active: 'bg-blue-500/10' },
    { id: 'reading', label: 'Reading & inbox', description: 'A comfortable place to read and organize.', icon: BookOpen, color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10', active: 'bg-indigo-500/10' },
    { id: 'notifications', label: 'Notifications', description: 'Stay informed. Protect your focus.', icon: Bell, color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', active: 'bg-amber-500/10' },
    { id: 'smartactions', label: 'Smart Actions', description: 'The useful parts, brought to the surface.', icon: Sparkles, color: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10', active: 'bg-cyan-500/10' },
    { id: 'security', label: 'Privacy & security', description: 'Choose what loads. Control who gets access.', icon: Shield, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', active: 'bg-emerald-500/10' },
    { id: 'sync', label: 'Sync & offline', description: 'Keep your mail ready when you need it.', icon: RefreshCw, color: 'text-sky-600 dark:text-sky-400 bg-sky-500/10', active: 'bg-sky-500/10' },
    { id: 'storage', label: 'Storage', description: 'Understand and manage mail on this device.', icon: HardDrive, color: 'text-orange-600 dark:text-orange-400 bg-orange-500/10', active: 'bg-orange-500/10' },
    { id: 'shortcuts', label: 'Keyboard shortcuts', description: 'Less reaching. More doing.', icon: Keyboard, color: 'text-teal-600 dark:text-teal-400 bg-teal-500/10', active: 'bg-teal-500/10' },
    { id: 'system', label: 'Desktop', description: 'Let OrionMail fit into your day.', icon: MonitorSmartphone, color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10', active: 'bg-blue-500/10' },
    { id: 'about', label: 'About OrionMail', description: 'A little about the app behind your inbox.', icon: Info, color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10', active: 'bg-rose-500/10' },
] as const;
export interface SettingsSearchResult { id: string; title: string; section: SettingsTab; description: string; keywords: string; }
const nativeEntries: [SettingsTab, string, string, string, string][] = [
    ['account', 'alias', 'Alias', 'Your display name in OrionMail.', 'profile nickname display name'],
    ['account', 'email', 'Email address', 'Your connected Google email address.', 'gmail account'],
    ['account', 'connection', 'Mailbox connection', 'View the current connection status.', 'online status'],
    ['account', 'reconnect', 'Reconnect Google', 'Renew access through Google sign in.', 'oauth login'],
    ['account', 'signout', 'Sign out', 'Disconnect the account on this device.', 'logout remove'],
    ['account', 'google', 'Google security', 'Manage your password and two-step verification at Google.', '2fa password'],
    ['appearance', 'light', 'Light mode', 'Use a bright theme.', 'theme white'],
    ['appearance', 'dark', 'Dark mode', 'Use a dark theme.', 'theme night'],
    ['appearance', 'system', 'System theme', 'Follow the Windows theme.', 'automatic'],
    ['appearance', 'accent', 'Accent color', 'Choose your accent color.', 'blue purple rose emerald orange colour'],
    ['security', 'app-lock', 'Windows Hello on launch', 'Require Windows Hello when opening OrionMail.', 'password biometric pin unlock'],
    ['security', 'idle', 'Automatic idle lock', 'Timed re-locking is not available yet.', 'timeout inactivity'],
    ['security', 'windows', 'Lock with Windows', 'Session lock integration is not available yet.', 'session screen'],
    ['sync', 'status', 'Last sync and Sync Now', 'View sync status and refresh your Inbox.', 'manual refresh last updated'],
    ['storage', 'usage', 'Cached mail usage', 'View local message content sizes.', 'bytes space size database'],
    ['storage', 'clear', 'Clear cached mail', 'Remove downloaded mail for the current account.', 'delete cache reset resync'],
    ['system', 'autostart', 'Launch at startup', 'Start when you sign in to Windows.', 'boot login'],
    ['system', 'hidden', 'Start in the tray', 'Start quietly in the background.', 'minimized hidden'],
    ['system', 'tray', 'Keep running when closed', 'Hide to the system tray instead of quitting.', 'close background minimize'],
    ['system', 'badge', 'Taskbar unread badge', 'Taskbar integration is not available yet.', 'windows count'],
    ['shortcuts', 'save', 'Save settings', 'Press Ctrl+S to save pending changes.', 'keyboard'],
    ['shortcuts', 'search', 'Search settings', 'Press Ctrl+K to find a setting.', 'keyboard'],
    ['about', 'version', 'App version', 'Installed version of OrionMail.', 'release build'],
    ['about', 'developer', 'Developed by Arunabhajana', 'About the developer.', 'credits'],
    ['about', 'support', 'Contact and support', 'Email arunabhajana@gmail.com.', 'help feedback'],
    ['about', 'changelog', 'Release notes', 'Published release notes are not available yet.', 'updates changelog'],
    ['about', 'privacy', 'Privacy policy and licenses', 'Public policies and notices are not published yet.', 'legal terms third party'],
];
export const SETTINGS_SEARCH_INDEX: SettingsSearchResult[] = [
    ...nativeEntries.map(([section, key, title, description, keywords]) => ({ id: `${section}.${key}`, section, title, description, keywords })),
    ...Object.entries(preferenceGroups).flatMap(([group, groups]) => groups.flatMap(section => section.items.map(item => ({
        id: `${group}.${item.id}`, section: (group === 'privacy' ? 'security' : group) as SettingsTab, title: item.title, description: item.description, keywords: `${item.key || item.id} ${section.title}`,
    })))),
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
