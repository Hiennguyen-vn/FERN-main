import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { logout } from '@/store/auth.slice'
import { useMenuList, usePosMenu } from '@/hooks/use-pos-menu'
import { useSyncStatus } from '@/hooks/use-sync-status'
import { MenuGrid } from '@/components/menu-grid'
import { CartPanel } from '@/components/cart-panel'
import { evaluateRiskLimits } from '@/store/risk-limits'

export default function OrderPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const auth = useAppSelector(s => s.auth)
  const session = useAppSelector(s => s.session.current)
  const sessionBootstrapped = useAppSelector(s => s.session.bootstrapped)
  const isOnline = useAppSelector(s => s.network.online)

  // Redirect to open-shift if no active session
  useEffect(() => {
    if (sessionBootstrapped && !session) navigate('/open-shift', { replace: true })
  }, [session, sessionBootstrapped, navigate])

  const syncStatus = useSyncStatus()
  const { data: menus, isLoading: menusLoading } = useMenuList()
  const [selectedMenuOverride, setSelectedMenuOverride] = useState<string | null>(null)
  const riskVerdict = evaluateRiskLimits({
    pendingCount: syncStatus.offlineRisk.pendingSaleCount,
    pendingTotalCents: syncStatus.offlineRisk.pendingSaleTotalCents,
    offlineMinutes: syncStatus.offlineRisk.offlineMinutes,
    pendingInventoryMovementCount: syncStatus.inventoryMovements.pending + syncStatus.inventoryMovements.syncing,
    inventoryNeedsReviewCount: syncStatus.inventoryMovements.needsReview,
    failedOutboxCount: syncStatus.outboxFailed,
  })
  const salesBlockedReason = !syncStatus.hubReachable
    ? 'Terminal đang mất kết nối tới mini server. Chỉ xem được dữ liệu đã cache, chưa thể bán tiếp.'
    : !syncStatus.devicePaired
      ? 'Mini server chưa pair Device JWT. Pair device trước khi mở ca hoặc bán hàng.'
      : riskVerdict.blocked
        ? riskVerdict.reason
        : null

  const defaultMenuId = useMemo(() => {
    if (!menus) return null
    const outlet = menus.find(m =>
      m.status === 'active' && (m.scopeId === auth.outletId || m.scopeType == null)
    )
    return outlet?.id ?? menus[0]?.id ?? null
  }, [menus, auth.outletId])
  const selectedMenuId = menus?.some(menu => menu.id === selectedMenuOverride)
    ? selectedMenuOverride
    : defaultMenuId

  const { categories, isLoading: menuLoading } = usePosMenu(selectedMenuId)
  const productNameById = useMemo(() => {
    const names = new Map<string, string>()
    for (const category of categories) {
      for (const item of category.items) {
        names.set(item.productId, item.productName)
      }
    }
    return names
  }, [categories])

  function handleLogout() {
    dispatch(logout())
    navigate('/login')
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Đang kiểm tra ca bán hàng...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-green-600 font-bold text-lg">FERN POS</span>
          {auth.outletId && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
              {syncStatus.outletName ?? `Outlet #${String(auth.outletId).slice(-6)}`}
            </span>
          )}
          <span className="text-xs text-gray-400">Ca: {session.business_date?.slice(0, 10)}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Sync status */}
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full
            ${!syncStatus.hubReachable
              ? 'bg-red-50 text-red-700'
              : (syncStatus.outboxPending > 0 || syncStatus.staleSyncing > 0 || syncStatus.outboxFailed > 0)
                ? 'bg-yellow-50 text-yellow-700'
                : 'bg-green-50 text-green-700'}`}>
            <span className={`w-2 h-2 rounded-full ${
              !syncStatus.hubReachable
                ? 'bg-red-400'
                : (syncStatus.outboxPending > 0 || syncStatus.staleSyncing > 0 || syncStatus.outboxFailed > 0)
                  ? 'bg-yellow-400'
                  : 'bg-green-400'
            }`} />
            {!syncStatus.hubReachable
              ? 'Mini server unreachable'
              : (syncStatus.outboxPending > 0 || syncStatus.staleSyncing > 0 || syncStatus.outboxFailed > 0)
                ? `${syncStatus.outboxPending} chờ sync`
                : 'Mini server OK'}
          </div>

          {syncStatus.hubReachable && !syncStatus.devicePaired && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-red-50 text-red-700">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              Chưa pair device
            </div>
          )}

          {syncStatus.hubReachable && syncStatus.devicePaired && syncStatus.deviceTokenExpiringSoon && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Token sắp hết hạn
            </div>
          )}

          {!isOnline && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Mất Internet upstream
            </div>
          )}

          {/* Cache age */}
          {syncStatus.catalogAgeMinutes != null && (
            <div className={`text-xs px-2 py-1 rounded-full ${syncStatus.isStale ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
              {syncStatus.isStale
                ? `Menu cũ ${syncStatus.catalogAgeMinutes}p`
                : `Menu ${syncStatus.catalogAgeMinutes === 0 ? 'vừa cập nhật' : `${syncStatus.catalogAgeMinutes}p trước`}`}
            </div>
          )}

          {/* Menu selector */}
          {menus && menus.length > 1 && (
            <select
              value={selectedMenuId ?? ''}
              onChange={e => setSelectedMenuOverride(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {menus.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}

          <span className="text-sm text-gray-600">{auth.displayName}</span>

          <button
            onClick={() => navigate('/stock-in')}
            className="text-xs text-green-700 hover:text-green-900 px-2 py-1 rounded hover:bg-green-50"
          >
            Nhập hàng
          </button>

          <button
            onClick={() => navigate('/waste')}
            className="text-xs text-yellow-600 hover:text-yellow-800 px-2 py-1 rounded hover:bg-yellow-50"
          >
            Thất thoát
          </button>

          <button
            onClick={() => navigate('/sync-center')}
            className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
          >
            Sync Center
          </button>

          <button
            onClick={() => navigate('/close-shift')}
            className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1 rounded hover:bg-orange-50"
          >
            Đóng ca
          </button>

          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Main layout: menu | cart */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {(menusLoading || menuLoading) ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-400">Đang tải thực đơn...</p>
            </div>
          ) : categories.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-400">Không có sản phẩm nào</p>
            </div>
          ) : (
            <MenuGrid categories={categories} disabled={Boolean(salesBlockedReason)} />
          )}
        </main>

        <aside className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col">
          <CartPanel
            hubReachable={syncStatus.hubReachable}
            salesBlockedReason={salesBlockedReason}
            productNameById={productNameById}
          />
        </aside>
      </div>
    </div>
  )
}
