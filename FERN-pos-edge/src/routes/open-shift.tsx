import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { setSession } from '@/store/session.slice'
import { openShift } from '@/hooks/use-session'
import { useSyncStatus } from '@/hooks/use-sync-status'
import { deviceApi } from '@/api/device-api'
import { http } from '@/api/http'

export default function OpenShiftPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const auth = useAppSelector(s => s.auth)
  const isOnline = useAppSelector(s => s.network.online)
  const syncStatus = useSyncStatus()
  const [cashFloat, setCashFloat] = useState('')
  const [pairToken, setPairToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairMessage, setPairMessage] = useState<string | null>(null)
  const blockedReason = !syncStatus.hubReachable
    ? 'Terminal đang mất kết nối tới mini server. Không thể mở ca.'
    : !syncStatus.devicePaired
      ? 'Mini server chưa pair Device JWT. Pair device trước khi mở ca.'
      : null

  async function handlePairDevice(event: React.FormEvent) {
    event.preventDefault()
    if (!pairToken.trim()) {
      setError('Nhập pair token để pair mini server.')
      return
    }
    setPairing(true)
    setError(null)
    setPairMessage(null)
    try {
      const { data } = await deviceApi.pairHub({ pairToken: pairToken.trim() })
      setPairToken('')
      setPairMessage(`Đã pair device #${data.device_id}. Đang cập nhật đồng bộ...`)
      window.dispatchEvent(new CustomEvent('hub:manifest-invalidated'))
      await http.post('/sync/force-pull').catch(() => null)
      window.dispatchEvent(new CustomEvent('hub:manifest-invalidated'))
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Pair device thất bại'
      setError(msg)
    } finally {
      setPairing(false)
    }
  }

  async function handleOpen() {
    if (blockedReason) { setError(blockedReason); return }
    if (!auth.outletId) { setError('Không xác định được outlet. Vui lòng đăng xuất và đăng nhập lại.'); return }
    setLoading(true)
    setError(null)
    try {
      let session
      try {
        session = await openShift(
          auth.outletId,
          cashFloat ? (parseFloat(cashFloat) / 100).toFixed(2) : undefined
        )
      } catch (err: unknown) {
        const warningCode = (err as { response?: { data?: { warning_code?: string } } })?.response?.data?.warning_code
        if (warningCode === 'register_in_use') {
          const confirmed = window.confirm('Register này đang có ca mở trên mini server. Tiếp quản ca này?')
          if (!confirmed) return
          session = await openShift(
            auth.outletId,
            cashFloat ? (parseFloat(cashFloat) / 100).toFixed(2) : undefined,
            true
          )
        } else {
          throw err
        }
      }
      dispatch(setSession(session))
      navigate('/order')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? (err as Error)?.message ?? 'Lỗi mở ca'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 space-y-6">
        <div className="text-center">
          <span className="text-green-600 font-bold text-2xl">FERN POS</span>
          <p className="text-gray-500 text-sm mt-1">Mở ca bán hàng</p>
        </div>

        {!isOnline && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            Mất Internet upstream vẫn mở ca được nếu còn kết nối tới mini server trong cửa hàng.
          </div>
        )}

        {auth.outletId && (
          <p className="text-sm text-gray-500 text-center">
            Outlet #{String(auth.outletId).slice(-6)} · {auth.displayName}
          </p>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tiền mặt đầu ca (VND)
          </label>
          <input
            type="number"
            value={cashFloat}
            onChange={e => setCashFloat(e.target.value)}
            placeholder="0"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <p className="text-xs text-gray-400 mt-1">Để trống nếu không có tiền đầu ca</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
        {!error && blockedReason && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{blockedReason}</p>
        )}
        {syncStatus.hubReachable && !syncStatus.devicePaired && (
          <form onSubmit={handlePairDevice} className="rounded-xl border border-red-100 bg-red-50 p-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-red-700 mb-1">
                Pair token từ backend
              </label>
              <input
                type="password"
                value={pairToken}
                onChange={event => setPairToken(event.target.value)}
                placeholder="Dán pair token"
                autoComplete="one-time-code"
                className="w-full border border-red-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>
            <button
              type="submit"
              disabled={pairing || !pairToken.trim()}
              className="w-full py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {pairing ? 'Đang pair...' : 'Pair mini server'}
            </button>
          </form>
        )}
        {pairMessage && (
          <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{pairMessage}</p>
        )}

        <button
          onClick={handleOpen}
          disabled={loading || Boolean(blockedReason)}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Đang mở ca...' : 'Bắt đầu ca'}
        </button>
      </div>
    </div>
  )
}
