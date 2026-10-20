# OrionMail Project Audit

**Original source review:** 12 October 2026

**Implementation status updated:** 20 October 2026

**App version:** `0.1.0`

This document tracks the original findings and their current disposition. An implemented fix is not provider certification or a penetration test. Live Windows Hello and Google sign-in must be exercised interactively; provider reconciliation and failure recovery need the manual checks in [the test guide](SYNC_SECURITY_TESTING.md).

## Completed work

| Original finding / feature | Implementation | Verification boundary |
| --- | --- | --- |
| App-lock startup bypass and Hello UX | The renderer gate waits for verification; shared verification prevents duplicate prompts; Try again appears only after failure. | Startup UX was previously checked by the user. |
| Native app-lock authorization gap | Rust owns process-local unlock state, initially locked when enabled. Only successful native Hello grants access. Account/mail commands, contacts, search continuation, attachment operations, external-link opening and sensitive settings writes require authorization. A locked renderer cannot disable the lock. Enabling lock requires Hello verification and successful settings persistence. | Native session-policy unit tests; actual Hello remains an interactive check. Lock protects launch access; it does not encrypt files or replace OS account security. |
| Email links crossing into OS handlers | Frontend iframe checks and Rust URL validation constrain supported schemes and reject invalid links. | Earlier implementation; broader adversarial URL integration coverage remains useful. |
| Account settings / settings search / About | Alias persistence, individual-setting search and About content implemented; unsupported photo/password controls removed. | Earlier source and user review. |
| P1: account identity missing from cache and sync state | Messages use `(account_id, folder, uid)`. Mailbox/folder/global state, tag relationships, FTS joins and corresponding queries use account identity. Transactional migration preserves ambiguous legacy rows in an isolated scope. | Migration and colliding account-UID fixtures. |
| P1: actions changed local state without provider confirmation | Read/star/delete resolve the actual mailbox, perform the provider operation and then commit locally. Failed actions remain queued for sync retry; UI rolls back. | User previously confirmed online actions and offline retry. Queued actions now additionally carry UIDVALIDITY; missing/changed identities are conflicts, never replayed onto reused UIDs. |
| P1: attachment IPC accepted arbitrary source paths | Native selection creates opaque account-bound handles backed by selected bytes. Rust enforces count, size, regular-file and expiration checks; SMTP consumes bytes. | Backend quota/handle tests. |
| P2: existing flags and remote deletions stayed stale | New-arrival sync is separate from reconciliation. Reconciliation fetches flags for cached UIDs in batches of 200, periodically when a folder sync runs (five-minute interval), and on every explicit refresh. It validates UIDVALIDITY before committing scoped flag/deletion updates and a watermark in one transaction. Failed/incomplete scans do not prune. Existing bodies are retained for surviving messages. | In-memory database, rollback, account/folder isolation, partial-scan and empty-folder tests. Live provider behavior still needs verification. |
| P2: sync requests were dropped while busy | Manual refresh, IDLE and polling use one account/folder coordinator. Pending/running requests coalesce with a follow-up marker. Explicit refresh bypasses throttling and forces reconciliation. The global concurrency limit remains intentional. | Throttle regression tests and source review; notification/manual-refresh stress testing remains manual. |
| Gmail label response desynchronized the IMAP connection | A vendored IMAP patch consumes the unsupported Gmail extension response through completion and turns mismatched command tags into errors rather than assertions. Label-fetch errors now propagate so a broken session is discarded. | Previous compile checks; provider validation remains useful. |
| Context-menu read/unread | Correct target flag is sent, and the open preview does not immediately undo an explicit unread action. Context menus are reusable; other menus have contextual placeholders. | Earlier TypeScript check; remaining menu features are product backlog. |
| Incorrect sync diagnostics | `sync_in_progress` is read from account-scoped folder state rather than hardcoded false. | Compile/source checks. |

## How reconciliation works

1. Retry a bounded batch of pending message actions. Each action verifies the selected mailbox's UIDVALIDITY and message existence before mutating it. Identity conflicts are retained and reported rather than automatically retried.
2. Resolve Inbox, Sent or a tag to its provider mailbox. Require usable UIDVALIDITY/UIDNEXT. Each folder cursor also records its own epoch, so aliases cannot reuse a stale cursor after another folder observes an epoch change. An epoch change atomically invalidates that folder's old cache/cursor and stops obsolete queued actions.
3. Fetch new headers after the UID cursor. A completed empty UID interval is valid when messages have been expunged; it no longer produces a false zero-sync failure.
4. When reconciliation is due or forced, snapshot cached UIDs, fetch `(UID FLAGS)` in explicit bounded batches, and validate the mailbox epoch again. A successful FETCH omitting a requested UID identifies an expunged message.
5. Serialize the scan/commit with local message mutations. Apply scoped flag changes and deletions, cascade tag cleanup, retain cached bodies for surviving rows and advance `last_full_sync_at` transactionally. Pending intent is preserved; a pending read/star on a removed message becomes a visible conflict.
6. Update the list, loaded search results, search cache and unread counts. A cache revision prevents an older refresh response from restoring pre-reconciliation data.

Automatic Inbox polling remains the fallback. Sent and tag reconciliation runs when those folders are synced; this is not a new background scheduler that scans every account/folder on a fixed wall-clock schedule. Network requests are bounded, but an entire very large cached-folder scan can still exceed the sync deadline; failure preserves the previous reconciliation state. Initial-header batching and resumable large-folder work remain below.

## Remaining findings

**P1:** data/security correctness before broad use. **P2:** important reliability/product behavior. **P3:** cleanup or polish. The original P1 findings above have implementations; this does not mean all possible security issues have been identified.

### P2 — Durable drafts implemented; general send-outbox work remains

Compose now persists account-scoped, revision-checked local drafts and attachment bytes, with a background Gmail draft queue, conflict copies, shutdown recovery, skeleton loading and a virtualized Drafts list. Closing compose saves; discarding is explicit. Draft sends retain stable identity, block blind retries on uncertain outcomes, reconcile against Sent and store confirmation receipts. See [draft behavior and verification boundaries](DRAFTS.md).

**Remaining:** live Gmail/offline/restart/conflict validation; a general queued/scheduled send outbox if that feature is desired. Send currently requires an explicit online attempt. Gmail's check-then-write race and abrupt power-loss boundaries are documented; this is not a claim of universal conflict prevention or delivery certification.

Sources: [ComposeModal](../components/ComposeModal.tsx), [pending sent messages](../hooks/usePendingSentMessages.ts), [SMTP](../src-tauri/src/mail/smtp_client.rs).

### P2 — SMTP errors are classified too broadly as authentication failures

Lettre client, transient and permanent errors currently map to authentication. Connectivity problems, recipient rejection and throttling can therefore prompt unnecessary sign-in.

**Next:** distinguish authentication, connection, timeout/uncertain delivery, rate limiting, invalid recipients and permanent rejection. Preserve safe actionable diagnostics.

### P2 — Initial sync still fetches an unbounded header range

Bootstrap downloads headers from UID 1 through `UIDNEXT - 1` in one operation. Reconciliation's 200-UID requests do not fix this separate initial-header path.

**Next:** bounded header batches, persisted checkpoints, progress and cancellation/resumption. Continue to keep cached list interaction independent of background history loading. For very large folders, also persist resumable reconciliation staging without pruning from an incomplete snapshot.

Source: [sync](../src-tauri/src/mail/sync.rs).

### P2 — Provider/transport claims exceed complete supported flows

Google is the active login/refresh flow. Modeling Outlook/custom accounts does not establish their end-to-end support. SMTP transport selection does not fully honor custom TLS settings.

**Next:** either narrow claims to verified provider flows, or complete and test each provider's auth, refresh, transport security, mailbox mapping and send path.

Sources: [provider types](../src-tauri/src/auth/account.rs), [OAuth](../src-tauri/src/auth/oauth.rs), [SMTP](../src-tauri/src/mail/smtp_client.rs).

### P3 — Compose recipient fields and enqueue contract

- Compose still sends empty Cc/Bcc and a null reply-to; expose and validate these fields when implementing their UI.
- Sync commands enqueue a job and return `0`; their actual outcomes arrive through events. Document the contract or return a job ID/status.
- Database initialization still has some `unwrap()` calls; replace them with actionable errors when improving migration/initialization reliability. The old destructive primary-key migration has been replaced by the account-scoped transactional migration.

## Security changes in this update

- Native unlock state lives only in Rust memory and is reset on restart. No renderer-supplied `unlocked` boolean is accepted. Settings reads needed by the gate and Hello availability/verification remain available while locked; sensitive operations fail with `APP_LOCKED`.
- OAuth keeps PKCE and retains the random state for one authorization attempt. The loopback receiver validates method, root callback path, HTTP version, exact loopback Host/port, a single matching state and unambiguous code/error parameters. It rejects bodies and duplicate sensitive parameters, limits headers and socket reads, and expires the listener after three minutes. Invalid requests receive a generic error without consuming the valid callback. Callback responses contain no authorization code or token and are not cacheable.
- OAuth callback I/O runs on a blocking worker; token exchange has a deadline. A provider denial with valid state ends the attempt cleanly. Successful callback receipt is not presented as completed authentication before token exchange finishes.

Sources: [native lock policy](../src-tauri/src/auth/app_lock.rs), [callback receiver](../src-tauri/src/auth/oauth_callback.rs), [reconciliation](../src-tauri/src/mail/reconciliation.rs). Protocol references: [OAuth native-app guidance](https://www.rfc-editor.org/rfc/rfc8252.html), [IMAP UID/FETCH semantics](https://www.rfc-editor.org/rfc/rfc9051.html).

## Existing strengths

- React/native separation, sandboxed email HTML and validated link handling.
- Account-scoped SQLite paging and FTS for local browsing/search.
- Prioritized body prefetch, separate from the message list.
- Remote-confirmed message actions with durable pending records.
- Native attachment selection with backend validation.
- Modular settings and searchable individual controls.

## Recommended next work

1. Validate draft/offline/conflict/uncertain-delivery flows with Gmail; decide whether to add a general queued-send outbox.
2. Accurate SMTP error categories and recipient-field UI.
3. Bounded initial sync, resumable large-folder reconciliation and progress/cancellation.
4. Provider support/claims and provider-specific integration checks.
5. Finish context-menu actions individually and broaden end-to-end regression coverage.
