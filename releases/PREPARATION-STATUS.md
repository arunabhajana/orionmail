# Multi-account validation — 2026-11-03

Validated on Windows with Node 26.12.1 and Rust 1.99.1. The declared Rust minimum is 1.88, matching the locked `time` dependency; this run does not certify the minimum toolchain.

## Fixes in this pass

- Windows native test startup: `rfd` imports `TaskDialogIndirect`, which requires Common Controls v6. Embed the activation manifest for Windows MSVC test harnesses. The app binary uses Tauri's existing embedded manifest, with linker-generated manifests disabled for that binary to avoid duplicate resource ID 1. Native tests now execute, rather than merely compiling.
- Initial mailbox loading: replace overlapping interval reads with cancellable sequential reads. Stop promptly on successful empty-inbox sync or sync failure, and remove pending timers on account teardown. Delayed bootstrap work also respects teardown.
- Reader state: clear bodies, attachments and extracted actions when message/account/UID validity changes; ignore late responses. Reset conversation selection and display state with the owning message. Add regression coverage for account UID collisions, stale responses and mailbox resets.
- Compose toolbar: render the current editor through React state; retain the ref for imperative handlers.
- Frontend lifecycle: update callback refs after commit, use stable effect handlers for event subscriptions, remove redundant loader state and an unused animation timeline, and use external-store subscriptions for accent/developer preferences.
- Strict lint and Clippy: fix repository findings and remove unused native paths. Narrow `too_many_arguments` expectations preserve existing flat IPC/storage/SMTP boundaries with documented reasons. TanStack Virtual has a documented compiler-incompatibility exemption at its two call sites; React Compiler is not enabled. Cache deletion intentionally reloads the persistent inbox and has a local navigation-lint exemption.
- Dependencies: update Next and its ESLint configuration together, align TipTap packages, and refresh compatible dependency fixes. Convert the Tauri wrapper to ESM (`scripts/tauri.mjs`) and declare the package module type.
- Desktop checks now link the `app` executable as well as checking, linting and running native library tests. This catches binary resource/linker failures that `cargo check` and library-only tests cannot catch.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run check:all` | Passed after the final linker refinement: versions/catalog, TypeScript, strict global ESLint, all 67 frontend tests, Cargo check, strict all-target Clippy, all 87 Windows native tests, executable linking and production static export |
| Node unit tests | 42 passed |
| Vitest tests | 25 passed, including 3 additional reader isolation regressions |
| Windows native library tests | 87 passed; no ignored tests |
| `npm ls --depth=0` | Passed; no invalid direct dependency tree |
| `npm audit --omit=dev` | Zero advisories |
| `git diff --check` | Passed |
| `node scripts/tauri.mjs build --debug --no-bundle` | Passed: production static export and Windows executable compilation/linking |

The native test suite includes a loopback OAuth callback test; restricted sandboxes can deny socket creation. Run the suite in a Windows environment that permits local loopback sockets. This is distinct from the manifest failure, which occurred before any tests could start.

## Remaining checks and upstream notices

- Full dependency audit reports 16 moderate findings in the ESLint development dependency chain, rooted in `minimatch`. npm's proposed automatic fix downgrades ESLint/Next lint tooling across incompatible major versions. No forced audit fix or unverified major override was applied. Production dependencies have zero reported advisories.
- Cargo reports an upstream future-compatibility notice for `imap-proto 0.10.2` macro semicolons. Current native checks and tests pass. A parser migration needs separate compatibility work; do not silence the notice or claim it is fixed by application lint cleanup.
- Vitest's tooling emits a Node 26 `module.register()` deprecation notice; tests pass.
- Two-account live Google sign-in, provider send/reply/forward, reconnect, installed-app notification activation, and sign-out smoke checks remain manual. This pass did not send mail, alter real mailbox contents, or exercise the Windows installer. The executable build is a debug build without an installer or code signing.

No CI workflow, release tag, push, or publication was performed. The `0.1.0` release content remains a sample draft.
