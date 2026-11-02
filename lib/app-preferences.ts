export const defaultPreferences = {
    conversationView: true,
    downloadFolder: "", cacheRetention: "30", cacheBudget: "512", taskbarBadge: true,
    dndEnabled: false,
    smartActionsGlobal: true, smartActionsOtp: true, smartActionsMeetings: true, smartActionsCommerce: true, smartActionsTravel: true,
    signature: "", defaultCc: "", defaultBcc: "", composeFont: "system", confirmEmptySubject: true, attachmentReminder: true,
    readingFontSize: "16", markRead: "immediate", autoSelectNext: false,
    density: "default", showAvatars: true, previewLines: "2", dateFormat: "relative", readingPane: "right", defaultFolder: "inbox",
    desktopNotifications: true, notificationSound: true, hideNotificationContent: false, showUnreadCount: true,
    quietHours: false, quietStart: "22:00", quietEnd: "08:00",
    blockRemoteImages: true, confirmExternalLinks: true,
    syncPaused: false, pollInterval: "180", prefetchBodies: true, shortcutsEnabled: true,
};
export type AppPreferences = typeof defaultPreferences;
const choices: Partial<Record<keyof AppPreferences, readonly string[]>> = {
    cacheRetention: ["0","7","30","90"], cacheBudget: ["0","256","512","1024"],
    composeFont: ["system", "serif", "monospace"], readingFontSize: ["14", "16", "18", "20"],
    markRead: ["immediate", "3", "5", "manual"], density: ["compact", "default", "relaxed"],
    previewLines: ["0", "1", "2"], dateFormat: ["relative", "absolute"], readingPane: ["right", "bottom"],
    defaultFolder: ["inbox", "starred", "sent"], pollInterval: ["60", "180", "300", "900"],
};
/** Allowlisted, bounded device preferences; ignore corrupt or unknown stored values. */
export function normalizePreferences(value: unknown): AppPreferences {
    const result = { ...defaultPreferences };
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const key of Object.keys(result) as (keyof AppPreferences)[]) {
        const v = (value as Record<string, unknown>)[key];
        if (typeof result[key] === "boolean") {
            if (typeof v === "boolean") Object.assign(result, { [key]: v });
        } else if (typeof v === "string" && v.length <= (key === "signature" ? 4000 : 1000)) {
            if (choices[key] && !choices[key]!.includes(v)) continue;
            if ((key === "quietStart" || key === "quietEnd") && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) continue;
            Object.assign(result, { [key]: v });
        }
    }
    return result;
}
export function parseAddressList(value: string): string[] {
    const addresses = value.split(/[,;]/).map(x => x.trim()).filter(Boolean);
    if (addresses.length > 25 || addresses.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))) throw new Error("Use valid email addresses separated by commas (up to 25).");
    return [...new Set(addresses)];
}
export function plainTextHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}
export function signatureHtml(signature: string): string {
    return signature.trim() ? `<p>—<br>${plainTextHtml(signature.trim())}</p>` : '';
}
export function quietHoursActive(preferences: Pick<AppPreferences, 'quietHours' | 'quietStart' | 'quietEnd'>, now = new Date()): boolean {
    if (!preferences.quietHours) return false;
    const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    const start = minutes(preferences.quietStart), end = minutes(preferences.quietEnd);
    const current = now.getHours() * 60 + now.getMinutes();
    return start < end ? current >= start && current < end : current >= start || current < end;
}
