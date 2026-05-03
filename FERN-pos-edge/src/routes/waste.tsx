import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppSelector } from '@/store/hooks'
import { inventoryApi, type WasteReason } from '@/api/inventory-api'

const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: 'SPILL', label: 'Đổ / Tràn' },
  { value: 'EXPIRED', label: 'Hết hạn' },
  { value: 'TEST', label: 'Pha thử / Đào tạo' },
  { value: 'DAMAGED', label: 'Hư hỏng' },
  { value: 'OTHER', label: 'Khác' },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function WastePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const outletId = useAppSelector(s => s.auth.outletId)

  const [itemId, setItemId] = useState<string>('')
  const [qty, setQty] = useState<string>('')
  const [reason, setReason] = useState<WasteReason>('SPILL')
  const [note, setNote] = useState<string>('')
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey())
  const [createdAtDevice, setCreatedAtDevice] = useState(() => new Date().toISOString())
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const itemsQuery = useQuery({
    queryKey: ['stock-balances', outletId],
    queryFn: () => inventoryApi.listStockBalances(outletId!).then(r => r.data.content),
    enabled: outletId != null,
    staleTime: 5 * 60 * 1000,
  })

  function resetIdempotency() {
    setIdemKey(newIdempotencyKey())
    setCreatedAtDevice(new Date().toISOString())
    setSuccess(null)
  }

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof inventoryApi.createWaste>[0]) =>
      inventoryApi.createWaste(body, idemKey),
    onSuccess: async response => {
      setSuccess(`Đã ghi local, trạng thái sync: ${response.data.syncStatus}`)
      setItemId('')
      setQty('')
      setNote('')
      setReason('SPILL')
      setIdemKey(newIdempotencyKey())
      setCreatedAtDevice(new Date().toISOString())
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['stock-balances', outletId] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? (err as Error)?.message ?? 'Lỗi ghi nhận waste'
      setError(msg)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!outletId || !itemId || !qty) return
    const qtyNum = parseFloat(qty)
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setError('Số lượng không hợp lệ')
      return
    }
    setSuccess(null)
    setError(null)
    const item = itemsQuery.data?.find(i => String(i.itemId) === itemId)
    mutation.mutate({
      outletId,
      itemId,
      quantity: qtyNum,
      businessDate: todayIso(),
      unitCost: item?.unitCost ? parseFloat(item.unitCost) : null,
      reason,
      note: note.trim() || null,
      createdAtDevice,
    })
  }

  const selectedItem = itemsQuery.data?.find(i => String(i.itemId) === itemId)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/order')}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ← Quay lại
          </button>
          <span className="text-green-600 font-bold">Ghi nhận thất thoát</span>
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
                    {item.itemName} ({item.baseUomCode})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Số lượng {selectedItem ? `(${selectedItem.baseUomCode})` : ''}
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
              {WASTE_REASONS.map(r => (
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
              Ghi chú (tùy chọn)
            </label>
            <textarea
              value={note}
              onChange={e => {
                setNote(e.target.value)
                resetIdempotency()
              }}
              rows={2}
              placeholder="Mô tả thêm..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || !itemId || !qty}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
          >
            {mutation.isPending ? 'Đang ghi local...' : 'Xác nhận thất thoát'}
          </button>
        </form>
      </div>
    </div>
  )
}
