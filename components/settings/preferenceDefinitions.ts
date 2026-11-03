import type { AppPreferences } from "@/lib/app-preferences";
export interface PreferenceDefinition { key?: keyof AppPreferences; id: string; title: string; description: string; type: "toggle" | "select" | "text" | "textarea" | "time" | "unavailable" | "folder"; options?: readonly (readonly [string, string])[]; }
export interface PreferenceGroup { title: string; description?: string; items: PreferenceDefinition[]; }
const item = (key: keyof AppPreferences, title: string, description: string, type: PreferenceDefinition["type"] = "toggle", options?: PreferenceDefinition["options"]): PreferenceDefinition => ({ key, id: key, title, description, type, options });
const later = (id: string, title: string, description: string): PreferenceDefinition => ({ id, title, description, type: "unavailable" });
export const preferenceGroups: Record<string, PreferenceGroup[]> = {
    compose: [
        { title: "Your writing defaults", items: [
            item("signature", "Email signature", "Plain text, added to new messages. The Signature button in Compose lets you edit or insert it into an existing draft. Leave empty for no default signature.", "textarea"),
            item("defaultCc", "Default Cc", "Visible to all recipients. Separate addresses with commas.", "text"),
            item("defaultBcc", "Default Bcc", "Copied privately on every new message. Review before sending.", "text"),
            item("composeFont", "Message font", "Used in the composer and outgoing HTML email.", "select", [["system", "Sans serif"], ["serif", "Serif"], ["monospace", "Monospace"]]),
        ] },
        { title: "Before you send", items: [
            item("confirmEmptySubject", "Confirm an empty subject", "Ask before sending a message without a subject."),
            item("attachmentReminder", "Attachment reminder", "Ask when you mention an attachment but haven’t added a file."),
        ] },
    ],
    reading: [
        { title: "Reading comfort", items: [
            item("readingFontSize", "Message text size", "Default text size for messages. Sender formatting may vary.", "select", [["14", "Small · 14 px"], ["16", "Default · 16 px"], ["18", "Large · 18 px"], ["20", "Extra large · 20 px"]]),
            item("markRead", "Mark messages as read", "The timer starts when the message loads and pauses while the app is in the background. Manual mode keeps mail unread until you mark it yourself.", "select", [["immediate", "When opened"], ["3", "After 3 seconds"], ["5", "After 5 seconds"], ["manual", "Manually"]]),
            item("autoSelectNext", "Select next after deleting", "Open the next message in the current list after a confirmed deletion."),
        ] },
        { title: "Mailbox layout", items: [
            item("density", "Message density", "Choose how much breathing room each message gets.", "select", [["compact", "Compact"], ["default", "Comfortable"], ["relaxed", "Spacious"]]),
            item("readingPane", "Reading pane", "Read beside or below the message list.", "select", [["right", "On the right"], ["bottom", "At the bottom"]]),
            item("previewLines", "Message previews", "Choose how much message text appears in the list.", "select", [["0", "Hidden"], ["1", "One line"], ["2", "Two lines"]]),
            item("showAvatars", "Sender initials", "Show a small initials avatar beside each sender."),
            item("dateFormat", "Date format", "Choose relative times or calendar dates.", "select", [["relative", "Relative"], ["absolute", "Calendar date"]]),
            item("defaultFolder", "Start in", "The folder to open when you return to your mailbox.", "select", [["inbox", "Inbox"], ["starred", "Starred"], ["sent", "Sent"]]),
            item("conversationView", "Conversation grouping", "Group linked replies into conversations. Separate OTP and notification messages stay independent. Enabled by default."),
        ] },
    ],
    system: [{ title: "Taskbar", items: [
        item("taskbarBadgeScope", "Taskbar count", "Choose which connected accounts contribute to the taskbar badge.", "select", [["active","Current account"],["all","All connected accounts"]]),
        item("taskbarBadge", "Taskbar unread badge", "Show unread messages (excluding Trash) on the Windows taskbar icon, up to 99+. The badge clears when there are no unread messages. Save changes to apply."),
    ] }],
    notifications: [
        { title: "Incoming mail", description: "Choose which new messages can interrupt you. Windows notification permissions also apply.", items: [
            item("desktopNotifications", "Desktop notifications", "Show native desktop alerts for newly synced mail."),
            item("notificationSound", "Notification sound", "Play your selected Windows tone for new mail."),
            item("hideNotificationContent", "Hide message previews", "Use a generic alert without sender names or subjects."),
            item("showUnreadCount", "Unread badges", "Show unread counts next to mailbox folders."),
            item("notificationTone", "Notification tone", "Choose a Windows notification sound. Windows controls playback volume.", "select", [["mail","Mail"],["default","Default"],["im","Instant message"],["reminder","Reminder"]]),
            item("importantOnly", "Important mail only", "Only alert for messages marked Important by Gmail. Requires synced Gmail importance metadata; other messages are skipped."),
        ] },
        { title: "Folder notifications", description: "Applies to new arrivals after a folder’s first sync. Tag alerts follow folders you sync; this does not add background sync jobs.", items: [
            item("notifyInbox", "Inbox", "Notify for new Inbox messages."),
            item("notifySent", "Sent", "Notify for newly synced sent messages."),
            item("notifyLabels", "Tags", "Notify for new messages in synced tag folders. Trash and Starred never trigger alerts."),
        ] },
        { title: "Time to focus", items: [
            item("dndEnabled", "Do not disturb", "Silence mail alerts and sounds until you turn this off. The bell in the titlebar controls the same setting. Scheduled quiet hours still apply when this is off."),
            item("quietHours", "Scheduled quiet hours", "Silence alerts during a daily window, in your device’s local time."),
            item("quietStart", "Quiet hours begin", "Start of your daily quiet window.", "time"),
            item("quietEnd", "Quiet hours end", "End of your daily quiet window. Equal times silence alerts all day.", "time"),
        ] },
    ],
    smartactions: [
        { title: "Useful details, without the digging", description: "Show locally extracted information as quick action cards in your messages.", items: [
            item("smartActionsGlobal", "Smart Actions", "Show actionable cards above your email content."),
            item("smartActionsOtp", "Authentication codes", "Quickly copy one-time passwords and verification codes."),
            item("smartActionsMeetings", "Meetings and events", "Surface meeting links and calendar invitations."),
            item("smartActionsCommerce", "Orders and deliveries", "Keep receipts, packages, and tracking details handy."),
            item("smartActionsTravel", "Travel and bookings", "Show flight, hotel, and itinerary information."),
        ] },
    ],
    privacy: [
        { title: "Content and links", items: [
            item("blockRemoteImages", "Block remote images", "Prevent image and stylesheet requests until you allow them for a message."),
            item("confirmExternalLinks", "Confirm external links", "Ask before a message link opens in your system browser."),
            later("blocklist", "Blocked senders", "Manage Gmail blocking in Gmail until provider rules are supported here."),
        ] },
    ],
    sync: [
        { title: "Stay up to date", items: [
            item("syncPaused", "Pause background sync", "Pause new automatic sync requests. Sync Now still works; a running sync may finish."),
            item("pollInterval", "Fallback sync interval", "Live Inbox updates stay enabled. This interval is the backup check.", "select", [["60", "Every minute"], ["180", "Every 3 minutes"], ["300", "Every 5 minutes"], ["900", "Every 15 minutes"]]),
            item("prefetchBodies", "Preload message bodies", "Fetch nearby messages in the background for faster reading. Opening a message still downloads it."),
        ] },
        { title: "Offline mail", items: [
            later("history", "Sync history range", "Mail history currently syncs in full. Date-limited sync is not available yet."),

            later("attachments", "Automatic attachment downloads", "Attachments currently download only when you request them."),
        ] },
    ],
    storage: [
        { title: "Cache preferences", items: [
            item("cacheRetention", "Keep downloaded bodies", "Automatically expire downloaded bodies after this time. Headers stay available; opening mail downloads its body again.", "select", [["7","7 days"],["30","30 days"],["90","90 days"],["0","Until cleared manually"]]),
            item("cacheBudget", "Body cache budget per account", "Periodically remove the oldest downloaded bodies above this target. Headers, inline images and saved attachments are excluded.", "select", [["256","256 MB"],["512","512 MB"],["1024","1 GB"],["0","Unlimited"]]),
            item("downloadFolder", "Default download folder", "Attachment Save dialogs start here. Empty uses your system Downloads folder.", "folder"),
        ] },
    ],
    shortcuts: [
        { title: "Keyboard control", items: [
            item("shortcutsEnabled", "Mailbox shortcuts", "Enable Ctrl+N to compose, Ctrl+K to search, and Ctrl+Shift+U to toggle read status. Shortcuts are ignored while typing."),
            later("custom", "Custom shortcut bindings", "Available shortcuts use fixed bindings. Reply, forward, and archive shortcuts are not available yet."),
        ] },
    ],
};
