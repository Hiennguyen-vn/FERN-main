import { pool } from '../db/pool.js'
import { fernClient } from '../upstream/fern-client.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'
import { randomUUID } from 'node:crypto'
import { publishLocalEvent } from './local-events.js'

const TICK_MS = 1000
const BATCH_SIZE = 50
const MAX_ATTEMPTS = 10
const SYNCING_RECLAIM_SECONDS = 30
const PAYMENT_BEFORE_APPROVAL_REJECTION = 'Only approved orders can be marked as payment done'

let timer: NodeJS.Timeout | null = null
let running = false

type OutboxRow = {
  claim_order: number
  id: string
  event_type: string
  idempotency_key: string
  aggregate_type: string
  aggregate_id: string
  payload: any
  attempt_count: number
  client_occurred_at: string
  created_at: string
  sync_attempt_id: string | null
}

function backoffMs(attempt: number): number {
  const base = Math.pow(2, Math.min(attempt, 9)) * 1000
  return base + Math.floor(Math.random() * 500)
}

function isRetryableRejection(reason: string | undefined): boolean {
  if (!reason) return false
  const normalized = reason.trim()
  return normalized === PAYMENT_BEFORE_APPROVAL_REJECTION
    || normalized.startsWith('Transaction failed')
    || normalized.startsWith('Query failed:')
    || normalized.startsWith('Execute failed:')
    || normalized.startsWith('Sale not found:')
    || normalized.startsWith('POS session not found:')
    || normalized.startsWith('One or more items do not have enough stock')
    || normalized.startsWith('Session code already exists')
    || normalized.includes('Connection')
    || normalized.includes('timeout')
}

function compareClaimedRows(a: OutboxRow, b: OutboxRow): number {
  const claimOrder = Number(a.claim_order) - Number(b.claim_order)
  if (claimOrder !== 0) return claimOrder
  const createdAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  if (createdAt !== 0) return createdAt
  const aid = BigInt(a.id)
  const bid = BigInt(b.id)
  return aid < bid ? -1 : aid > bid ? 1 : 0
}

async function updateStockInMovements(
  rows: OutboxRow[],
  status: 'PENDING' | 'SYNCING' | 'ACKED' | 'FAILED' | 'REJECTED',
  lastError?: string | null,
  clearError = false,
): Promise<void> {
  const ids = rows
    .filter(row => row.event_type === 'pos.inventory.stock-in.recorded'
      || row.event_type === 'pos.inventory.waste.recorded')
    .map(row => row.id)
  if (ids.length === 0) return
  await pool.query(
    `UPDATE inventory_movement
     SET sync_status = $2,
         last_error = CASE
           WHEN $3::boolean THEN NULL
           WHEN $4::text IS NOT NULL THEN $4
           ELSE last_error
         END,
         updated_at = NOW()
     WHERE outbox_event_id = ANY($1::bigint[])`,
    [ids, status, clearError, lastError ?? null]
  )
}

async function loadDeviceId(): Promise<string> {
  const { rows } = await pool.query<{ value: { device_id?: string | number } }>(
    `SELECT value FROM device_meta WHERE key = 'device_id' LIMIT 1`
  )
  const metaDeviceId = rows[0]?.value?.device_id
  const resolved = metaDeviceId != null && String(metaDeviceId).trim() !== ''
    ? String(metaDeviceId).trim()
    : (config.DEVICE_ID?.trim() ?? '')
  if (!/^\d+$/.test(resolved)) {
    throw new Error('device_id_required')
  }
  return resolved
}

export async function drainOnce(): Promise<number> {
  const client = await pool.connect()
  try {
    const attemptId = randomUUID()
    await client.query('BEGIN')
    const { rows } = await client.query<OutboxRow>(
      `WITH locked AS (
         SELECT id, created_at
         FROM outbox_event
         WHERE (
           status = 'PENDING'
           AND (retry_after IS NULL OR retry_after <= NOW())
         ) OR (
           status = 'SYNCING'
           AND sync_started_at IS NOT NULL
           AND sync_started_at <= NOW() - ($2::int * INTERVAL '1 second')
         )
         ORDER BY created_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ),
       candidates AS (
         SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC))::int AS claim_order
         FROM locked
       )
       UPDATE outbox_event AS oe
       SET status = 'SYNCING',
           sync_started_at = NOW(),
           sync_attempt_id = $3
       FROM candidates
       WHERE oe.id = candidates.id
       RETURNING candidates.claim_order, oe.id, oe.event_type, oe.idempotency_key, oe.aggregate_type, oe.aggregate_id, oe.payload,
                 oe.attempt_count, oe.client_occurred_at, oe.created_at, oe.sync_attempt_id`,
      [BATCH_SIZE, SYNCING_RECLAIM_SECONDS, attemptId]
    )
    if (rows.length === 0) {
      await client.query('COMMIT')
      return 0
    }
    await client.query('COMMIT')
    const claimedRows = [...rows].sort(compareClaimedRows)
    await updateStockInMovements(claimedRows, 'SYNCING')

    // FERN SyncDtos.PushRequest/PushEvent use camelCase (default Jackson).
    // Use outbox row id as monotonicSeq — Snowflake IDs are monotonic per device.
    const events = claimedRows.map(r => ({
      eventId: r.id,
      type: r.event_type,
      idempotencyKey: r.idempotency_key,
      clientOccurredAt: r.client_occurred_at,
      estimatedTime: r.client_occurred_at,
      monotonicSeq: Number(BigInt(r.id) & BigInt(0xFFFF)),
      payload: r.payload,
    }))

    try {
      const deviceId = await loadDeviceId()
      const resp = await fernClient.post('/api/v1/sync/push', {
        deviceId,
        events,
      })
      const accepted = new Set<string>((resp.data?.accepted ?? []).map(String))
      const rejected: Array<{ eventId: string | number; reason: string }> = resp.data?.rejected ?? []
      const rejectedMap = new Map(rejected.map(r => [String(r.eventId), r.reason]))

      const ackIds = claimedRows.filter(r => accepted.has(r.id)).map(r => r.id)
      const rejectedRows = claimedRows.filter(r => rejectedMap.has(r.id))
      const retryRejectedRows = rejectedRows.filter(r => isRetryableRejection(rejectedMap.get(r.id)))
      const terminalRejectedRows = rejectedRows.filter(r => !isRetryableRejection(rejectedMap.get(r.id)))
      const failIds = terminalRejectedRows.map(r => r.id)
      const unknownIds = claimedRows
        .filter(r => !accepted.has(r.id) && !rejectedMap.has(r.id))
        .map(r => r.id)

      if (ackIds.length > 0) {
        await pool.query(
          `UPDATE outbox_event
           SET status='ACKED', synced_at=NOW(), sync_started_at=NULL, sync_attempt_id=NULL
           WHERE id = ANY($1::bigint[]) AND sync_attempt_id = $2`,
          [ackIds, attemptId]
        )
        await updateStockInMovements(claimedRows.filter(entry => accepted.has(entry.id)), 'ACKED', null, true)
        for (const row of claimedRows.filter(entry => accepted.has(entry.id))) {
          if (row.event_type === 'pos.payment.captured') {
            await pool.query(
              `UPDATE payment
               SET state = 'RECONCILED', reconciled_at = NOW()
               WHERE sale_id = $1`,
              [row.aggregate_id]
            )
          }
        }
      }
      for (const r of terminalRejectedRows) {
        await pool.query(
          `UPDATE outbox_event
           SET status='FAILED', last_error=$2, sync_started_at=NULL, sync_attempt_id=NULL
           WHERE id=$1 AND sync_attempt_id = $3`,
          [r.id, rejectedMap.get(r.id), attemptId]
        )
        await updateStockInMovements([r], 'REJECTED', rejectedMap.get(r.id) ?? 'rejected')
        if (r.event_type === 'pos.payment.captured') {
          await pool.query(
            `UPDATE payment
             SET state = 'FAILED'
             WHERE sale_id = $1`,
            [r.aggregate_id]
          )
        }
      }
      for (const r of retryRejectedRows) {
        const nextAttempt = r.attempt_count + 1
        const retryAfter = new Date(Date.now() + backoffMs(nextAttempt))
        await pool.query(
          `UPDATE outbox_event
           SET status='PENDING', attempt_count=$2, retry_after=$3, last_error=$4,
               sync_started_at=NULL, sync_attempt_id=NULL
           WHERE id=$1 AND sync_attempt_id = $5`,
          [r.id, nextAttempt, retryAfter, rejectedMap.get(r.id), attemptId]
        )
        await updateStockInMovements([r], 'PENDING', rejectedMap.get(r.id) ?? 'retryable_rejected')
      }
      if (unknownIds.length > 0) {
        // server didn't explicitly accept/reject — revert to PENDING for retry
        await pool.query(
          `UPDATE outbox_event
           SET status='PENDING', sync_started_at=NULL, sync_attempt_id=NULL
           WHERE id = ANY($1::bigint[]) AND sync_attempt_id = $2`,
          [unknownIds, attemptId]
        )
        await updateStockInMovements(claimedRows.filter(r => unknownIds.includes(r.id)), 'PENDING')
      }
      publishLocalEvent('sync.updated', {
        acked: ackIds.length,
        failed: failIds.length,
        unknown: unknownIds.length + retryRejectedRows.length,
      })
      logger.info({
        acked: ackIds.length,
        failed: failIds.length,
        unknown: unknownIds.length,
        retryableRejected: retryRejectedRows.length,
      }, 'outbox drain batch')
      return claimedRows.length
    } catch (err) {
      // network error — revert to PENDING with backoff
      for (const r of claimedRows) {
        const nextAttempt = r.attempt_count + 1
        if (nextAttempt >= MAX_ATTEMPTS) {
          await pool.query(
            `UPDATE outbox_event
             SET status='FAILED', attempt_count=$2, last_error=$3, sync_started_at=NULL, sync_attempt_id=NULL
             WHERE id=$1 AND sync_attempt_id = $4`,
            [r.id, nextAttempt, String(err), attemptId]
          )
          await updateStockInMovements([r], 'FAILED', String(err))
          if (r.event_type === 'pos.payment.captured') {
            await pool.query(
              `UPDATE payment
               SET state = 'FAILED'
               WHERE sale_id = $1`,
              [r.aggregate_id]
            )
          }
        } else {
          const retryAfter = new Date(Date.now() + backoffMs(nextAttempt))
          await pool.query(
            `UPDATE outbox_event
             SET status='PENDING', attempt_count=$2, retry_after=$3, last_error=$4,
                 sync_started_at=NULL, sync_attempt_id=NULL
             WHERE id=$1 AND sync_attempt_id = $5`,
            [r.id, nextAttempt, retryAfter, String(err), attemptId]
          )
          await updateStockInMovements([r], 'PENDING', String(err))
        }
      }
      publishLocalEvent('sync.updated', { acked: 0, failed: 0, unknown: claimedRows.length, error: String(err) })
      logger.warn({ err: String(err), batch: claimedRows.length }, 'outbox push failed, backoff')
      return 0
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error({ err: String(e) }, 'outbox drain tx error')
    return 0
  } finally {
    client.release()
  }
}

export function startOutboxRelay(): void {
  if (timer) return
  timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await drainOnce()
    } finally {
      running = false
    }
  }, TICK_MS)
}

export function stopOutboxRelay(): void {
  if (timer) { clearInterval(timer); timer = null }
}
