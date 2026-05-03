import { pool } from '../db/pool.js'
import { logger } from './logger.js'

export type CachedResponse = {
  statusCode: number
  body: unknown
}

/**
 * Lookup cached response for idempotency key. Returns null if not seen.
 */
export async function lookupIdempotent(idemKey: string): Promise<CachedResponse | null> {
  const { rows } = await pool.query<{ status_code: number; response_json: unknown }>(
    `SELECT status_code, response_json FROM local_idempotency WHERE idem_key = $1 LIMIT 1`,
    [idemKey],
  )
  if (rows.length === 0) return null
  return { statusCode: rows[0].status_code, body: rows[0].response_json }
}

/**
 * Persist response under idempotency key. Race-safe: ON CONFLICT DO NOTHING.
 */
export async function storeIdempotent(
  idemKey: string,
  endpoint: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO local_idempotency (idem_key, endpoint, status_code, response_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (idem_key) DO NOTHING`,
      [idemKey, endpoint, statusCode, JSON.stringify(body)],
    )
  } catch (err) {
    logger.error({ err, idemKey, endpoint }, 'idempotency store failed')
  }
}

/**
 * Wrap a handler with idempotency cache. The handler should return
 * { statusCode, body } and may throw — thrown errors are NOT cached
 * (caller should retry).
 */
export async function withIdempotency(
  idemKey: string | null | undefined,
  endpoint: string,
  handler: () => Promise<CachedResponse>,
): Promise<CachedResponse> {
  if (!idemKey) return handler()
  const cached = await lookupIdempotent(idemKey)
  if (cached) {
    logger.info({ idemKey, endpoint }, 'idempotent replay')
    return cached
  }
  const result = await handler()
  await storeIdempotent(idemKey, endpoint, result.statusCode, result.body)
  return result
}
