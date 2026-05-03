import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { logout } from '@/store/auth.slice'

const CHECK_INTERVAL_MS = 60_000

/**
 * Polls every minute for offline sessions whose grace window has expired.
 * Mount once at AppShell level.
 */
export function useOfflineGraceCheck() {
  const dispatch = useAppDispatch()
  const isOfflineSession = useAppSelector(s => s.auth.isOfflineSession)
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated)
  const graceUntil = useAppSelector(s => s.auth.offlineGraceUntil)

  useEffect(() => {
    if (!isAuthenticated || !isOfflineSession || graceUntil == null) return
    const id = setInterval(() => {
      if (Date.now() > graceUntil) {
        dispatch(logout())
      }
    }, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [dispatch, isAuthenticated, isOfflineSession, graceUntil])
}
