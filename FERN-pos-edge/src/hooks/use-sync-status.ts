import { useEffect, useState } from 'react'
import { http } from '@/api/http'

export interface OfflineRisk {
  pendingSaleCount: number
  pendingSaleTotalCents: number
  lastUpstreamSyncAt: number | null
  offlineMinutes: number | null
}

export interface SyncStatus {
  hubReachable: boolean
  catalogSyncedAt: number | null
  stockSyncedAt: number | null
  catalogAgeMinutes: number | null
  isStale: boolean  // catalog older than 15 min
  outboxPending: number
  staleSyncing: number
  outboxFailed: number
  menuVersion: number | null
  devicePaired: boolean
  deviceTokenExpiringSoon: boolean
  offlineRisk: OfflineRisk
  inventoryMovements: {
    pending: number
    syncing: number
    failed: number
    rejected: number
    needsReview: number
  }
  outletName: string | null
}

type AgentManifest = {
  outlet_name?: string | null
  outbox: { pending: number; stale_syncing?: number; failed: number }
  catalog_cursor: { value: unknown; updated_at: string } | null
  menu_version?: number
  device_token?: { paired: boolean; expiresAt: string | null; expiringSoon: boolean }
  clock_anchor: unknown
  server_time: string
  offline_risk?: {
    pending_sale_count: number
    pending_sale_total_cents: number
    last_upstream_sync_at: string | null
    offline_minutes: number | null
  }
  inventory_movements?: {
    pending: number
    syncing: number
    failed: number
    rejected: number
    needs_review: number
  }
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    hubReachable: true,
    catalogSyncedAt: null,
    stockSyncedAt: null,
    catalogAgeMinutes: null,
    isStale: false,
    outboxPending: 0,
    staleSyncing: 0,
    outboxFailed: 0,
    menuVersion: null,
    devicePaired: false,
    deviceTokenExpiringSoon: false,
    offlineRisk: {
      pendingSaleCount: 0,
      pendingSaleTotalCents: 0,
      lastUpstreamSyncAt: null,
      offlineMinutes: null,
    },
    inventoryMovements: {
      pending: 0,
      syncing: 0,
      failed: 0,
      rejected: 0,
      needsReview: 0,
    },
    outletName: null,
  })

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const { data } = await http.get<AgentManifest>('/sync/manifest')
        if (cancelled) return
        const catalogSyncedAt = data.catalog_cursor?.updated_at
          ? Date.parse(data.catalog_cursor.updated_at)
          : null
        const ageMs = catalogSyncedAt ? Date.now() - catalogSyncedAt : null
        const catalogAgeMinutes = ageMs != null ? Math.floor(ageMs / 60000) : null
        const risk = data.offline_risk
        setStatus({
          hubReachable: true,
          catalogSyncedAt,
          stockSyncedAt: null,
          catalogAgeMinutes,
          isStale: catalogAgeMinutes != null && catalogAgeMinutes > 15,
          outboxPending: data.outbox.pending,
          staleSyncing: data.outbox.stale_syncing ?? 0,
          outboxFailed: data.outbox.failed,
          menuVersion: data.menu_version ?? null,
          devicePaired: data.device_token?.paired ?? true,
          deviceTokenExpiringSoon: data.device_token?.expiringSoon ?? false,
          offlineRisk: {
            pendingSaleCount: risk?.pending_sale_count ?? 0,
            pendingSaleTotalCents: risk?.pending_sale_total_cents ?? 0,
            lastUpstreamSyncAt: risk?.last_upstream_sync_at ? Date.parse(risk.last_upstream_sync_at) : null,
            offlineMinutes: risk?.offline_minutes ?? null,
          },
          inventoryMovements: {
            pending: data.inventory_movements?.pending ?? 0,
            syncing: data.inventory_movements?.syncing ?? 0,
            failed: data.inventory_movements?.failed ?? 0,
            rejected: data.inventory_movements?.rejected ?? 0,
            needsReview: data.inventory_movements?.needs_review ?? 0,
          },
          outletName: data.outlet_name ?? null,
        })
      } catch {
        if (cancelled) return
        setStatus(current => ({ ...current, hubReachable: false }))
      }
    }
    poll()
    const id = setInterval(poll, 15_000)
    const onManifestInvalidated = () => { void poll() }
    const onReachability = (event: Event) => {
      const detail = (event as CustomEvent<{ reachable?: boolean }>).detail
      const reachable = detail?.reachable
      if (typeof reachable === 'boolean') {
        setStatus(current => ({ ...current, hubReachable: reachable }))
      }
    }
    window.addEventListener('hub:manifest-invalidated', onManifestInvalidated)
    window.addEventListener('hub:reachability', onReachability as EventListener)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('hub:manifest-invalidated', onManifestInvalidated)
      window.removeEventListener('hub:reachability', onReachability as EventListener)
    }
  }, [])

  return status
}
