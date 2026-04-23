# 02 — Service Worker + Background Sync Cross-Browser

Reality check về API web offline trên các browser FERN có thể gặp.

## Matrix Support (2026)

| API | Chrome/Edge | Firefox | Safari macOS | Safari iOS |
|---|---|---|---|---|
| **Service Worker** | ✅ | ✅ | ✅ | ✅ |
| **Cache API** | ✅ | ✅ | ✅ | ✅ |
| **IndexedDB** | ✅ | ✅ | ✅ | ✅ (quota thấp) |
| **Background Sync** (one-off) | ✅ | ❌ | ❌ | ❌ |
| **Periodic Background Sync** | ✅ (flag + PWA install) | ❌ | ❌ | ❌ |
| **Push API** | ✅ | ✅ | ✅ (macOS 13+) | ✅ (iOS 16.4+ chỉ PWA installed) |
| **Web App Manifest** | ✅ | ✅ | ✅ | ✅ (limited) |
| **BroadcastChannel** | ✅ | ✅ | ✅ | ✅ |
| **Storage Quota API** | ✅ | ✅ | ✅ | Partial |

Refs: [MDN Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) · [caniuse Background Sync](https://caniuse.com/background-sync) · [MDN Periodic Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API) · [Safari PWA Limitations 2026](https://docs.bswen.com/blog/2026-03-12-safari-pwa-limitations-ios/)

## Background Sync Thực Tế

### Chrome / Edge (Chromium)

- `SyncManager.register('tag')` queue event, replay khi online kể cả tab đã đóng.
- Workbox `BackgroundSyncPlugin` auto-retry failed POST.
- Periodic Sync: tối thiểu 12h interval, cần PWA installed.

### Firefox

- Không support Background Sync API cả ở desktop và mobile.
- Workbox fallback: retry khi SW start (khi tab mở).

### Safari (macOS + iOS)

- **Không support Background Sync** và chưa có dấu hiệu implement.
- iOS Safari: SW chỉ chạy khi tab đang foreground/visible.
- Push API iOS 16.4+ chỉ hoạt động khi PWA được install vào home screen.

## Fallback Strategy Bắt Buộc

Vì Safari + Firefox thiếu Background Sync, FERN phải có fallback layer:

### 1. Online Event Listener + Polling

```ts
window.addEventListener('online', () => flushOutbox());

// fallback: poll mỗi 15s khi tab active
setInterval(() => {
  if (navigator.onLine) flushOutbox();
}, 15_000);
```

### 2. Visibility-Aware Flush

Flush khi tab return foreground (user chuyển lại sang POS):

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushOutbox();
});
```

### 3. Workbox Dual Path

`vite-plugin-pwa` + Workbox BackgroundSyncPlugin:

- Chrome: queue trong SW, auto replay.
- Safari/Firefox: Workbox fallback retry khi SW active + main thread listener trên.

### 4. UI Reminder khi outbox non-empty

- Banner "Còn N đơn chưa sync — đừng tắt app" trước khi user rời trang (`beforeunload`).
- Mention rõ Safari iOS: "Giữ app mở đến khi banner tắt".

## IndexedDB Quota Thực Tế

| Browser | Quota mặc định | Max practical |
|---|---|---|
| Chrome desktop | 60% disk space | Nhiều GB |
| Firefox desktop | 50% free disk | Nhiều GB |
| Safari macOS | ~1 GB | 1 GB |
| Safari iOS | ~1 GB nhưng eviction mạnh sau 7 ngày không dùng | <1 GB |
| Chrome Android | 6% disk / 60% total | Vài trăm MB |

**Rủi ro iOS 7-day eviction**: nếu user không mở PWA trong 7 ngày, Safari iOS có thể xoá IndexedDB. Ảnh hưởng lớn nếu outlet đóng cửa lâu.

### Mitigation

1. `navigator.storage.persist()` request persistent storage (Chrome grant, Safari ignore).
2. Backup outbox lên server ngay khi online → không để outbox tồn quá lâu.
3. Catalog size cap: evict LRU, giữ top N product theo sale frequency.
4. Monitor `navigator.storage.estimate()` → cảnh báo khi >80%.
5. Đóng ca (close shift) bắt buộc outbox empty → forced flush.

## BroadcastChannel Multi-Tab Lock (Enforce 1 POS/outlet)

```ts
const channel = new BroadcastChannel('pos-leader');
let isLeader = false;

channel.addEventListener('message', (e) => {
  if (e.data.type === 'claim' && !isLeader) {
    // deny — another tab is leader
    showReadOnlyMode();
  }
});

// on load:
channel.postMessage({ type: 'claim', tabId });
setTimeout(() => { isLeader = true; }, 300); // no objection → become leader
```

- Support: Chrome, Firefox, Safari 15.4+, Edge.
- Fallback Safari cũ: localStorage lock với TTL timestamp.

## PWA Manifest iOS Quirks

- `display: standalone` OK.
- Icon cần cả PNG 180×180 cho iOS touch icon.
- Status bar styles: `apple-mobile-web-app-status-bar-style`.
- Splash screens: iOS yêu cầu nhiều size riêng.
- Install prompt: iOS không có `beforeinstallprompt` — phải có UI guide "Share → Add to Home Screen".

## Workbox Config Đề Xuất

```ts
// vite.config.ts
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
    runtimeCaching: [
      {
        urlPattern: /\/api\/v1\/sync\/pull\/catalog/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'catalog-cache',
          expiration: { maxAgeSeconds: 86400 },
        },
      },
      {
        urlPattern: /\/api\/v1\/sync\/push/,
        handler: 'NetworkOnly',
        options: {
          backgroundSync: {
            name: 'sync-push-queue',
            options: { maxRetentionTime: 24 * 60 }, // minutes
          },
        },
      },
      {
        urlPattern: /\/images\//,
        handler: 'CacheFirst',
        options: {
          cacheName: 'images-cache',
          expiration: { maxEntries: 500, maxAgeSeconds: 604800 },
        },
      },
    ],
  },
});
```

## Quyết Định Target Browser

Đề xuất:

- **Primary**: Chrome + Edge desktop (Windows/Mac POS). Background Sync đầy đủ.
- **Secondary**: Firefox desktop + Safari macOS. Fallback polling.
- **Tertiary**: Safari iOS (nếu dùng iPad). Fallback polling + UI warning + forced flush khi close shift.
- **Không support**: IE, old Android browser.

Document requirement trong README: "khuyến cáo Chrome/Edge cho POS".

## Open Questions

1. Outlet có dùng iPad POS không? → quyết định iOS support depth.
2. Có plan phát triển native app (Capacitor/React Native) không? → nếu có, Background Sync gap iOS sẽ được giải quyết bằng native BG task.
3. PWA có cần push notification không (ví dụ: "giá vừa thay đổi") → iOS 16.4+ yêu cầu install PWA.
