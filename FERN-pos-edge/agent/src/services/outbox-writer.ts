import type { PoolClient } from 'pg'
import { nextId } from '../lib/snowflake.js'
import { config } from '../config.js'

export type OutboxAppend = {
  eventType: string
  aggregateType: string
  aggregateId: string | number | bigint
  payload: unknown
  clientOccurredAt?: Date
}

/**
 * Append an event to the local outbox within caller's transaction.
 * Idempotency key: `sales:{device_id}:{event_type}:{event_id}`.
 */
export async function appendOutbox(client: PoolClient, evt: OutboxAppend): Promise<string> {
  const eventId = nextId()
  const deviceId = await resolveDeviceId(client)
  const idemKey = `${evt.aggregateType}:${deviceId}:${evt.eventType}:${eventId}`
  await client.query(
    `INSERT INTO outbox_event
      (id, event_type, idempotency_key, aggregate_type, aggregate_id, payload, status, client_occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', COALESCE($7, NOW()))`,
    [
      eventId,
      evt.eventType,
      idemKey,
      evt.aggregateType,
      String(evt.aggregateId),
      JSON.stringify(evt.payload),
      evt.clientOccurredAt ?? null,
    ]
  )
  return eventId
}

async function resolveDeviceId(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ value: { device_id?: string | number } }>(
    `SELECT value FROM device_meta WHERE key = 'device_id' LIMIT 1`
  )
  const metaDeviceId = rows[0]?.value?.device_id
  const resolved = metaDeviceId != null && String(metaDeviceId).trim() !== ''
    ? String(metaDeviceId).trim()
    : (config.DEVICE_ID?.trim() || 'local')
  return resolved
}
