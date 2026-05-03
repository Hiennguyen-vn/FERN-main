import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { clearSession } from '@/store/session.slice'
import { closeShift } from '@/hooks/use-session'

function formatVnd(cents: number) {
  return new Intl.NumberFormat('vi-VN').format(cents) + 'đ'
}

export default function CloseShiftPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const session = useAppSelector(s => s.session.current)
  const outboxDepth = useAppSelector(s => s.sync.outboxDepth)
  const [actualCash, setActualCash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!session) navigate('/open-shift', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!session) {
    return null
  }

  async function handleClose() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      await closeShift(session.id)
      dispatch(clearSession())
      navigate('/open-shift')
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Lỗi đóng ca'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const openedAt = new Date(session.opened_at)
  const durationMs = now - session.opened_at
  const durationH = Math.floor(durationMs / 3600000)
  const durationM = Math.floor((durationMs % 3600000) / 60000)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 space-y-6">
        <div className="text-center">
          <span className="text-green-600 font-bold text-2xl">FERN POS</span>
          <p className="text-gray-500 text-sm mt-1">Đóng ca bán hàng</p>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Ca mở lúc</span>
            <span className="font-medium">{openedAt.toLocaleTimeString('vi-VN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Thời gian</span>
            <span className="font-medium">{durationH}h {durationM}p</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Ngày kinh doanh</span>
            <span className="font-medium">{session.business_date?.slice(0, 10)}</span>
          </div>
        </div>

        {outboxDepth > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-sm text-yellow-800">
            Còn <strong>{outboxDepth} event</strong> chưa sync lên server. Vui lòng chờ sync xong trước khi đóng ca.
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tiền mặt thực tế cuối ca (VND)
          </label>
          <input
            type="number"
            value={actualCash}
            onChange={e => setActualCash(e.target.value)}
            placeholder="0"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {actualCash && (
          <div className="text-sm text-center text-gray-600">
            Tổng tiền thực tế: <strong>{formatVnd(parseFloat(actualCash) || 0)}</strong>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => navigate('/order')}
            className="flex-1 py-3 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Quay lại
          </button>
          <button
            onClick={handleClose}
            disabled={loading || outboxDepth > 0}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Đang đóng...' : 'Đóng ca'}
          </button>
        </div>
      </div>
    </div>
  )
}
