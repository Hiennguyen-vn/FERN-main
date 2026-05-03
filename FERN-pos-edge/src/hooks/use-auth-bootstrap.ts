import { useEffect } from 'react'
import { authApi } from '@/api/auth-api'
import { authBootstrapComplete, loginSuccess } from '@/store/auth.slice'
import { useAppDispatch, useAppSelector } from '@/store/hooks'

const FALLBACK_OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000

function primaryOutletId(scopes: Array<{ outlet_id: string; role: string }>): string | null {
  const primary = scopes.find(s =>
    s.role === 'cashier'
    || s.role === 'manager'
    || s.role === 'staff'
    || s.role === 'outlet_manager'
    || s.role === 'superadmin'
    || s.role === 'admin'
  ) ?? scopes[0]
  return primary?.outlet_id != null ? String(primary.outlet_id) : null
}

export function useAuthBootstrap() {
  const dispatch = useAppDispatch()
  const bootstrapped = useAppSelector(s => s.auth.bootstrapped)

  useEffect(() => {
    if (bootstrapped) return
    let cancelled = false

    async function bootstrap() {
      try {
        const { data: me } = await authApi.me()
        let offlineGraceUntil = Date.now() + FALLBACK_OFFLINE_GRACE_MS
        try {
          const { data: lease } = await authApi.leaseOffline()
          const parsed = Date.parse(lease.offline_grace_until)
          if (!Number.isNaN(parsed)) offlineGraceUntil = parsed
        } catch {
          // A valid local cookie is enough to restore the browser terminal session.
        }
        if (cancelled) return
        dispatch(loginSuccess({
          userId: me.id,
          displayName: me.display_name,
          outletId: primaryOutletId(me.scopes),
          scopes: me.scopes.map(s => `${s.outlet_id}:${s.role}`),
          offlineGraceUntil,
        }))
      } catch {
        if (!cancelled) dispatch(authBootstrapComplete())
      }
    }

    bootstrap()
    return () => { cancelled = true }
  }, [bootstrapped, dispatch])
}
