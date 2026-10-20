# Local and Gmail drafts

Implemented 20 October 2026. Provider and Windows interaction checks remain necessary; compilation does not establish end-to-end Gmail behavior.

## User flow

- Compose saves locally after 500 ms of inactivity, with a two-second maximum wait during continuous typing. Closing the compose window waits for the local save; the trash button explicitly discards the draft.
- Drafts opens cached messages immediately, shows skeletons while initially loading, searches subject/recipients/preview locally, and virtualizes the list.
- Opening a message resumes its recipients, pending recipient input, Cc/Bcc, subject, HTML/plain bodies and attachment references. An existing draft is not rewritten just because its editor normalized HTML on startup.
- Offline work stays on the device. A single background worker coalesces provider saves after a pause and checks Gmail periodically. Explicit Drafts refresh and Sync Now also reconcile. Paused background sync leaves local saving enabled.
- Gmail changes never replace text inside an open editor. Divergent local/provider versions are preserved as separate drafts, marked as copies.
- A shutdown journal attempts recovery of an interrupted local save when Drafts next opens. Recovery uses a separate copy if its saved revision diverged. Missing attachment bytes are called out and sending stays disabled until the files are removed/reselected.

## Storage and identity

- `compose_drafts`: `(account_id, id)` primary key, monotonic local revision, JSON compose payload, timestamps, dirty/status/error fields, Gmail draft ID and its current message ID, editing flag and pending upload revision.
- `draft_files`: account/draft/file-scoped BLOB snapshots of attachments selected through the native picker or downloaded from the provider. No renderer paths are accepted. Removing an attachment removes its stored bytes on save. Quotas remain 25 attachments and 18 MB total.
- `draft_send_receipts`: stable sent-message identity retained after removing draft content, so a repeated send invocation can return confirmation without sending again.
- Generic mail cache clearing does not remove these tables. Draft records are account scoped and commands require the active account and an unlocked app.
- Local saves compare the expected revision inside a transaction. A stale save fails visibly; it cannot overwrite a newer local editor. Attachment writes and the corresponding payload update commit together.

## Gmail integration

The existing full-mail Google OAuth scope permits Gmail draft operations. The **Gmail API must also be enabled in the OAuth client's Google Cloud project**. A denied API request leaves local drafts intact and presents an actionable error. For a wholly local draft whose create request was definitively rejected with HTTP 403, explicit Send can use the existing SMTP path. This fallback is never used after an uncertain upload or for a Gmail-linked draft.

Gmail integration uses the stable draft container ID and checks its changing message ID before updating or discarding. It downloads only new/changed drafts, with two simultaneous downloads and bounded response/body/attachment sizes. A complete paginated listing is required before interpreting a missing remote draft as removed. Provider MIME which cannot be safely edited, such as embedded CID images or encrypted/signed content, remains visible with an Edit in Gmail action.

Before an upload, its local revision and a SHA-256 content fingerprint are persisted, and the revision is encoded into a stable RFC Message-ID. A timed-out create/update enters **Checking Gmail**. The next sync checks both identity and decoded message content before acknowledging it instead of blindly issuing another create. An uncertain create's discard tombstone is retained until the provider outcome can be resolved.

Send is an explicit online operation. It first saves locally, claims the exact local revision, checks Gmail's version and sends the reviewed snapshot. It does **not** queue an automatic send for later connectivity. A timeout enters **Check Sent in Gmail** and blocks another send. Sync searches Sent for the stable RFC Message-ID and can confirm delivery; otherwise the user can explicitly confirm whether it was sent before returning it to a draft. Confirmed sends record a receipt and remove draft content transactionally.

References: [Gmail draft lifecycle](https://developers.google.com/workspace/gmail/api/guides/drafts), [draft update request](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update).

## Boundaries

- Gmail draft updates/deletes do not expose an atomic expected-message-version parameter. A separate Gmail editor can still race the preflight check and the write. Detected divergence preserves both copies; this is not a guarantee against every simultaneous provider write. Avoid actively editing the same draft in Gmail and OrionMail at once.
- Local autosave and the unload journal reduce loss, but an abrupt process/power failure before either commits can lose the most recent input. Close compose normally and wait for Saved on device before force-quitting.
- Unsupported provider MIME is deliberately kept intact in Gmail instead of being converted into an incomplete editable draft. Oversized draft errors do not remove the original provider content.
- No encrypted-at-rest draft store, scheduled send, or automatic offline send outbox is introduced here.

## Manual checks before release

1. Write a message with To/Cc/Bcc, formatting and an attachment. Wait for Saved on device, close compose, reopen Drafts and verify it. Fully quit/relaunch and verify the attachment still exists. Close saves; trash discards.
2. Verify Saved to Gmail and inspect the same draft in Gmail. Change it in Gmail while OrionMail's editor is closed, refresh Drafts and reopen it. Try a Gmail change while the local editor has edits: local text must stay put, with separate copies preserved after reconciliation.
3. Go offline, create/edit a draft, close and relaunch. Reconnect and refresh Drafts. Confirm one corresponding Gmail draft. Discard a synced draft offline and verify it disappears from Gmail only after reconnecting; a newer Gmail edit should be preserved.
4. Send normally and inspect Sent. Interrupt connectivity during a send: an uncertain outcome must block a blind retry. Reconnect and sync; verify automatic confirmation when the stable Message-ID is present in Sent, or explicitly resolve the outcome after checking.
5. Clear generic cached mail with a locally saved draft present; verify the draft and attachments remain. Confirm another account cannot open or save its identity.

Static checks: Rust `cargo check --offline --lib`, TypeScript and focused lint. No automated tests were added or run for this feature in this change.
