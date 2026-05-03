import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { pool, withTx } from '../db/pool.js'
import { config } from '../config.js'
import { nextId } from '../lib/snowflake.js'
import { requireEdgeSession, type EdgeSession } from '../lib/edge-session.js'
import { requireTerminalSession, type TerminalSession } from '../lib/terminal-session.js'
import { deviceTokenStatus } from '../upstream/fern-client.js'
import { appendOutbox } from '../services/outbox-writer.js'
import { publishLocalEvent } from '../services/local-events.js'

const idSchema = z.union([z.string(), z.number()]).transform(String)
  .refine(s => /^\d{1,32}$/.test(s), { message: 'invalid_id' })

const stockInSchema = z.object({
  outletId: idSchema,
  itemId: idSchema,
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v
    if (!Number.isFinite(n) || n <= 0 || n > config.STOCK_IN_MAX_QTY_PER_MOVEMENT) {
      ctx.addIssue({ code: 'custom', message: 'invalid_quantity' })
      return z.NEVER
    }
    return Number.parseFloat(n.toFixed(3)).toString()
  }),
  reason: z.string().trim().min(1).max(255),
  note: z.string().trim().min(1).max(500),
  createdAtDevice: z.string().datetime().optional(),
})

type StockInInput = z.infer<typeof stockInSchema>

const wasteSchema = z.object({
  outletId: idSchema,
  itemId: idSchema,
  quantity: z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v
    if (!Number.isFinite(n) || n <= 0 || n > config.WASTE_MAX_QTY_PER_MOVEMENT) {
      ctx.addIssue({ code: 'custom', message: 'invalid_quantity' })
      return z.NEVER
    }
    return Number.parseFloat(n.toFixed(3)).toString()
  }),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  unitCost: z.union([z.string(), z.number()]).nullable().optional(),
  reason: z.string().trim().min(1).max(255),
  note: z.string().trim().max(500).nullable().optional().transform(v => v?.trim() ?? ''),
  createdAtDevice: z.string().datetime().optional(),
})

type WasteInput = z.infer<typeof wasteSchema>

type ItemRow = {
  id: string
  sku: string | null
  name: string
  unit: string
}

type MovementRow = {
  event_id: string
  idempotency_key: string
  request_hash: string
  movement_type: string
  outlet_id: string
  item_id: string
  quantity: string
  unit: string
  reason: string
  note: string
  actor_user_id: string
  actor_username: string
  device_id: string | null
  pos_session_id: string
  terminal_id: string | null
  register_code: string | null
  business_date: string
  created_at_device: string
  needs_review: boolean
  sync_status: string
  outbox_event_id: string | null
  last_error: string | null
  created_at: string
}

function idemKey(req: { headers: Record<string, unknown> }): string | undefined {
  const v = req.headers['idempotency-key']
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return undefined
}

function requestHash(body: StockInInput): string {
  return createHash('sha256').update(JSON.stringify({
    outletId: body.outletId,
    itemId: body.itemId,
    quantity: body.quantity,
    reason: body.reason,
    note: body.note,
    createdAtDevice: body.createdAtDevice ?? null,
  })).digest('hex')
}

function wasteRequestHash(body: WasteInput): string {
  return createHash('sha256').update(JSON.stringify({
    outletId: body.outletId,
    itemId: body.itemId,
    quantity: body.quantity,
    businessDate: body.businessDate ?? null,
    unitCost: body.unitCost ?? null,
    reason: body.reason,
    note: body.note,
    createdAtDevice: body.createdAtDevice ?? null,
  })).digest('hex')
}

function requireDevicePair(): void {
  if (deviceTokenStatus().paired) return
  throw Object.assign(
    new Error('Mini server chưa pair Device JWT. Pair device trước khi nhập hàng phát sinh.'),
    { statusCode: 409, errorCode: 'device_pair_required' }
  )
}

function requireInventoryMovementPermission(auth: EdgeSession, action: string): void {
  const allowedRoles = new Set(['manager', 'outlet_manager', 'inventory_clerk', 'admin', 'superadmin'])
  if (auth.role && allowedRoles.has(auth.role)) return
  throw Object.assign(
    new Error(`User không có quyền ${action} trên mini server.`),
    { statusCode: 403, errorCode: 'forbidden_inventory_movement' }
  )
}

function requireOutletAccess(auth: EdgeSession, terminal: TerminalSession, outletId: string): void {
  if (!auth.allowed_outlet_ids.some(id => String(id) === outletId)) {
    throw Object.assign(new Error('forbidden_outlet'), { statusCode: 403 })
  }
  void terminal
}

async function loadHubDeviceId(client: PoolClient = pool as any): Promise<string | null> {
  const { rows } = await client.query<{ value: { device_id?: string | number } }>(
    `SELECT value FROM device_meta WHERE key = 'device_id' LIMIT 1`
  )
  const raw = rows[0]?.value?.device_id
  return raw == null ? null : String(raw).trim()
}

function toUpstreamDeviceId(deviceId: string | null): string | null {
  return deviceId && /^\d{13,}$/.test(deviceId) ? deviceId : null
}

function toBusinessDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function findOpenSession(client: PoolClient, outletId: string, registerCode: string) {
  const { rows } = await client.query<{
    id: string
    business_date: string
  }>(
    `SELECT id::text, business_date::text
     FROM pos_session
     WHERE outlet_id = $1
       AND register_code = $2
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1
     FOR UPDATE`,
    [outletId, registerCode]
  )
  return rows[0] ?? null
}

async function loadItem(client: PoolClient, itemId: string): Promise<ItemRow | null> {
  const { rows } = await client.query<ItemRow>(
    `SELECT id::text, sku, name, unit
     FROM item
     WHERE id = $1
     LIMIT 1`,
    [itemId]
  )
  return rows[0] ?? null
}

async function loadStockForUpdate(client: PoolClient, outletId: string, itemId: string) {
  const { rows } = await client.query<{ qty_on_hand: string; qty_reserved_local: string }>(
    `SELECT qty_on_hand::text, qty_reserved_local::text
     FROM stock_balance
     WHERE outlet_id = $1 AND item_id = $2
     FOR UPDATE`,
    [outletId, itemId]
  )
  return rows[0] ?? null
}

async function loadMovement(client: PoolClient, idempotencyKey: string): Promise<MovementRow | null> {
  const { rows } = await client.query<MovementRow>(
    `SELECT event_id::text, idempotency_key, request_hash, movement_type,
            outlet_id::text, item_id::text, quantity::text, unit, reason, note,
            actor_user_id::text, actor_username, device_id::text, pos_session_id::text,
            terminal_id, register_code, business_date::text, created_at_device::text,
            needs_review, sync_status, outbox_event_id::text, last_error, created_at::text
     FROM inventory_movement
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  )
  return rows[0] ?? null
}

function movementView(row: MovementRow) {
  return {
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    movementType: row.movement_type,
    outletId: row.outlet_id,
    itemId: row.item_id,
    quantity: row.quantity,
    unit: row.unit,
    reason: row.reason,
    note: row.note,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    deviceId: row.device_id,
    posSessionId: row.pos_session_id,
    terminalId: row.terminal_id,
    registerCode: row.register_code,
    businessDate: row.business_date,
    createdAtDevice: row.created_at_device,
    needsReview: row.needs_review,
    syncStatus: row.sync_status,
    outboxEventId: row.outbox_event_id,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

export function registerInventoryRoutes(app: FastifyInstance): void {
  app.post('/api/v1/inventory/stock-in-simple', async (req, reply) => {
    if (!config.OFFLINE_STOCK_IN_ENABLED) {
      return reply.code(403).send({
        error: 'offline_stock_in_disabled',
        message: 'offline_stock_in_enabled đang tắt trên mini server.',
      })
    }
    const parsed = stockInSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() })

    const key = idemKey(req)
    if (!key) return reply.code(400).send({ error: 'idempotency_key_required' })

    try {
      requireDevicePair()
      const auth = requireEdgeSession(req)
      const terminal = requireTerminalSession(req)
      requireInventoryMovementPermission(auth, 'inventory.stock_in.simple')
      requireOutletAccess(auth, terminal, parsed.data.outletId)

      const hash = requestHash(parsed.data)
      const createdAt = parsed.data.createdAtDevice ? new Date(parsed.data.createdAtDevice) : new Date()
      const result = await withTx(async client => {
        const existing = await loadMovement(client, key)
        if (existing) {
          if (existing.request_hash !== hash) {
            return {
              statusCode: 409,
              body: {
                error: 'idempotency_conflict',
                message: 'Idempotency-Key đã được dùng cho payload nhập hàng khác.',
              },
            }
          }
          return { statusCode: 200, body: movementView(existing) }
        }

        const session = await findOpenSession(client, parsed.data.outletId, terminal.register_code)
        if (!session) {
          return {
            statusCode: 409,
            body: {
              error: 'session_required',
              message: `Register ${terminal.register_code} chưa có ca mở trên mini server.`,
            },
          }
        }

        const count = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM inventory_movement
           WHERE pos_session_id = $1
             AND movement_type = 'STOCK_IN_SIMPLE'`,
          [session.id]
        )
        if (Number(count.rows[0]?.n ?? 0) >= config.STOCK_IN_MAX_MOVEMENTS_PER_SHIFT) {
          return {
            statusCode: 409,
            body: {
              error: 'stock_in_shift_limit_exceeded',
              message: 'Ca hiện tại đã vượt giới hạn số lần nhập hàng phát sinh offline.',
            },
          }
        }

        const item = await loadItem(client, parsed.data.itemId)
        if (!item) {
          return {
            statusCode: 404,
            body: {
              error: 'item_not_found',
              message: 'Nguyên liệu chưa có trong catalog local.',
            },
          }
        }

        const eventId = nextId()
        const hubDeviceId = await loadHubDeviceId(client)
        const upstreamDeviceId = toUpstreamDeviceId(hubDeviceId)
        await client.query(
          `INSERT INTO inventory_movement (
             event_id, idempotency_key, request_hash, movement_type,
             outlet_id, item_id, quantity, unit, reason, note,
             actor_user_id, actor_username, device_id, pos_session_id,
             terminal_id, register_code, business_date, created_at_device,
             source, needs_review, sync_status
           ) VALUES (
             $1,$2,$3,'STOCK_IN_SIMPLE',$4,$5,$6::numeric,$7,$8,$9,
             $10,$11,$12,$13,$14,$15,$16,$17,'POS_OFFLINE',TRUE,'PENDING'
           )`,
          [
            eventId,
            key,
            hash,
            parsed.data.outletId,
            parsed.data.itemId,
            parsed.data.quantity,
            item.unit,
            parsed.data.reason,
            parsed.data.note,
            auth.user_id,
            auth.username,
            hubDeviceId,
            session.id,
            terminal.register_code,
            terminal.register_code,
            session.business_date ?? toBusinessDate(createdAt),
            createdAt.toISOString(),
          ]
        )

        await client.query(
          `INSERT INTO stock_balance (item_id, outlet_id, qty_on_hand, last_movement_at, synced_at)
           VALUES ($1, $2, $3::numeric, $4, NOW())
           ON CONFLICT (item_id, outlet_id) DO UPDATE SET
             qty_on_hand = stock_balance.qty_on_hand + EXCLUDED.qty_on_hand,
             last_movement_at = EXCLUDED.last_movement_at`,
          [parsed.data.itemId, parsed.data.outletId, parsed.data.quantity, createdAt.toISOString()]
        )

        const payload = {
          event_id: eventId,
          eventId,
          source_event_id: eventId,
          sourceEventId: eventId,
          idempotency_key: key,
          idempotencyKey: key,
          movement_type: 'STOCK_IN_SIMPLE',
          movementType: 'STOCK_IN_SIMPLE',
          type: 'STOCK_IN_SIMPLE',
          outlet_id: parsed.data.outletId,
          outletId: parsed.data.outletId,
          device_id: upstreamDeviceId,
          deviceId: upstreamDeviceId,
          pos_session_id: session.id,
          posSessionId: session.id,
          terminal_id: terminal.register_code,
          terminalId: terminal.register_code,
          register_code: terminal.register_code,
          registerCode: terminal.register_code,
          actor_user_id: auth.user_id,
          actorUserId: auth.user_id,
          actor_username: auth.username,
          actorUsername: auth.username,
          item_id: parsed.data.itemId,
          itemId: parsed.data.itemId,
          sku: item.sku,
          quantity: parsed.data.quantity,
          unit: item.unit,
          reason: parsed.data.reason,
          note: parsed.data.note,
          business_date: session.business_date ?? toBusinessDate(createdAt),
          businessDate: session.business_date ?? toBusinessDate(createdAt),
          created_at_device: createdAt.toISOString(),
          createdAtDevice: createdAt.toISOString(),
          source: 'POS_OFFLINE',
          needs_review: true,
          needsReview: true,
        }
        const outboxEventId = await appendOutbox(client, {
          eventType: 'pos.inventory.stock-in.recorded',
          aggregateType: 'inventory',
          aggregateId: eventId,
          payload,
          clientOccurredAt: createdAt,
        })
        await client.query(
          `UPDATE inventory_movement
           SET outbox_event_id = $2, updated_at = NOW()
           WHERE event_id = $1`,
          [eventId, outboxEventId]
        )

        const inserted = await loadMovement(client, key)
        return { statusCode: 201, body: movementView(inserted!) }
      })

      publishLocalEvent('inventory.updated', {
        outlet_id: parsed.data.outletId,
        item_id: parsed.data.itemId,
        movement_type: 'STOCK_IN_SIMPLE',
      })
      return reply.code(result.statusCode).send(result.body)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 500).send({
        error: error.errorCode ?? 'stock_in_failed',
        message: String(error.message ?? error),
      })
    }
  })

  app.post('/api/v1/inventory/waste', async (req, reply) => {
    if (!config.OFFLINE_WASTE_ENABLED) {
      return reply.code(403).send({
        error: 'offline_waste_disabled',
        message: 'offline_waste_enabled đang tắt trên mini server.',
      })
    }
    const parsed = wasteSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() })

    const key = idemKey(req)
    if (!key) return reply.code(400).send({ error: 'idempotency_key_required' })

    try {
      requireDevicePair()
      const auth = requireEdgeSession(req)
      const terminal = requireTerminalSession(req)
      requireInventoryMovementPermission(auth, 'inventory.waste')
      requireOutletAccess(auth, terminal, parsed.data.outletId)

      const hash = wasteRequestHash(parsed.data)
      const createdAt = parsed.data.createdAtDevice ? new Date(parsed.data.createdAtDevice) : new Date()
      const result = await withTx(async client => {
        const existing = await loadMovement(client, key)
        if (existing) {
          if (existing.request_hash !== hash) {
            return {
              statusCode: 409,
              body: {
                error: 'idempotency_conflict',
                message: 'Idempotency-Key đã được dùng cho payload inventory khác.',
              },
            }
          }
          return { statusCode: 200, body: movementView(existing) }
        }

        const session = await findOpenSession(client, parsed.data.outletId, terminal.register_code)
        if (!session) {
          return {
            statusCode: 409,
            body: {
              error: 'session_required',
              message: `Register ${terminal.register_code} chưa có ca mở trên mini server.`,
            },
          }
        }

        const count = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
           FROM inventory_movement
           WHERE pos_session_id = $1
             AND movement_type = 'WASTE'`,
          [session.id]
        )
        if (Number(count.rows[0]?.n ?? 0) >= config.WASTE_MAX_MOVEMENTS_PER_SHIFT) {
          return {
            statusCode: 409,
            body: {
              error: 'waste_shift_limit_exceeded',
              message: 'Ca hiện tại đã vượt giới hạn số lần ghi nhận thất thoát offline.',
            },
          }
        }

        const item = await loadItem(client, parsed.data.itemId)
        if (!item) {
          return {
            statusCode: 404,
            body: {
              error: 'item_not_found',
              message: 'Nguyên liệu chưa có trong catalog local.',
            },
          }
        }

        const stock = await loadStockForUpdate(client, parsed.data.outletId, parsed.data.itemId)
        if (!stock) {
          return {
            statusCode: 409,
            body: {
              error: 'stock_snapshot_required',
              message: 'Chưa có tồn local cho nguyên liệu này. Cần sync tồn trước khi ghi nhận thất thoát.',
            },
          }
        }
        const onHand = Number.parseFloat(stock.qty_on_hand) || 0
        const reserved = Number.parseFloat(stock.qty_reserved_local) || 0
        const available = onHand - reserved
        const requested = Number.parseFloat(parsed.data.quantity)
        if (available + 0.000001 < requested) {
          return {
            statusCode: 409,
            body: {
              error: 'insufficient_local_stock',
              message: `Không đủ tồn local để ghi nhận thất thoát. Còn ${available.toFixed(3)}, cần ${requested.toFixed(3)} ${item.unit}.`,
            },
          }
        }

        const eventId = nextId()
        const hubDeviceId = await loadHubDeviceId(client)
        const upstreamDeviceId = toUpstreamDeviceId(hubDeviceId)
        const businessDate = parsed.data.businessDate ?? session.business_date ?? toBusinessDate(createdAt)
        await client.query(
          `INSERT INTO inventory_movement (
             event_id, idempotency_key, request_hash, movement_type,
             outlet_id, item_id, quantity, unit, reason, note,
             actor_user_id, actor_username, device_id, pos_session_id,
             terminal_id, register_code, business_date, created_at_device,
             source, needs_review, sync_status
           ) VALUES (
             $1,$2,$3,'WASTE',$4,$5,$6::numeric,$7,$8,$9,
             $10,$11,$12,$13,$14,$15,$16,$17,'POS_OFFLINE',TRUE,'PENDING'
           )`,
          [
            eventId,
            key,
            hash,
            parsed.data.outletId,
            parsed.data.itemId,
            parsed.data.quantity,
            item.unit,
            parsed.data.reason,
            parsed.data.note,
            auth.user_id,
            auth.username,
            hubDeviceId,
            session.id,
            terminal.register_code,
            terminal.register_code,
            businessDate,
            createdAt.toISOString(),
          ]
        )

        await client.query(
          `UPDATE stock_balance
           SET qty_on_hand = qty_on_hand - $3::numeric,
               last_movement_at = $4
           WHERE outlet_id = $1 AND item_id = $2`,
          [parsed.data.outletId, parsed.data.itemId, parsed.data.quantity, createdAt.toISOString()]
        )

        const payload = {
          event_id: eventId,
          eventId,
          source_event_id: eventId,
          sourceEventId: eventId,
          idempotency_key: key,
          idempotencyKey: key,
          movement_type: 'WASTE',
          movementType: 'WASTE',
          type: 'WASTE',
          outlet_id: parsed.data.outletId,
          outletId: parsed.data.outletId,
          device_id: upstreamDeviceId,
          deviceId: upstreamDeviceId,
          pos_session_id: session.id,
          posSessionId: session.id,
          terminal_id: terminal.register_code,
          terminalId: terminal.register_code,
          register_code: terminal.register_code,
          registerCode: terminal.register_code,
          actor_user_id: auth.user_id,
          actorUserId: auth.user_id,
          actor_username: auth.username,
          actorUsername: auth.username,
          item_id: parsed.data.itemId,
          itemId: parsed.data.itemId,
          sku: item.sku,
          quantity: parsed.data.quantity,
          unit: item.unit,
          unit_cost: parsed.data.unitCost == null ? null : String(parsed.data.unitCost),
          unitCost: parsed.data.unitCost == null ? null : String(parsed.data.unitCost),
          reason: parsed.data.reason,
          note: parsed.data.note,
          business_date: businessDate,
          businessDate,
          created_at_device: createdAt.toISOString(),
          createdAtDevice: createdAt.toISOString(),
          source: 'POS_OFFLINE',
          needs_review: true,
          needsReview: true,
        }
        const outboxEventId = await appendOutbox(client, {
          eventType: 'pos.inventory.waste.recorded',
          aggregateType: 'inventory',
          aggregateId: eventId,
          payload,
          clientOccurredAt: createdAt,
        })
        await client.query(
          `UPDATE inventory_movement
           SET outbox_event_id = $2, updated_at = NOW()
           WHERE event_id = $1`,
          [eventId, outboxEventId]
        )

        const inserted = await loadMovement(client, key)
        return { statusCode: 201, body: movementView(inserted!) }
      })

      publishLocalEvent('inventory.updated', {
        outlet_id: parsed.data.outletId,
        item_id: parsed.data.itemId,
        movement_type: 'WASTE',
      })
      return reply.code(result.statusCode).send(result.body)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 500).send({
        error: error.errorCode ?? 'waste_failed',
        message: String(error.message ?? error),
      })
    }
  })
}
