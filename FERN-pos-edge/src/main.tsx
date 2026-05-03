import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { store } from './store'
import { setOnline } from './store/network.slice'
import { logout } from './store/auth.slice'
import { startAuditFlushLoop } from './sync/audit-flush'

// Dev-time SW kill-switch: unregister any leftover service worker from prior dev sessions.
// Production build re-registers via vite-plugin-pwa.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister())
  }).catch(() => { /* ignore */ })
}

// Wire up online/offline events to Redux
window.addEventListener('online', () => store.dispatch(setOnline(true)))
window.addEventListener('offline', () => store.dispatch(setOnline(false)))

// Drain audit ledger periodically. Boot-time flush also catches rows queued in a prior
// session that never finished their HTTP push.
startAuditFlushLoop(30_000)

// Clear auth state on 401 then redirect — avoids stale Redux state.
// Skip the redirect when we are already on /login: useAuthBootstrap legitimately fires
// /auth/me with no cookie on first load, which 401s. Without this guard the listener
// would reload /login → re-fire bootstrap → 401 → reload, infinite.
window.addEventListener('pos:unauthorized', () => {
  store.dispatch(logout())
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
