import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/auth-api'
import { loginSuccess } from '@/store/auth.slice'
import { useAppDispatch } from '@/store/hooks'
import { ensureTerminalPairing } from '@/lib/terminal-pairing'
import { refreshCurrentSession } from '@/hooks/use-session'
import { recordAudit } from '@/sync/audit-flush'

const FALLBACK_OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000

export default function LoginPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await authApi.login({ username, pin })
      const { data: me } = await authApi.me()
      const primaryOutlet = me.scopes.find(s => s.role === 'cashier' || s.role === 'manager' || s.role === 'staff' || s.role === 'outlet_manager' || s.role === 'superadmin' || s.role === 'admin') ?? me.scopes[0]
      const outletId = primaryOutlet?.outlet_id != null ? String(primaryOutlet.outlet_id) : null
      let offlineGraceUntil = Date.now() + FALLBACK_OFFLINE_GRACE_MS
      try {
        const { data: lease } = await authApi.leaseOffline()
        const parsed = Date.parse(lease.offline_grace_until)
        if (!Number.isNaN(parsed)) {
          offlineGraceUntil = parsed
        }
      } catch {
        // Keep the local grace window aligned with cached credentials even if lease sync fails.
      }
      const paired = await ensureTerminalPairing()
      dispatch(loginSuccess({
        userId: me.id,
        displayName: me.display_name,
        outletId,
        scopes: me.scopes.map(s => `${s.outlet_id}:${s.role}`),
        offlineGraceUntil,
      }))
      // Audit ledger: track login session start. Forensic trail survives device wipe
      // because the row lands in Dexie before flushAuditOnce() ships it.
      void recordAudit({
        action: 'offline_login',
        actorUserId: me.id,
        actorUsername: me.username,
        outletId,
        deviceId: paired.device_id ?? null,
        targetType: 'session',
        targetId: null,
        payload: { method: 'pin', register_code: paired.register_code ?? null },
      })
      const currentSession = outletId && !paired.pairedNow
        ? await refreshCurrentSession(dispatch, outletId, paired.register_code ?? null)
        : null
      navigate(currentSession ? '/order' : '/open-shift')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message
      setError(msg ?? 'Đăng nhập thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">FERN POS</h1>
          <p className="text-sm text-gray-500 mt-1">Đăng nhập để bắt đầu ca</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tên đăng nhập
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mã PIN
            </label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value)}
              required
              inputMode="numeric"
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="PIN"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  )
}
