import { db, type AuditAction, type AuditLocal } from '@/db/schema'
import { generateId } from '@/id/snowflake'
import { http } from '@/api/http'

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export type AuditInput = {
  action: AuditAction
  actorUserId: number | null
  actorUsername: string | null
  outletId: string | null
  deviceId: string | null
  targetType?: string | null
  targetId?: string | null
  payload: Record<string, unknown>
}

/** Append an audit row to Dexie. Always succeeds; flush is async best-effort. */
export async function recordAudit(input: AuditInput): Promise<string> {
  const eventId = generateId()
  const payloadStr = JSON.stringify(input.payload)
  const payloadSha = await sha256Hex(payloadStr)
  const row: AuditLocal = {
    event_id: eventId,
    actor_user_id: input.actorUserId,
    actor_username: input.actorUsername,
    outlet_id: input.outletId,
    device_id: input.deviceId,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    payload_json: payloadStr,
    payload_sha256: payloadSha,
    created_at_device: Date.now(),
    forwarded_at: null,
  }
  await db.auditLocal.put(row)
  // Best-effort fire-and-forget. flushAuditOnce() also runs periodically.
  void flushAuditOnce()
  return eventId
}

let flushing = false

/** Drain unforwarded rows. Idempotent — server uses event_id as idempotency key. */
export async function flushAuditOnce(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const allPending = await db.auditLocal
      .filter(r => r.forwarded_at == null || r.forwarded_at === 0)
      .limit(50)
      .toArray()
    if (allPending.length === 0) return
    try {
      await http.post('/audit/record', {
        events: allPending.map(r => ({
          event_id: r.event_id,
          actor_user_id: r.actor_user_id,
          actor_username: r.actor_username,
          outlet_id: r.outlet_id,
          device_id: r.device_id,
          action: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          payload: JSON.parse(r.payload_json),
          payload_sha256: r.payload_sha256,
          created_at_device: r.created_at_device,
        })),
      })
      const now = Date.now()
      await db.transaction('rw', db.auditLocal, async () => {
        for (const r of allPending) {
          await db.auditLocal.update(r.event_id, { forwarded_at: now })
        }
      })
    } catch (err) {
      // Network/agent unreachable — leave forwarded_at null and retry next tick.
      console.warn('[audit-flush] retry later', err)
    }
  } finally {
    flushing = false
  }
}

/** Wire into a periodic interval (e.g. every 30s) and on `online` event. */
export function startAuditFlushLoop(intervalMs = 30_000): () => void {
  const id = setInterval(() => { void flushAuditOnce() }, intervalMs)
  const onOnline = () => { void flushAuditOnce() }
  window.addEventListener('online', onOnline)
  return () => {
    clearInterval(id)
    window.removeEventListener('online', onOnline)
  }
}
