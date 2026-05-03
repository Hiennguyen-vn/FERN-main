import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAppSelector } from '@/store/hooks'
import { useSyncStatus } from '@/hooks/use-sync-status'

export function SwUpdateBanner() {
  const outboxDepth = useAppSelector(s => s.sync.outboxDepth)
  const session = useAppSelector(s => s.session.current)
  const { outboxPending } = useSyncStatus()

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()
  const canUpdate = needRefresh && outboxPending === 0 && outboxDepth === 0

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white text-sm rounded-xl px-4 py-3 shadow-xl max-w-sm w-full mx-4">
      <span className="flex-1">Có phiên bản mới. {!canUpdate && 'Đóng ca để cập nhật.'}</span>
      {canUpdate && (
        <button
          onClick={() => updateServiceWorker(true)}
          className="bg-green-500 hover:bg-green-400 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors"
        >
          Cập nhật
        </button>
      )}
      {!canUpdate && session && (
        <span className="text-xs text-gray-400">Chờ đóng ca</span>
      )}
    </div>
  )
}
