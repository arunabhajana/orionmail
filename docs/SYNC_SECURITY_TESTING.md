# Sync reconciliation and native security checks

Implementation update: 18 October 2026. Restart the rebuilt desktop app before interactive testing; a browser/frontend refresh alone does not replace the Rust backend.

## Automated checks

From the project root:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The Rust regressions cover native launch-lock policy, refusal to disable a locked session, enabling verification, restart revocation, OAuth state/duplicate/method/path/host/body validation and callback expiry, account isolation, interrupted reconciliation batches, atomic database rollback, unchanged bodies, empty remote folders, pending-action conflicts, mailbox UID reuse, and forced-refresh throttling. Existing attachment and account-migration tests remain in the suite.

These tests do not sign in to Google, read real mail, display Windows Hello or certify provider behavior.

## Provider-side flags and deletions

Use disposable messages and open Gmail in a browser alongside OrionMail.

1. In OrionMail, load Inbox and choose a message that is already cached. Keep the app open.
2. In Gmail, mark that message read/unread and star/unstar it. Do not create new mail: this specifically checks the old no-new-UID fast path.
3. In OrionMail, press Sync Now. The list and unread/star state should match Gmail, including the currently open message's read state.
4. In Gmail, delete a cached disposable message. Sync Now in OrionMail. It should disappear from the list and any loaded search results. If selected, its detail should close. Other messages and cached bodies should remain available.
5. Repeat in Sent and in a tag/label. Sync that folder, not just Inbox. Gmail labels can refer to the same underlying message, so choose independent examples when comparing results.
6. Load additional list pages before deleting an older cached message. After sync, check that it does not linger merely because it was outside the newest 50 rows.
7. Empty a small test label remotely and sync it. OrionMail should show an empty list without a false zero-sync failure. Other folders must retain their messages.

Explicit refresh always forces a reconciliation. Automatic checks run when a folder sync executes and its five-minute reconciliation interval has elapsed. Background Inbox polling is not an automatic full-account scan of every tag and Sent folder.

## Failure recovery and pending actions

1. Load a few cached messages. Disconnect the network and try read/star/delete. The failed action should roll back visibly and remain queued.
2. Reconnect and press Sync Now. The action should retry and match Gmail after provider confirmation.
3. For a conflict case, queue a read/star action offline, then remove that same message through Gmail before reconnecting OrionMail. Sync Now should report a queued-action conflict and remove the stale cached message; it should not repeatedly claim success or apply the action to another UID.
4. Interrupt the connection during reconciliation. Sync may fail, but incomplete scan results must not remove cached rows or advance the completed-scan watermark. Reconnect and retry.
5. Trigger refresh while another sync is running. The request should coalesce into a pending/follow-up job; the UI should not become permanently stuck syncing. IDLE/polling requests now use the same coordinator.

Existing queued actions are migrated using their cached message's UIDVALIDITY. An action with no trustworthy identity is retained as a conflict instead of being replayed unsafely. Mailbox epoch changes are difficult to provoke safely against a real account; the regression tests cover the reused-UID guard.

## Native app-lock boundary

1. Enable Require Password on App Launch in Settings and save. Windows Hello must verify before the setting is persisted. Cancelling should leave the previous setting unchanged.
2. Fully quit the application, restart and cancel Hello. The lock screen should remain visible.
3. In a development build, open DevTools and attempt the following read-only native calls while still locked:

```javascript
await window.__TAURI_INTERNALS__.invoke('get_cached_messages')
await window.__TAURI_INTERNALS__.invoke('get_current_user')
await window.__TAURI_INTERNALS__.invoke('list_accounts')
await window.__TAURI_INTERNALS__.invoke('get_unread_counts')
await window.__TAURI_INTERNALS__.invoke('search_contacts', { query: '' })
```

Each should reject with `APP_LOCKED`, even if the UI gate is bypassed. `get_app_settings` and Hello availability/verification intentionally remain callable so the lock screen can operate.

4. Attempt to disable the lock through the settings command while locked; it must reject:

```javascript
const settings = await window.__TAURI_INTERNALS__.invoke('get_app_settings');
await window.__TAURI_INTERNALS__.invoke('set_app_settings', {
  minimizeToTray: settings.minimize_to_tray,
  startHidden: settings.start_hidden,
  appLockEnabled: false
});
```

5. Use Try again and successfully verify Hello. The read-only calls should now work normally. Quit/restart and cancel again: the prior process's grant must not survive.
6. With lock legitimately disabled, restart and confirm normal startup requires no Hello verification. Enabling it again requires verification.

This is launch/session access enforcement. It does not encrypt the SQLite cache or provide protection against an attacker who controls the OS account or can edit app binaries/configuration on disk.

## OAuth sign-in

1. Start normal Google sign-in and finish it. A verified callback should let the app complete token exchange and account bootstrap.
2. Cancel/deny in Google's consent page. The app should report cancellation rather than accept an unrelated account or hang indefinitely.
3. Start another attempt and leave the browser unfinished. After about three minutes, the listener must expire and the app should offer another sign-in attempt.
4. The parser regressions reject missing/mismatched/duplicated state, duplicate code (including encoded parameter names), simultaneous code/error, wrong Host/port, wrong method/path and request bodies. PKCE remains enabled. Never paste real callback codes, state values or tokens into logs or bug reports.
