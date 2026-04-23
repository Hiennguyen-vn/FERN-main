# ADR-002: PWA Windows Desktop Over Native

**Status**: Accepted
**Date**: 2026-04-23

## Context

POS client cần: offline, install-able, access USB printer + cash drawer, auto-update, cross-hardware.

Options: native (.NET WPF / Electron) vs PWA.

## Decision

**PWA chạy trên Windows Chrome/Edge (Chromium).**

- Target: Windows desktop + Chromium browser.
- Không support Safari/Firefox/iOS/Android cho MVP.
- Install qua Chrome `beforeinstallprompt` → shortcut desktop.
- Kiosk mode: `chrome --kiosk --app=https://pos.fern.vn`.
- Hardware: USB thermal printer + cash drawer qua Web Serial API hoặc native print dialog.

## Consequences

### Positive

- 1 codebase web cho admin + POS.
- Auto-update qua service worker (không cần deploy per machine).
- Background Sync, Push API, Periodic Sync đầy đủ Chromium.
- IndexedDB quota cao (60% disk).
- Không cần Windows dev skill.
- Zero app store approval.

### Negative

- Web Serial API không stable cho printer exotic — fallback dùng browser print dialog.
- Cash drawer trigger qua ESC/POS command via printer — cần test hardware.
- Chromium auto-update có thể break SW cache → test staging trước roll prod.

### Future

Nếu cần iPad/Android support → đánh giá Capacitor wrap (Phase IX).

## Alternatives Considered

1. **.NET WPF native**: full hardware access, ổn định. Loại vì lock Windows, chi phí dev cao, duplicate logic với web admin.
2. **Electron**: shared codebase với web. Loại vì overhead RAM + build complexity + vẫn là Chromium.
3. **React Native Android**: tablet cheap. Defer — khi cần mobile POS sẽ review.
