# ADR 0001 — POS edge runtime: Tauri 2 + SQLite

**Status**: accepted
**Date**: 2026-04-25
**Deciders**: backend lead, ops, single-shop pilot manager

## Context

The POS edge today is a React 19 PWA backed by Dexie/IndexedDB. For a chain-cafe deployment we need:

- Hard offline operation across browser/tab close (no clearable storage).
- Local persistence of authenticated credentials so login works without internet.
- Direct ESC/POS printer access (USB + LAN) for receipts and cup labels.
- Cash drawer kick (RJ11/RJ12 via the printer or USB HID).
- Stable file-system-backed DB with ACID guarantees for sale/inventory ledgers.

The browser-based stack cannot reliably deliver any of those without a native shim.

## Options considered

1. **Electron** — well-known, large bundle (~100 MB), heavier RAM, slower startup on the cheap mini-PCs cafés use.
2. **Tauri 2** — Rust core, system webview, ~10–20 MB installer, native printer/USB crates available, supports Windows + macOS + Linux + Android. Same web stack reusable.
3. **Native Android/Kotlin** — best fit for tablet POS but rules out Windows mini-PC deployments and forces a UI rewrite.
4. **Stay on PWA** — fails the offline-credential and printer requirements; rejected.

## Decision

Adopt **Tauri 2** as the desktop wrapper.

- Reuse the existing React/Vite/Redux Toolkit code as-is. Tauri only adds the host shell.
- Persistence: SQLite via `tauri-plugin-sql` (rusqlite under the hood), one DB file per outlet.
- Credential cache: `tauri-plugin-stronghold` (or rust crate `argon2` + OS keychain via `keyring` crate) — replaces the PBKDF2 Web Crypto fallback shipped today.
- Printer: rust crate [`escpos-rs`](https://crates.io/crates/escpos) wrapped behind a Tauri command `printer::print_receipt(payload)`. USB via `rusb`, LAN via raw TCP on port 9100.
- Auto-update: Tauri updater signed with offline key.

## Migration plan

Rolled out in three steps so the web bundle stays runnable until the native shell ships:

1. **Now (this PR)**: introduce `src/auth/offline-auth.ts` and `deviceCredential` Dexie table using PBKDF2-SHA256 in Web Crypto. Also introduce `OfflineGrace` redux state used by guards. The web build is fully usable; nothing is Tauri-specific yet.
2. **Phase 3.1 follow-up branch**: scaffold `src-tauri/`, port Dexie data to SQLite via a one-shot import-on-first-run, swap `offline-auth` driver to keychain.
3. **Phase 3.4**: implement printer + cash drawer crate. Guard behind a feature flag so test devices without printers still work.

## Consequences

- One-time team ramp-up on Rust (≈1 week spike).
- CI gains a native build matrix (Windows + macOS + Linux).
- Bundle growth from ~3 MB (PWA) to ~15 MB (Tauri installer) — acceptable for outlet provisioning over 4G.
- The web PWA build is kept buildable for QA convenience but is no longer the production target.

## References

- Plan file `~/.claude/plans/b-n-l-chuy-n-gia-cozy-honey.md` — Phase 3.
- Tauri 2 docs: https://v2.tauri.app/
