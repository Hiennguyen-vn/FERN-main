import { useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import {
  clearSession,
  sessionBootstrapComplete,
  sessionBootstrapStarted,
  setDevice,
  setSession,
} from '@/store/session.slice'
import { salesApi } from '@/api/sales-api'
import { http } from '@/api/http'
import { db } from '@/db/schema'
import type { PosSessionCache } from '@/db/schema'
import { consumeTerminalJustPaired, ensureTerminalPairing } from '@/lib/terminal-pairing'
import type { AppDispatch } from '@/store'

interface PosSessionView {
  id: string | number
  outletId: string | number
  managerId: string | number
  deviceId?: string | number | null
  registerCode?: string | null
  registerDisplayName?: string | null
  openedByUserId?: string | number | null
  openedByUsername?: string | null
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string | null
  businessDate: string
  cashFloat?: string | number | null
  note?: string | null
}

function toCachedSession(data: PosSessionView): PosSessionCache {
  return {
    id: String(data.id),
    outlet_id: String(data.outletId),
    manager_id: String(data.managerId),
    device_id: data.deviceId != null ? String(data.deviceId) : null,
    register_code: data.registerCode ?? null,
    register_display_name: data.registerDisplayName ?? null,
    opened_by_user_id: data.openedByUserId != null ? String(data.openedByUserId) : null,
    opened_by_username: data.openedByUsername ?? null,
    status: data.status,
    opened_at: Date.parse(data.openedAt),
    closed_at: data.closedAt ? Date.parse(data.closedAt) : null,
    business_date: data.businessDate,
    cash_float_cents: data.cashFloat ? Number(data.cashFloat) : 0,
    note: data.note ?? null,
  }
}

export async function refreshPairedDevice(dispatch: AppDispatch): Promise<string | null> {
  const paired = await ensureTerminalPairing()
  dispatch(setDevice({
    deviceId: paired.device_id,
    workerId: paired.worker_id,
    registerCode: paired.register_code ?? null,
    registerDisplayName: paired.display_name ?? null,
  }))
  return paired.register_code ?? null
}

export async function refreshCurrentSession(
  dispatch: AppDispatch,
  outletId: string,
  pairedRegisterCode?: string | null,
): Promise<PosSessionCache | null> {
  if (consumeTerminalJustPaired()) {
    dispatch(clearSession())
    return null
  }

  if (pairedRegisterCode) {
    try {
      const { data } = await http.get<PosSessionView | null>('/local/session/current')
      if (data) {
        const cached = toCachedSession(data)
        await db.sessions.put(cached)
        dispatch(setSession(cached))
        return cached
      }
    } catch {
      // fall back to cached register session if the mini server is temporarily unreachable
    }
  }

  const outletStr = String(outletId)
  function outletMatches(sessionOutletId: string): boolean {
    return String(sessionOutletId) === outletStr
  }
  let fallback: PosSessionCache | undefined
  if (pairedRegisterCode) {
    fallback = await db.sessions
      .filter(s => outletMatches(s.outlet_id) && s.status === 'open' && s.register_code === pairedRegisterCode)
      .first()
  }

  if (fallback) {
    dispatch(setSession(fallback))
    return fallback
  }

  dispatch(clearSession())
  return null
}

// Load the current register session from the mini server. Fall back to Dexie cache if the hub is unreachable.
export function useSessionBootstrap() {
  const dispatch = useAppDispatch()
  const auth = useAppSelector(s => s.auth)

  useEffect(() => {
    const outletId = auth.outletId
    if (outletId == null) return
    const currentOutletId = outletId
    let cancelled = false
    async function bootstrap() {
      dispatch(sessionBootstrapStarted())
      try {
        const pairedRegisterCode = await refreshPairedDevice(dispatch)
        if (cancelled) return
        await refreshCurrentSession(dispatch, currentOutletId, pairedRegisterCode)
      } catch {
        if (!cancelled) {
          await refreshCurrentSession(dispatch, currentOutletId)
        }
      } finally {
        if (!cancelled) dispatch(sessionBootstrapComplete())
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [auth.outletId, dispatch])
}

export async function openShift(outletId: string, cashFloat?: string, takeover?: boolean): Promise<PosSessionCache> {
  const paired = await ensureTerminalPairing()
  const { data } = await salesApi.openSession({ outletId, cashFloat, takeover })
  if (!data?.id) {
    throw new Error('Mini server không trả về thông tin ca vừa mở.')
  }
  const cached: PosSessionCache = {
    id: String(data.id),
    outlet_id: String(data.outletId),
    manager_id: String(data.managerId),
    device_id: data.deviceId != null ? String(data.deviceId) : (paired.device_id != null ? String(paired.device_id) : null),
    register_code: data.registerCode ?? paired.register_code ?? null,
    register_display_name: data.registerDisplayName ?? paired.display_name ?? null,
    opened_by_user_id: data.openedByUserId != null ? String(data.openedByUserId) : null,
    opened_by_username: data.openedByUsername ?? null,
    status: 'open',
    opened_at: Date.parse(data.openedAt),
    closed_at: data.closedAt ? Date.parse(data.closedAt) : null,
    business_date: data.businessDate,
    cash_float_cents: data.cashFloat ? Number(data.cashFloat) : 0,
    note: data.note ?? null,
  }
  await db.sessions.put(cached)
  return cached
}

export async function closeShift(sessionId: string): Promise<void> {
  const { data } = await http.get<{ outbox: { pending: number; stale_syncing?: number; failed: number } }>('/sync/manifest')
  if (data.outbox.pending > 0 || (data.outbox.stale_syncing ?? 0) > 0 || data.outbox.failed > 0) {
    throw new Error('Mini server còn dữ liệu chưa đồng bộ hoặc đang lỗi. Xử lý trong Sync Center trước khi đóng ca.')
  }
  await salesApi.closeSession(sessionId, {})
  await db.sessions.update(sessionId, { status: 'closed' })
}
