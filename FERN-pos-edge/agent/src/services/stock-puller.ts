import JSONBig from 'json-bigint'
import { fernClient } from '../upstream/fern-client.js'
import { pool } from '../db/pool.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'
import { publishLocalEvent } from './local-events.js'

const JSONBigStr = JSONBig({ storeAsString: true })

const INTERVAL_MS = 2 * 60 * 1000
let timer: NodeJS.Timeout | null = null
let running = false

type StockRow = {
  itemId?: string | number; item_id?: string | number
  outletId?: string | number; outlet_id?: string | number
  qtyOnHand?: string | number; qty_on_hand?: string | number
  lastMovementAt?: string | number | null; last_movement_at?: string | null
}

function parseMovementTime(value: string | number | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

export async function pullStock(): Promise<void> {
  if (running) return
  running = true
  try {
    const { rows: outboxRows } = await pool.query<{ pending: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM outbox_event
         WHERE status IN ('PENDING', 'SYNCING', 'FAILED')
       ) AS pending`
    )
    const resetReservations = !outboxRows[0]?.pending
    const resp = await fernClient.get<string>('/api/v1/sync/pull/stock', {
      params: { outlet_id: config.OUTLET_ID },
      transformResponse: [(data: string) => data],
    })
    const rows: StockRow[] = JSONBigStr.parse(resp.data)
    if (!Array.isArray(rows)) return
    const { rows: protectedMovementRows } = await pool.query<{ item_id: string; max_created_at_device: string | null; pending: boolean }>(
      `SELECT item_id::text,
              MAX(created_at_device)::text AS max_created_at_device,
              BOOL_OR(sync_status IN ('PENDING', 'SYNCING', 'FAILED', 'REJECTED')) AS pending
       FROM inventory_movement
       WHERE outlet_id = $1
         AND movement_type IN ('STOCK_IN_SIMPLE', 'WASTE')
         AND sync_status IN ('PENDING', 'SYNCING', 'FAILED', 'REJECTED', 'ACKED')
       GROUP BY item_id`,
      [config.OUTLET_ID]
    )
    const protectedItems = new Map(protectedMovementRows.map(row => [String(row.item_id), {
      pending: row.pending,
      maxCreatedAt: parseMovementTime(row.max_created_at_device),
    }]))
    for (const r of rows) {
      const itemId = r.itemId ?? r.item_id
      if (itemId == null) continue
      const protection = protectedItems.get(String(itemId))
      if (protection?.pending) continue
      const centralMovementAt = parseMovementTime(r.lastMovementAt ?? r.last_movement_at)
      if (protection?.maxCreatedAt != null && (centralMovementAt == null || centralMovementAt < protection.maxCreatedAt)) {
        continue
      }
      await pool.query(
        `INSERT INTO stock_balance (item_id, outlet_id, qty_on_hand, last_movement_at, synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (item_id, outlet_id) DO UPDATE SET
           qty_on_hand = EXCLUDED.qty_on_hand,
           last_movement_at = EXCLUDED.last_movement_at,
           qty_reserved_local = CASE
             WHEN $5::boolean THEN 0
             ELSE stock_balance.qty_reserved_local
           END,
           synced_at = NOW()`,
        [
          String(itemId),
          config.OUTLET_ID,
          r.qtyOnHand ?? r.qty_on_hand,
          r.lastMovementAt ? new Date(Number(r.lastMovementAt)).toISOString() : r.last_movement_at ?? null,
          resetReservations,
        ]
      )
    }
    if (resetReservations) {
      await pool.query(`DELETE FROM sale_inventory_reservation`)
    }
    publishLocalEvent('inventory.updated', {
      outlet_id: config.OUTLET_ID,
      rows: rows.length,
      reservations_reset: resetReservations,
    })
    logger.info({ count: rows.length }, 'stock pull complete')
  } catch (e) {
    logger.warn({ err: String(e) }, 'stock pull failed (likely offline)')
  } finally {
    running = false
  }
}

export function startStockPuller(): void {
  if (timer) return
  pullStock()
  timer = setInterval(pullStock, INTERVAL_MS)
}

export function stopStockPuller(): void {
  if (timer) { clearInterval(timer); timer = null }
}
