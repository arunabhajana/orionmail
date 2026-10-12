# OrionMail Project Audit

**Reviewed:** 2026-10-12  
**Version:** `0.1.0`  
**Review type:** Source review of the Next.js/Tauri application, with focused inspection of authentication, email rendering/link handling, IMAP sync, SQLite caching, compose/send, attachment IPC, and settings. No runtime or automated test suite was run for this audit. Findings describe the checked-in source and should be confirmed against provider-specific behavior before a migration or protocol change.

## Executive summary

OrionMail has a solid desktop foundation: React owns the interactive UI, Rust owns privileged mail and OS operations, SQLite and FTS make browsing local-first, IMAP body work is queued separately from the message list, and email HTML is rendered in a sandboxed iframe. The most valuable next work is correctness and reliability at the mail boundaries: account-scope the local database, make remote message actions consistent across folders, reconcile changes and deletions, and give compose a durable draft/outbox lifecycle.

The earlier issues around app-lock startup UX and external email links have been addressed in the current source. Account alias persistence, settings search, and About content have also been implemented. The detailed settings search now indexes individual controls and navigates to them.

## Resolved items

| Issue | Current implementation | State |
|---|---|---|
| App lock could be bypassed by opening app routes before Windows Hello completed | Root layout wraps app content in `AppLockGate`; auth bootstrap waits for lock verification, and a shared verification promise prevents duplicate Hello prompts. The gate shows “Try again” only after verification fails. See [layout](app/layout.tsx#L48), [AppLockGate](components/AppLockGate.tsx#L8), and [AuthContext](components/AuthContext.tsx#L86). | Addressed in the renderer/startup flow. See residual IPC hardening below. |
| Email links could be sent to the operating system without native validation | The iframe reports clicked links to the parent; the parent checks source, opaque iframe origin, message shape, and allowed schemes, and Rust validates the URL again before calling the OS. See [EmailDetail](components/EmailDetail.tsx#L161), [useEmailBody](hooks/useEmailBody.ts#L155), and [native URL validation](src-tauri/src/commands/message_commands.rs#L419). | Addressed with validation at both boundaries. |
| Account settings presented unsupported photo/password actions and an inert name field | Change Photo, Remove, and Change Password are removed. Alias saves through a Tauri command, with whitespace/length validation and persistent account storage. See [AccountSection](components/settings/AccountSection.tsx#L20) and [auth command](src-tauri/src/commands/auth_commands.rs#L31). | Implemented. |
| Settings search only found sections and results were confusing/stayed open | Search indexes specific setting controls, ranks/deduplicates matches, supports arrow keys/Enter/Escape/outside click, closes on selection, and scrolls/focuses the selected control while preserving unsaved-change navigation. See [settings search](app/settings/page.tsx#L46). | Implemented in source; runtime UX still needs a manual check. |
| About page was a placeholder | About now displays package version, product summary, feature cards, and developer attribution. See [About section](app/settings/page.tsx#L337). | Implemented. |

## Findings to address

Severity: **P1** = data/security correctness should be addressed before broad use; **P2** = important reliability or product behavior; **P3** = lower-risk cleanup or polish. Priorities are based on source review, not a penetration test.

### P1 — Local mail and sync state are not scoped by account

The `messages` primary key is `(folder, uid)`, while message rows have no account identifier. Folder sync state is keyed only by folder, and mailbox UIDVALIDITY by mailbox name. Two accounts can have the same folder names and UIDs, so syncing a second account can overwrite or expose the first account’s cached message rows and reuse its cursor. Tags are account-scoped, but their foreign key points only to `(folder, uid)`, leaving the same identity mismatch. See [database schema](src-tauri/src/mail/database.rs#L68), [mailbox/sync state](src-tauri/src/mail/database.rs#L274), and [message tags](src-tauri/src/mail/database.rs#L326).

**Recommendation:** Add account identity to messages, mailbox state, folder/global sync state, FTS joins, message-tag relationships, cache keys, and every corresponding query. Migrate transactionally without dropping cached mail. Add a two-account fixture with colliding folder names and UIDs before enabling account switching broadly.

### P1 — Message flags and deletion are only synchronized remotely in Inbox

`mark_as_read`, `toggle_read`, `toggle_star`, and `delete_message` branch on `folder != "inbox"` and return after changing/deleting only the local SQLite row. A tag, Sent, or other real mailbox can therefore show a local state that disagrees with the provider. Inbox deletion also treats MOVE failure as success if fallback commands fail, then deletes the local message anyway. See [message actions](src-tauri/src/commands/message_commands.rs#L28), [star handling](src-tauri/src/commands/message_commands.rs#L104), and [delete fallback](src-tauri/src/commands/message_commands.rs#L136).

**Recommendation:** Resolve each UI folder/tag to its provider mailbox and execute the remote operation before committing local state. Keep a pending operation/outbox record when offline, retry idempotently, and surface a conflict if the provider rejects it. Only remove the local row after confirmed move/delete, or mark it pending-delete until confirmation.

### P1 — Attachment IPC trusts renderer-supplied file paths

`get_attachment_metadata` accepts arbitrary path strings and reads filesystem metadata; `send_message` accepts those paths and the SMTP layer reads each one directly. The 18 MB and 25-file limits are enforced only in `ComposeModal`, not by the Rust command. A compromised or modified renderer can bypass those UI checks and ask the backend to read arbitrary local files into an email. See [attachment metadata command](src-tauri/src/commands/message_commands.rs#L267), [send command](src-tauri/src/commands/message_commands.rs#L303), [SMTP file reads](src-tauri/src/mail/smtp_client.rs#L88), and [frontend-only limits](components/ComposeModal.tsx#L518).

**Recommendation:** Have Rust open the native file picker or issue short-lived opaque attachment handles for user-selected files. Enforce count, total bytes, regular-file status, and read limits in the backend, then send from those handles rather than accepting arbitrary paths.

### P2 — Sync does not reconcile existing messages or remote deletions

The normal sync path fetches UIDs after `last_uid`; it updates flags only for messages in that new range and has no periodic full-folder flag/deletion reconciliation. A message deleted remotely or changed on another device can remain stale in SQLite. The declared `last_full_sync_at` state is not used to schedule a full reconciliation. See [UID range sync](src-tauri/src/mail/sync.rs#L95) and [sync-state schema](src-tauri/src/mail/database.rs#L282).

**Recommendation:** Keep the cheap UID delta for new arrivals, then schedule a bounded reconciliation using UIDVALIDITY, UID/flag snapshots, and provider change hints where available. Remove stale cache rows transactionally only after a complete successful scan; persist a reconciliation watermark and error state.

### P2 — Initial sync downloads an unbounded header range in one operation

When `last_uid == 0`, the first sync fetches UID `1` through `UIDNEXT - 1`, accumulates parsed headers in memory, and writes them in one SQLite transaction. A mailbox with a large history can cause a long login/sync, high memory use, or a long UI wait. See [bootstrap UID range and batch collection](src-tauri/src/mail/sync.rs#L101).

**Recommendation:** Fetch and commit bounded UID batches, emit progress, and allow cancellation/resumption. Keep message-list page loading independent so an initial sync does not need to finish before useful inbox interaction.

### P2 — Sync deduplication and coordination are global and can lose work

The queue key is only `MailFolder`, not `(account, folder)`. It removes a folder from the pending set as soon as a worker acquires the global lock, so a later request can create another worker waiting for the same folder. IDLE and polling use `try_lock` and skip a sync when the lock is busy; IDLE collapses buffered notifications, so a skipped change can wait for a later notification or the three-minute poll. See [sync queue/lock](src-tauri/src/mail/sync_manager.rs#L7), [IDLE coordinator](src-tauri/src/mail/idle.rs#L39), and [poll loop](src-tauri/src/mail/poll.rs#L38).

**Recommendation:** Use one account-aware sync coordinator with a pending/running key set and coalesced dirty-folder flags. When busy, record one follow-up sync rather than dropping the request. Give IDLE, user refresh, and polling the same scheduler and observable status.

### P2 — Compose has no durable drafts/outbox, and send timeout can lead to duplicates

Compose starts in a local `draft` state but does not persist a draft. Pending sent messages live only in React state and expire after five minutes. SMTP may accept a message while the client times out before receiving confirmation; the UI then reports failure, and a retry creates a new Message-ID, so the recipient may receive a duplicate. See [compose send lifecycle](components/ComposeModal.tsx#L461), [pending message lifetime](hooks/usePendingSentMessages.ts#L1), and [SMTP timeout](src-tauri/src/mail/smtp_client.rs#L135).

**Recommendation:** Persist drafts locally and implement an outbox with explicit `queued / sending / uncertain / sent / failed` states. Reuse a stable message identifier for a retry and reconcile uncertain sends against Sent using Message-ID before offering “send again.” Keep drafts and outbox rows account-scoped.

### P2 — SMTP error classification reports most delivery failures as authentication failures

All Lettre client, transient, and permanent errors map to `SendError::Authentication`. Network outages, recipient rejection, throttling, and server-side delivery problems can therefore tell users to re-login when that will not help. See [SMTP error handling](src-tauri/src/mail/smtp_client.rs#L150).

**Recommendation:** Map authentication, connection, timeout, rate-limit, invalid-recipient, and permanent rejection separately. Preserve a safe provider diagnostic for logs while returning a clear actionable category to the UI.

### P2 — OAuth callback creates but never validates the `state` value

The OAuth flow creates a CSRF `state` token but binds it to `_csrf_state` and never compares the callback query parameter. PKCE protects the authorization-code exchange, but the callback should still validate the state and expected callback shape. See [OAuth authorize/callback flow](src-tauri/src/auth/oauth.rs#L50).

**Recommendation:** Retain the generated state, parse and validate it from the callback before accepting the code, validate method/path/host, and apply a short timeout to the loopback listener. Keep PKCE enabled.

### P2 — OAuth and transport claims exceed the implemented provider flow

`MailProvider` models Google, Outlook, and custom IMAP/SMTP, and deletion has provider branches, but the visible login flow is `login_google`; token refresh is Google-specific. SMTP always uses `starttls_relay`, and non-Google providers receive the OAuth access token as the password. Custom `starttls`/`tls` values are not honored by this send path. The README advertises broader multi-provider support than the active auth/send paths establish. See [provider types](src-tauri/src/auth/account.rs#L17), [Google-only OAuth](src-tauri/src/auth/oauth.rs#L13), and [SMTP transport selection](src-tauri/src/mail/smtp_client.rs#L108).

**Recommendation:** Either limit product/docs to the provider flows that work end-to-end, or complete each provider’s auth, refresh, SMTP/IMAP auth, TLS mode, folder mapping, and integration checks before exposing it.

### P2 — Renderer app-lock gate is not a native IPC authorization boundary

The current lock correctly gates the rendered app and delays account bootstrap until Hello succeeds. However, privileged Tauri commands such as message reads/sends call `ensure_active_account`, which checks account/token state but not whether the app lock has been unlocked in this process. A renderer that can invoke commands directly is outside the UI gate. This is a defense-in-depth gap; this source review did not demonstrate a normal-user route bypass. See [renderer gate](components/AppLockGate.tsx#L8), [command registration](src-tauri/src/lib.rs#L169), and [active-account check](src-tauri/src/auth/bootstrap.rs#L14).

**Recommendation:** Treat Windows Hello as a native process/session capability. Record successful unlock in backend-managed state and require it for sensitive commands, or clearly scope app lock as a UI privacy screen rather than a security boundary. Avoid a frontend-provided boolean as proof of unlock.

### P3 — Small correctness and maintainability items

- The inbox command endpoint returns `0` immediately after enqueuing background work; callers must rely on events rather than the return value. Document that contract or return a job ID and status. See [sync command](src-tauri/src/commands/auth_commands.rs#L88).
- `get_sync_diagnostics` currently reports `sync_in_progress: false` unconditionally, so diagnostics cannot accurately show an active operation. See [diagnostics response](src-tauri/src/commands/message_commands.rs#L402).
- SQLite schema initialization uses several `unwrap()` calls and drops the `messages` table when it detects a primary-key mismatch. A schema change can silently discard local mail cache instead of migrating it. See [schema check/drop](src-tauri/src/mail/database.rs#L49) and [migration statements](src-tauri/src/mail/database.rs#L91).
- The compose editor supports rich text and attachment limits in the UI, but send wiring always passes empty Cc/Bcc and `replyTo: null`; those backend fields are not currently reachable from compose. See [send invocation](components/ComposeModal.tsx#L489).

## Core mail flows

### Sync and message list

1. Auth bootstrap resolves the active account and refreshes Google tokens if they are near expiry.
2. `sync_inbox`/`sync_mail_folder` enqueue work. The manager deduplicates by folder and serializes workers with one global lock.
3. `sync_folder` resolves the IMAP mailbox, checks UIDVALIDITY, fetches new headers after the last stored UID, writes them to SQLite, emits `mail:updated`, then queues body prefetch for recent messages.
4. IMAP IDLE requests sync on mailbox changes; a three-minute polling worker is the fallback.
5. The React list pages through cached headers while selected bodies load through the body-prefetch manager.

**What is good:** the list path is separate from full-body fetching; IMAP blocking work is isolated from the async runtime; SQLite transactions and indexes support local paging/search; IDLE has reconnection backoff; recent bodies are prefetched with explicit priorities.

**Better execution model:** make account/folder a first-class sync job key, coalesce requests rather than dropping them, batch initial scans, and persist sync checkpoints/error/progress. Add reconciliation for changed flags and server deletions without sacrificing the cheap incremental UID path.

### Compose and send

1. React/Tiptap owns the compose draft in component state.
2. The send handler requires a recipient and nonempty body, runs the HTML cleanup/sanitizer, and invokes the Rust `send_message` command.
3. Rust refreshes an expiring Google token, builds a MIME multipart message, reads attachment paths, and sends through Lettre with a 120-second timeout.
4. On success the frontend holds a temporary “syncing” item until an IMAP message with the same Message-ID appears in the local Sent folder.

**What is good:** HTML cleanup happens before send; MIME supports plain text and HTML; attachment count/size feedback exists in the UI; pending messages are reconciled against provider Message-ID when available.

**Better execution model:** persist drafts and an outbox in SQLite, move file selection/limits into Rust-issued attachment handles, treat timeouts as uncertain delivery, use stable retry identity, and make Cc/Bcc/reply-to actions explicit in the composer.

## Existing strengths

- **Clear frontend/backend split:** Tauri commands own native OS and mail operations; React components own presentation and interactions.
- **Local-first data path:** SQLite paging and FTS support fast browsing and local search even when network access is unavailable.
- **Body work is prioritized:** `BodyPrefetchManager` separates immediate reads, search work, and background prefetch, limiting competition with the visible message.
- **Email HTML isolation:** message content is placed in a sandboxed iframe without `allow-same-origin`; parent messages are checked by source, origin, shape, and message ID before action.
- **External links use defense in depth:** frontend policy plus backend URL validation keeps unsupported protocols from crossing into OS handlers.
- **Auth token handling:** access/refresh token fields are excluded from account JSON serialization and token persistence uses the dedicated token-store module.
- **Settings work is modular:** account, appearance, notifications, security, system, developer, and smart-action sections are separate modules; settings search navigates to individual indexed controls.

## Suggested order of work

1. **Protect data boundaries:** account-scope the database; enforce attachment handles and limits in Rust; decide and implement the native app-lock IPC boundary.
2. **Make mail actions truthful:** remote flags/moves for every real folder; pending-operation handling; sync reconciliation for flags/deletions.
3. **Harden send lifecycle:** persistent draft/outbox, uncertain-send reconciliation, accurate SMTP errors, and recipient-field support.
4. **Scale sync:** bounded first sync, account-aware coalescing queue, progress/cancellation, and measurable diagnostics.
5. **Close auth/provider gaps:** validate OAuth state and make supported provider claims match end-to-end tested behavior.
6. **Add regression coverage:** multi-account UID collisions, server-side flag changes/deletes, IDLE while manual sync is active, send timeout/duplicate recovery, malicious attachment paths/oversize inputs, and email-link scheme/encoding cases.

## Audit limits

No `PROJECT_AUDIT.md` existed in the workspace when this review started, so this file recreates the requested audit baseline and adds the current fixes and findings. This document is a source-level audit, not a penetration test, IMAP/SMTP provider certification, or visual runtime review. The graphify skill’s required detection workflow was unavailable in this environment (the installed `graphify` executable has no `detect` command and its Python module is not installed), so the project was reviewed directly. Findings should be revalidated after implementation, especially provider behavior and Windows Hello enforcement at the native command boundary.
