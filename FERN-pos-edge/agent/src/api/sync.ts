import type { FastifyInstance } from 'fastify'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { pullCatalog } from '../services/catalog-puller.js'
import { pullStock } from '../services/stock-puller.js'
import { pullRecipes } from '../services/recipe-puller.js'
import { deviceTokenStatus } from '../upstream/fern-client.js'
import { requireEdgeSession } from '../lib/edge-session.js'
import { publishLocalEvent } from '../services/local-events.js'

const PRIVILEGED_ROLES = new Set(['manager', 'outlet_manager', 'admin', 'superadmin'])

/**
 * Sync status endpoint — PWA queries agent for outbox depth, last sync times,
 * clock anchor. Mirrors /api/v1/sync/manifest but reports LOCAL state.
 */
export function registerSyncRoutes(app: FastifyInstance): void {
  app.post('/api/v1/sync/force-pull', async (req, reply) => {
    try {
      const session = requireEdgeSession(req)
      if (!PRIVILEGED_ROLES.has(session.role)) {
        return reply.code(403).send({ error: 'forbidden_role', message: 'force-pull requires manager role' })
      }
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
    await pool.query(`DELETE FROM device_meta WHERE key IN ('menu_version', 'catalog_cursor')`)
    void pullCatalog()
    void pullStock()
    void pullRecipes()
    return reply.send({ ok: true, message: 'pull triggered' })
  })

  app.get('/api/v1/sync/manifest', async (_req, reply) => {
    const [
      { rows: pending },
      { rows: failed },
      { rows: staleSyncing },
      { rows: meta },
      { rows: pendingSales },
      { rows: lastSyncRows },
      { rows: inventoryMovementRows },
    ] = await Promise.all([
      pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM outbox_event WHERE status = 'PENDING'`),
      pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM outbox_event WHERE status = 'FAILED'`),
      pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
         FROM outbox_event
         WHERE status = 'SYNCING'
           AND sync_started_at IS NOT NULL
           AND sync_started_at <= NOW() - INTERVAL '30 seconds'`
      ),
      pool.query<{ key: string, value: any, updated_at: string }>(
        `SELECT key, value, updated_at FROM device_meta
         WHERE key IN ('catalog_cursor', 'stock_cursor', 'recipe_cursor', 'menu_version', 'clock_anchor')`
      ),
      // Risk limit metrics: count + total cents of sale events still pending upstream forward.
      pool.query<{ cnt: string, total: string }>(
        `SELECT COUNT(*)::text AS cnt, COALESCE(SUM(s.total_cents), 0)::text AS total
         FROM outbox_event o
         LEFT JOIN sale_record s ON s.id = o.aggregate_id
         WHERE o.aggregate_type = 'sales' AND o.status = 'PENDING'`
      ),
      // Last successful upstream pull across catalog/stock/recipe cursors. If the device
      // hasn't pulled fresh data in N minutes, treat that as the offline-duration signal.
      pool.query<{ last_sync: string | null }>(
        `SELECT MAX(updated_at)::text AS last_sync
         FROM device_meta
         WHERE key IN ('catalog_cursor', 'stock_cursor', 'recipe_cursor')`
      ),
      pool.query<{ sync_status: string; n: string }>(
        `SELECT sync_status, COUNT(*)::text AS n
         FROM inventory_movement
         WHERE sync_status IN ('PENDING', 'SYNCING', 'FAILED', 'REJECTED')
         GROUP BY sync_status`
      ),
    ])
    const metaMap = Object.fromEntries(meta.map(m => [m.key, { value: m.value, updated_at: m.updated_at }]))
    const inventoryMovementCounts = Object.fromEntries(inventoryMovementRows.map(row => [
      row.sync_status.toLowerCase(),
      Number(row.n),
    ]))
    const lastUpstreamSyncAt = lastSyncRows[0]?.last_sync ?? null
    const offlineMinutes = lastUpstreamSyncAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(lastUpstreamSyncAt)) / 60_000))
      : null
    return reply.send({
      outlet_id: config.OUTLET_ID,
      outlet_name: config.OUTLET_NAME ?? null,
      outbox: {
        pending: Number(pending[0].n),
        failed: Number(failed[0].n),
        stale_syncing: Number(staleSyncing[0].n),
      },
      offline_risk: {
        pending_sale_count: Number(pendingSales[0].cnt),
        pending_sale_total_cents: Number(pendingSales[0].total),
        last_upstream_sync_at: lastUpstreamSyncAt,
        offline_minutes: offlineMinutes,
      },
      inventory_movements: {
        pending: inventoryMovementCounts.pending ?? 0,
        syncing: inventoryMovementCounts.syncing ?? 0,
        failed: inventoryMovementCounts.failed ?? 0,
        rejected: inventoryMovementCounts.rejected ?? 0,
        needs_review: (inventoryMovementCounts.failed ?? 0) + (inventoryMovementCounts.rejected ?? 0),
      },
      catalog_cursor: metaMap.catalog_cursor ?? null,
      stock_cursor: metaMap.stock_cursor ?? null,
      recipe_cursor: metaMap.recipe_cursor ?? null,
      menu_version: metaMap.menu_version?.value?.version ?? null,
      device_token: deviceTokenStatus(),
      clock_anchor: metaMap.clock_anchor?.value ?? null,
      server_time: new Date().toISOString(),
    })
  })

  app.get('/api/v1/sync/outbox', async (req, reply) => {
    try {
      requireEdgeSession(req)
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
    const q = req.query as { status?: string; limit?: string | number }
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 250)
    const statuses = String(q.status ?? '')
      .split(',')
      .map(status => status.trim().toUpperCase())
      .filter(status => ['PENDING', 'SYNCING', 'ACKED', 'FAILED'].includes(status))
    const params: unknown[] = [limit]
    const statusClause = statuses.length > 0 ? `WHERE o.status = ANY($2::text[])` : ''
    if (statuses.length > 0) params.push(statuses)
    const { rows } = await pool.query(
      `SELECT o.id::text, o.event_type, o.aggregate_type, o.aggregate_id::text,
              o.status, o.attempt_count, o.retry_after::text, o.last_error,
              o.client_occurred_at::text, o.created_at::text, o.synced_at::text,
              o.sync_started_at::text,
              im.event_id::text AS movement_event_id,
              im.movement_type,
              im.sync_status AS movement_sync_status,
              im.outlet_id::text AS movement_outlet_id,
              im.item_id::text AS movement_item_id,
              im.quantity::text AS movement_quantity,
              im.unit AS movement_unit,
              im.reason AS movement_reason,
              im.actor_username AS movement_actor_username,
              im.created_at_device::text AS movement_created_at_device,
              im.needs_review AS movement_needs_review,
              im.last_error AS movement_last_error
       FROM outbox_event o
       LEFT JOIN inventory_movement im ON im.outbox_event_id = o.id
       ${statusClause}
       ORDER BY o.created_at DESC
       LIMIT $1`,
      params
    )
    return reply.send({
      content: rows.map((row: any) => ({
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        status: row.status,
        attemptCount: Number(row.attempt_count ?? 0),
        retryAfter: row.retry_after,
        lastError: row.last_error,
        clientOccurredAt: row.client_occurred_at,
        createdAt: row.created_at,
        syncedAt: row.synced_at,
        syncStartedAt: row.sync_started_at,
        movement: row.movement_event_id ? {
          eventId: row.movement_event_id,
          movementType: row.movement_type,
          syncStatus: row.movement_sync_status,
          outletId: row.movement_outlet_id,
          itemId: row.movement_item_id,
          quantity: row.movement_quantity,
          unit: row.movement_unit,
          reason: row.movement_reason,
          actorUsername: row.movement_actor_username,
          createdAtDevice: row.movement_created_at_device,
          needsReview: row.movement_needs_review,
          lastError: row.movement_last_error,
        } : null,
      })),
    })
  })

  app.post('/api/v1/sync/outbox/:id/retry', async (req, reply) => {
    try {
      const session = requireEdgeSession(req)
      if (!PRIVILEGED_ROLES.has(session.role)) {
        return reply.code(403).send({ error: 'forbidden_role', message: 'retry requires manager role' })
      }
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
    const id = String((req.params as any).id ?? '')
    if (!/^\d+$/.test(id)) return reply.code(400).send({ error: 'invalid_id' })
    const result = await pool.query<{ event_type: string; aggregate_id: string }>(
      `UPDATE outbox_event
       SET status = 'PENDING',
           retry_after = NULL,
           last_error = NULL,
           sync_started_at = NULL,
           sync_attempt_id = NULL
       WHERE id = $1
         AND status = 'FAILED'
       RETURNING event_type, aggregate_id::text`,
      [id]
    )
    if ((result.rowCount ?? 0) === 0) {
      return reply.code(409).send({ error: 'not_retryable', message: 'Chỉ retry được event đang FAILED.' })
    }
    await pool.query(
      `UPDATE inventory_movement
       SET sync_status = 'PENDING',
           last_error = NULL,
           updated_at = NOW()
       WHERE outbox_event_id = $1`,
      [id]
    )
    const retried = result.rows[0]
    if (retried?.event_type === 'pos.payment.captured') {
      await pool.query(
        `UPDATE payment
         SET state = 'PENDING_OFFLINE',
             reconciled_at = NULL
         WHERE sale_id = $1
           AND state = 'FAILED'`,
        [retried.aggregate_id]
      )
    }
    publishLocalEvent('sync.updated', { retried: id })
    return reply.send({ ok: true })
  })
}
