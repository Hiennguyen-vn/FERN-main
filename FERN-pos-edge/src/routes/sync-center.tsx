import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { syncApi, type SyncOutboxEvent } from '@/api/sync-api'
import { useSyncStatus } from '@/hooks/use-sync-status'

const STATUS_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING,SYNCING', label: 'Đang chờ' },
  { value: 'FAILED', label: 'Lỗi' },
  { value: 'ACKED', label: 'Đã ACK' },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  })
}

function statusClass(status: string): string {
  switch (status) {
    case 'ACKED':
      return 'bg-green-50 text-green-700'
    case 'FAILED':
    case 'REJECTED':
      return 'bg-red-50 text-red-700'
    case 'SYNCING':
      return 'bg-blue-50 text-blue-700'
    default:
      return 'bg-amber-50 text-amber-700'
  }
}

function eventLabel(event: SyncOutboxEvent): string {
  if (event.movement) {
    return event.movement.movementType === 'STOCK_IN_SIMPLE'
      ? 'Nhập hàng phát sinh'
      : event.movement.movementType === 'WASTE'
        ? 'Thất thoát'
        : event.movement.movementType
  }
  if (event.eventType === 'pos.sale.submitted') return 'Tạo đơn'
  if (event.eventType === 'pos.sale.approved') return 'Duyệt đơn'
  if (event.eventType === 'pos.payment.captured') return 'Thanh toán'
  if (event.eventType === 'pos.session.opened') return 'Mở ca'
  if (event.eventType === 'pos.session.closed') return 'Đóng ca'
  return event.eventType
}

export default function SyncCenterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const syncStatus = useSyncStatus()
  const [status, setStatus] = useState('PENDING,SYNCING,FAILED')

  const query = useQuery({
    queryKey: ['sync-outbox', status],
    queryFn: () => syncApi.listOutbox({ status, limit: 150 }).then(r => r.data.content),
    refetchInterval: 10_000,
  })

  const retryMutation = useMutation({
    mutationFn: (id: string) => syncApi.retryOutboxEvent(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sync-outbox'] })
    },
  })

  const rows = useMemo(() => query.data ?? [], [query.data])
  const failedRows = useMemo(
    () => rows.filter(row => row.status === 'FAILED' || row.movement?.syncStatus === 'REJECTED'),
    [rows],
  )

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/order')}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            ← Quay lại
          </button>
          <div>
            <h1 className="text-lg font-semibold">Sync Center</h1>
            <p className="text-xs text-gray-500">Theo dõi outbox local và movement tồn kho cần xử lý.</p>
          </div>
        </div>
        <select
          value={status}
          onChange={event => setStatus(event.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {STATUS_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </header>

      <main className="p-5 space-y-5">
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Outbox pending</div>
            <div className="text-2xl font-semibold">{syncStatus.outboxPending}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Syncing stale</div>
            <div className="text-2xl font-semibold">{syncStatus.staleSyncing}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Outbox failed</div>
            <div className="text-2xl font-semibold text-red-600">{syncStatus.outboxFailed}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Inventory pending</div>
            <div className="text-2xl font-semibold">{syncStatus.inventoryMovements.pending + syncStatus.inventoryMovements.syncing}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500">Cần review</div>
            <div className="text-2xl font-semibold text-red-600">{syncStatus.inventoryMovements.needsReview}</div>
          </div>
        </section>

        {failedRows.length > 0 && (
          <section className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            Có {failedRows.length} event lỗi hoặc bị reject. Kiểm tra `last_error`; correction tồn kho phải tạo movement mới.
          </section>
        )}

        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Local outbox</h2>
              <p className="text-xs text-gray-500">ACK nghĩa là central sync receiver đã nhận; ledger inventory có thể apply sau qua Kafka.</p>
            </div>
            {query.isFetching && <span className="text-xs text-gray-400">Đang cập nhật...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Movement</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Last error</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{eventLabel(row)}</div>
                      <div className="text-xs text-gray-500">{row.eventType} · #{row.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.status)}`}>
                        {row.status}
                      </span>
                      {row.movement && row.movement.syncStatus !== row.status && (
                        <div className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.movement.syncStatus)}`}>
                          {row.movement.syncStatus}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.movement ? (
                        <>
                          <div>{row.movement.quantity} {row.movement.unit}</div>
                          <div className="text-xs text-gray-500">Item #{row.movement.itemId} · {row.movement.reason}</div>
                        </>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.movement?.actorUsername ?? '-'}</td>
                    <td className="px-4 py-3">{row.attemptCount}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="truncate text-gray-600" title={row.movement?.lastError ?? row.lastError ?? undefined}>
                        {row.movement?.lastError ?? row.lastError ?? '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {row.status === 'FAILED' ? (
                        <button
                          onClick={() => retryMutation.mutate(row.id)}
                          disabled={retryMutation.isPending}
                          className="text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50"
                        >
                          Retry
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!query.isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                      Không có event phù hợp.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
