# Settings rework

## Available controls

Preferences are saved on this device. Appearance changes apply immediately; other preference forms use Save changes, Discard, and navigation protection. Search uses the same definitions as the rendered controls, includes individual settings, supports keyboard navigation, and scrolls/focuses the chosen control.

- Account: local alias, Gmail address, connection status, Google reconnect, Google security link, sign out.
- Appearance: light/dark/system theme and accent color.
- Compose: plain-text signature, editable default Cc/Bcc recipients, outgoing/composer font, empty-subject confirmation, attachment reminder.
- Reading: text size, automatic/delayed/manual read marking, next message after successful deletion, density, right/bottom pane, preview lines, local initials avatars, date format, starting folder.
- Notifications: native Inbox alerts, default system sound, generic private notifications, folder unread counts, Do not disturb, daily quiet hours in local time (including overnight windows).
- Smart Actions: master switch and authentication, meetings, commerce, travel categories.
- Privacy: block remote resources by default, per-message content permission, confirmation before opening message links. The iframe CSP blocks image, stylesheet, and font network requests while remote content is blocked. This is not a complete tracking-prevention guarantee.
- Sync: manual Inbox sync, last-sync status, pause automatic sync, fallback polling interval, body preloading. Live IMAP updates remain connected; pause prevents new automatic sync jobs and background prefetch. Manual sync, opening a message, and search can still use the network. Work already running can finish. A changed polling interval applies after the current wait.
- Storage: active-account message count and logical header/body content estimates, safe cache clearing. Pending actions must be synchronized or resolved first. This estimate excludes indexes, free database pages, and attachment files.
- Shortcuts: enable/disable mailbox Ctrl+N (compose), Ctrl+K (search), Ctrl+Shift+U (toggle read). Typing fields and the composer keep their own shortcuts. Settings Ctrl+K and Ctrl+S remain available.
- Desktop: Windows startup, launch in tray, close to tray.
- About: real logo, installed version, features, developer credit, contact.

## Explicitly unavailable

The corresponding rows are informational and do not pretend to be working controls: conversation grouping; per-folder/important-only notifications; custom sound/volume; timed or Windows-session re-locking; provider blocklists; history ranges; prefetch byte budgets; automatic attachment downloads; retention and separate attachment cache clearing; a persistent download folder; custom key bindings and unavailable reply/forward/archive actions; taskbar badge; unpublished release notes/legal notices. Troubleshooting is omitted.

## Persistence and native enforcement

Frontend preferences use an allowlisted, typed `orion_app_preferences` localStorage record. Native notification and sync preferences are also persisted to the app config directory in `mail-preferences.json`, through validated Rust IPC. Native preferences load at startup, so background behavior does not depend on an open settings page. Windows Hello still uses the existing backend authorization checks; this redesign does not introduce a renderer unlock bypass. Content/compose preferences are device-wide, including signature and default copy recipients.

## Review in the desktop app

- Change a setting, search for another, and select its result: save/discard protection should preserve the current form. Search results should disappear after opening a result.
- Save changes, reopen Settings, and restart the app to review persistence.
- Compare both themes; resize the window; use Tab, arrows, Enter, Escape, Ctrl+K and Ctrl+S.
- Open a draft: verify signature, visible default copy recipients, selected font, and send confirmations. Changing Cc/Bcc in a message only changes that message.
- Read an unread message using each read-timing mode; leave before the delay. Explicitly mark an open message unread and ensure it stays unread.
- Send an Inbox message from another account to review notification privacy, DND, sound, and quiet hours with the app in the tray.
- Pause sync, receive mail, then use Sync Now. Resume to restore automatic updates.
- Open mail containing remote images: they should stay blocked until allowed. Re-block or open another message to review the default. Confirm external links still pass backend URL validation.

Type/lint/build checks do not prove Google provider behavior, native notifications, or Windows Hello UX. Those require a desktop session with a connected account.
