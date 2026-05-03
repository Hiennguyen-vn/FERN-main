import { http } from './http'

export interface SyncOutboxMovement {
  eventId: string
  movementType: 'STOCK_IN_SIMPLE' | 'WASTE' | string
  syncStatus: 'PENDING' | 'SYNCING' | 'ACKED' | 'FAILED' | 'REJECTED'
  outletId: string
  itemId: string
  quantity: string
  unit: string
  reason: string
  actorUsername: string
  createdAtDevice: string
  needsReview: boolean
  lastError: string | null
}

export interface SyncOutboxEvent {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  status: 'PENDING' | 'SYNCING' | 'ACKED' | 'FAILED'
  attemptCount: number
  retryAfter: string | null
  lastError: string | null
  clientOccurredAt: string
  createdAt: string
  syncedAt: string | null
  syncStartedAt: string | null
  movement: SyncOutboxMovement | null
}

export interface SyncOutboxResponse {
  content: SyncOutboxEvent[]
}

export const syncApi = {
  listOutbox: (params?: { status?: string; limit?: number }) =>
    http.get<SyncOutboxResponse>('/sync/outbox', { params }),
  retryOutboxEvent: (id: string) =>
    http.post<{ ok: boolean }>(`/sync/outbox/${id}/retry`),
}
