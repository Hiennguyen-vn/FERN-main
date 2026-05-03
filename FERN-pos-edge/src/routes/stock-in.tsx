import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppSelector } from '@/store/hooks'
import { inventoryApi } from '@/api/inventory-api'

const REASONS = [
  { value: 'EMERGENCY_RECEIPT', label: 'Nhận hàng gấp' },
  { value: 'STORE_TRANSFER', label: 'Chuyển từ kho/cửa hàng' },
  { value: 'COUNT_CORRECTION', label: 'Bù lệch kiểm kê' },
  { value: 'OTHER', label: 'Khác' },
]

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function StockInPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const outletId = useAppSelector(s => s.auth.outletId)
  const session = useAppSelector(s => s.session.current)

  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS[0].value)
  const [note, setNote] = useState('')
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey())
  const [createdAtDevice, setCreatedAtDevice] = useState(() => new Date().toISOString())
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const itemsQuery = useQuery({
    queryKey: ['stock-balances', outletId],
    queryFn: () => inventoryApi.listStockBalances(outletId!).then(r => r.data.content),
    enabled: outletId != null,
    staleTime: 60 * 1000,
  })

  const selectedItem = useMemo(
    () => itemsQuery.data?.find(item => String(item.itemId) === itemId),
    [itemsQuery.data, itemId],
  )

  function resetIdempotency() {
    setIdemKey(newIdempotencyKey())
    setCreatedAtDevice(new Date().toISOString())
    setSuccess(null)
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!outletId) throw new Error('Thiếu outlet')
      const quantity = Number(qty)
      return inventoryApi.createStockInSimple({
        outletId,
        itemId,
        quantity,
        reason,
        note: note.trim(),
        createdAtDevice,
      }, idemKey)
    },
    onSuccess: async response => {
      setSuccess(`Đã ghi local, trạng thái sync: ${response.data.syncStatus}`)
      setError(null)
      setItemId('')
      setQty('')
      setNote('')
      setReason(REASONS[0].value)
      setIdemKey(newIdempotencyKey())
      setCreatedAtDevice(new Date().toISOString())
      await queryClient.invalidateQueries({ queryKey: ['stock-balances', outletId] })
    },
    onError: err => {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data?.message
        ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err as Error)?.message
        ?? 'Lỗi ghi nhận nhập hàng'
      setError(msg)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const quantity = Number(qty)
    if (!itemId) {
      setError('Chọn nguyên liệu cần nhập')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Số lượng nhập phải lớn hơn 0')
      return
    }
    if (!note.trim()) {
      setError('Bắt buộc nhập ghi chú/lý do chi tiết')
      return
    }
    if (!session) {
      setError('Cần mở ca trước khi nhập hàng phát sinh')
      return
    }
    setError(null)
    setSuccess(null)
    mutation.mutate()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-8 space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/order')}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ← Quay lại
          </button>
          <span className="text-green-600 font-bold">Nhập hàng phát sinh</span>
          <div className="w-16" />
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nguyên liệu
            </label>
            {itemsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Đang tải...</div>
            ) : (
              <select
                value={itemId}
                onChange={e => {
                  setItemId(e.target.value)
                  resetIdempotency()
                }}
                required
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">-- Chọn nguyên liệu --</option>
                {itemsQuery.data?.map(item => (
                  <option key={item.itemId} value={String(item.itemId)}>
                    {item.itemName} ({item.baseUomCode}) - tồn {item.qtyOnHand}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Số lượng nhập {selectedItem ? `(${selectedItem.baseUomCode})` : ''}
            </label>
            <input
              type="number"
              value={qty}
              onChange={e => {
                setQty(e.target.value)
                resetIdempotency()
              }}
              min="0.001"
              step="0.001"
              required
              placeholder="0"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lý do
            </label>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map(r => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => {
                    setReason(r.value)
                    resetIdempotency()
                  }}
                  className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-colors ${
                    reason === r.value
                      ? 'bg-green-600 border-green-600 text-white'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ghi chú chi tiết
            </label>
            <textarea
              value={note}
              onChange={e => {
                setNote(e.target.value)
                resetIdempotency()
              }}
              rows={3}
              required
              placeholder="Ví dụ: nhận 10kg sữa từ kho tổng lúc 14:30"
              className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || !itemId || !qty || !note.trim()}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
          >
            {mutation.isPending ? 'Đang ghi local...' : 'Xác nhận nhập hàng'}
          </button>
        </form>
      </div>
    </div>
  )
}
