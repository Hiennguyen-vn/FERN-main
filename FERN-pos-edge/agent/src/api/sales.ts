/**
 * Local hub sales routes for LAN terminals.
 * Browser terminals talk only to this agent; the agent owns persistence + upstream sync.
 */
import type { FastifyInstance } from 'fastify'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import * as sales from '../services/sales-service.js'
import { pool, withTx } from '../db/pool.js'
import { appendOutbox } from '../services/outbox-writer.js'
import { config } from '../config.js'
import { requireEdgeSession } from '../lib/edge-session.js'
import { requireTerminalSession } from '../lib/terminal-session.js'
import { publishLocalEvent } from '../services/local-events.js'
import { deviceTokenStatus } from '../upstream/fern-client.js'
import { withIdempotency } from '../lib/idempotency.js'

function idemKey(req: { headers: Record<string, unknown> }): string | undefined {
  const v = req.headers['idempotency-key']
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  return undefined
}

// All IDs are string-encoded snowflakes (or numeric DB rows). Reject anything
// non-numeric: blocks SQL cast surprises and outlet/product spoofing via shaped strings.
const idSchema = z.union([z.string(), z.number()]).transform(String)
  .refine(s => /^\d{1,32}$/.test(s), { message: 'invalid_id' })

// Bounded finite non-negative decimal. Rejects "Infinity", "NaN", scientific bombs.
// Max chosen so qty * unit_price stays within safe int range when multiplied to cents.
function decimalSchema(max: number) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v
    if (!Number.isFinite(n) || n < 0 || n > max) {
      ctx.addIssue({ code: 'custom', message: 'invalid_amount' })
      return z.NEVER
    }
    return String(n)
  })
}

const QTY_MAX = 100_000
const MONEY_MAX = 1_000_000_000  // 1B cents = 10M VND, plenty of headroom

const saleLineRequestSchema = z.object({
  productId: idSchema,
  variantId: idSchema.optional(),
  modifierOptionIds: z.array(idSchema).max(50).default([]),
  quantity: decimalSchema(QTY_MAX),
  discountAmount: decimalSchema(MONEY_MAX).optional(),
  taxAmount: decimalSchema(MONEY_MAX).optional(),
  note: z.string().max(500).optional(),
})

const paymentRequestSchema = z.object({
  paymentMethod: z.string().max(32),
  amount: decimalSchema(MONEY_MAX),
  paymentTime: z.string().max(64).optional(),
  transactionRef: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
})

const submitSaleSchema = z.object({
  outletId: idSchema,
  posSessionId: idSchema.optional(),
  currencyCode: z.string().max(8).default('VND'),
  orderType: z.string().max(32).optional(),
  note: z.string().max(500).optional(),
  items: z.array(saleLineRequestSchema).min(1).max(200),
  payment: paymentRequestSchema.optional(),
  clientSaleId: idSchema.optional(),
})

const openPosSessionSchema = z.object({
  outletId: idSchema,
  cashFloat: decimalSchema(MONEY_MAX).optional(),
  takeover: z.coerce.boolean().optional(),
})

const closePosSessionSchema = z.object({
  closingCash: decimalSchema(MONEY_MAX).optional(),
  note: z.string().max(500).optional(),
})

type LocalModifierSelection = {
  modifier_option_id: string
  group_code: string | null
  group_name: string | null
  option_code: string | null
  option_name: string | null
  price_add_cents: number
}

type QueryExecutor = {
  query<T = any>(text: string, values?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>
}

function toCents(v: string | number | undefined, currency = 'VND'): number {
  if (v === undefined || v === null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return currency === 'VND' ? Math.round(n) : Math.round(n * 100)
}

function centsToString(c: number, currency = 'VND'): string {
  return currency === 'VND' ? String(c) : (c / 100).toFixed(2)
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return formatLocalDate(value)
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : formatLocalDate(parsed)
}

function requireOutletAccess(req: any, outletId: number | string) {
  const auth = requireEdgeSession(req)
  const terminal = requireTerminalSession(req)
  const outletStr = String(outletId)
  // Strict string equality. Earlier code did a 13-char prefix match "to tolerate JS Number
  // rounding"; that was an authz bypass (two outlets created in the same millisecond would
  // share the prefix). IDs flow as strings end-to-end, so precision is not at risk.
  if (!auth.allowed_outlet_ids.some(id => String(id) === outletStr)) {
    throw Object.assign(new Error('forbidden_outlet'), { statusCode: 403 })
  }
  // Terminal cookie outlet may be stale after OUTLET_ID change; re-pair is async on client.
  // Auth session outlet check above is the real guard; skip strict terminal outlet match.
  return { auth, terminal }
}

function requireDevicePair(): void {
  if (deviceTokenStatus().paired) return
  throw Object.assign(
    new Error('Mini server chưa pair Device JWT. Pair device trước khi mở ca hoặc bán hàng.'),
    { statusCode: 409, errorCode: 'device_pair_required' }
  )
}

async function loadHubDeviceId(): Promise<string | null> {
  const { rows } = await pool.query<{ value: { device_id?: string } }>(
    `SELECT value FROM device_meta WHERE key = 'device_id' LIMIT 1`
  )
  const raw = rows[0]?.value?.device_id
  return raw ? String(raw).trim() : null
}

function toUpstreamDeviceId(deviceId: string | null): string | null {
  return deviceId && /^\d{13,}$/.test(deviceId) ? deviceId : null
}

async function findOpenSessionForRegister(outletId: number | string, registerCode: string) {
  const { rows } = await pool.query<any>(
    `SELECT id, outlet_id, manager_id, opened_by_user_id, opened_by_username, device_id,
            register_code, register_display_name, status, opened_at, business_date, opening_cash, note
     FROM pos_session
     WHERE outlet_id = $1 AND register_code = $2 AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [outletId, registerCode]
  )
  return rows[0] ?? null
}

async function buildSessionView(sessionId: number | string, db: QueryExecutor = pool) {
  const { rows } = await db.query<any>(
    `SELECT id, outlet_id, manager_id, opened_by_user_id, opened_by_username, device_id,
            register_code, register_display_name, status, opened_at, closed_at,
            business_date, opening_cash, closing_cash, note
     FROM pos_session
     WHERE id = $1
     LIMIT 1`,
    [sessionId]
  )
  if (rows.length === 0) return null
  const row = rows[0]
  return {
    id: String(row.id),
    outletId: String(row.outlet_id),
    managerId: String(row.manager_id),
    openedByUserId: row.opened_by_user_id != null ? String(row.opened_by_user_id) : null,
    openedByUsername: row.opened_by_username,
    deviceId: row.device_id != null ? String(row.device_id) : null,
    registerCode: row.register_code,
    registerDisplayName: row.register_display_name,
    status: row.status,
    openedAt: new Date(row.opened_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    businessDate: dateOnly(row.business_date),
    cashFloat: centsToString(Number(row.opening_cash ?? 0), 'VND'),
    closingCash: row.closing_cash != null ? centsToString(Number(row.closing_cash), 'VND') : null,
    note: row.note ?? null,
  }
}

async function loadSaleModifiers(saleItemId: string | number) {
  const { rows } = await pool.query<any>(
    `SELECT modifier_option_id, group_code, group_name, option_code, option_name, price_add_cents
     FROM sale_item_modifier
     WHERE sale_item_id = $1
     ORDER BY modifier_option_id`,
    [saleItemId]
  )
  return rows.map(row => ({
    modifierOptionId: String(row.modifier_option_id),
    groupCode: row.group_code ?? null,
    groupName: row.group_name ?? null,
    optionCode: row.option_code ?? null,
    optionName: row.option_name ?? null,
    priceAddAmount: centsToString(Number(row.price_add_cents ?? 0), 'VND'),
  }))
}

async function buildSaleView(saleId: string, currencyCode: string) {
  const sale = await pool.query<any>(
    `SELECT id, outlet_id, pos_session_id, status, note, order_type,
            subtotal_cents, discount_cents, tax_cents, total_cents, created_at
     FROM sale_record
     WHERE id = $1`,
    [saleId]
  )
  if (sale.rowCount === 0) return null
  const s = sale.rows[0]
  const items = await pool.query<any>(
    `SELECT si.id, si.product_id, si.qty, si.unit_price_cents, si.discount_cents, si.tax_cents, si.line_total_cents,
            si.variant_id, si.variant_name, si.note,
            p.sku AS product_code, p.name AS product_name
     FROM sale_item si
     LEFT JOIN product p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [saleId]
  )
  const pay = await pool.query<any>(
    `SELECT id, method, amount_cents, state, paid_at, transaction_ref
     FROM payment
     WHERE sale_id = $1
     ORDER BY paid_at DESC
     LIMIT 1`,
    [saleId]
  )
  const itemViews = await Promise.all(items.rows.map(async item => ({
    productId: String(item.product_id),
    productCode: item.product_code ?? '',
    productName: item.product_name ?? '',
    quantity: String(item.qty),
    unitPrice: centsToString(Number(item.unit_price_cents), currencyCode),
    discountAmount: centsToString(Number(item.discount_cents), currencyCode),
    taxAmount: centsToString(Number(item.tax_cents), currencyCode),
    lineTotal: centsToString(Number(item.line_total_cents), currencyCode),
    variantId: item.variant_id != null ? String(item.variant_id) : null,
    variantName: item.variant_name ?? null,
    note: item.note ?? null,
    modifiers: await loadSaleModifiers(item.id),
  })))
  return {
    id: String(s.id),
    outletId: String(s.outlet_id),
    posSessionId: s.pos_session_id ? String(s.pos_session_id) : null,
    status: s.status,
    paymentStatus: (pay.rowCount ?? 0) > 0 ? pay.rows[0].state : 'PENDING',
    currencyCode,
    orderType: s.order_type ?? 'pos',
    subtotal: centsToString(Number(s.subtotal_cents), currencyCode),
    discount: centsToString(Number(s.discount_cents), currencyCode),
    taxAmount: centsToString(Number(s.tax_cents), currencyCode),
    totalAmount: centsToString(Number(s.total_cents), currencyCode),
    note: s.note ?? null,
    createdAt: new Date(s.created_at).toISOString(),
    items: itemViews,
    payment: (pay.rowCount ?? 0) > 0 ? {
      saleId: String(saleId),
      paymentMethod: pay.rows[0].method,
      amount: centsToString(Number(pay.rows[0].amount_cents), currencyCode),
      status: pay.rows[0].state,
      paymentTime: new Date(pay.rows[0].paid_at).toISOString(),
      transactionRef: pay.rows[0].transaction_ref ?? null,
      note: null,
    } : null,
  }
}

function priceModifierToCents(type: string, value: string | number | null | undefined, basePriceCents: number): number {
  const numeric = value == null ? 0 : Number(value)
  if (!Number.isFinite(numeric) || numeric === 0) return 0
  if (type === 'percentage') {
    return Math.round((basePriceCents * numeric) / 100)
  }
  if (type === 'fixed') {
    return Math.round(numeric)
  }
  return 0
}

async function resolveLocalLine(client: PoolClient, outletId: number | string, currencyCode: string, raw: z.infer<typeof saleLineRequestSchema>) {
  const { rows: priceRows } = await client.query(
    `SELECT DISTINCT ON (pp.product_id)
            pp.product_id,
            pp.price_cents,
            COALESCE(p.tax_basis_points, 0) AS tax_basis_points
     FROM product_price pp
     JOIN product p ON p.id = pp.product_id
     WHERE pp.outlet_id = $1
       AND pp.product_id = $2
       AND pp.effective_from <= NOW()
       AND (pp.effective_to IS NULL OR pp.effective_to > NOW())
     ORDER BY pp.product_id, pp.effective_from DESC`,
    [outletId, raw.productId]
  )
  if (priceRows.length === 0) {
    throw new Error(`Không tìm thấy giá cục bộ cho sản phẩm ${raw.productId}`)
  }
  const price = priceRows[0]
  const qty = typeof raw.quantity === 'string' ? parseFloat(raw.quantity) : raw.quantity
  const basePriceCents = Number(price.price_cents)
  let variantId: string | null = null
  let variantName: string | null = null
  let variantDeltaCents = 0
  if (raw.variantId != null) {
    const { rows: variantRows } = await client.query(
      `SELECT id, name, price_modifier_type, price_modifier_value
       FROM product_variant
       WHERE id = $1 AND product_id = $2 AND is_active = TRUE
       LIMIT 1`,
      [raw.variantId, raw.productId]
    )
    if (variantRows.length === 0) {
      throw new Error(`Variant ${raw.variantId} không hợp lệ cho sản phẩm ${raw.productId}`)
    }
    const variant = variantRows[0]
    variantId = String(variant.id)
    variantName = variant.name
    variantDeltaCents = priceModifierToCents(
      String(variant.price_modifier_type ?? 'none'),
      variant.price_modifier_value,
      basePriceCents
    )
  }

  const modifierOptionIds = [...new Set(raw.modifierOptionIds ?? [])]
  let modifiers: LocalModifierSelection[] = []
  if (modifierOptionIds.length > 0) {
    const { rows: modifierRows } = await client.query(
      `SELECT mo.id, mo.code AS option_code, mo.name AS option_name, mo.price_adjustment,
              mg.code AS group_code, mg.name AS group_name
       FROM product_modifier_group pmg
       JOIN modifier_group mg ON mg.id = pmg.modifier_group_id AND mg.is_active = TRUE
       JOIN modifier_option mo ON mo.modifier_group_id = mg.id AND mo.is_active = TRUE
       WHERE pmg.product_id = $1
         AND mo.id = ANY($2::bigint[])
       ORDER BY mg.display_order, mo.display_order, mo.id`,
      [raw.productId, modifierOptionIds]
    )
    if (modifierRows.length !== modifierOptionIds.length) {
      throw new Error(`Có modifier không hợp lệ cho sản phẩm ${raw.productId}`)
    }
    modifiers = modifierRows.map((row: any) => ({
      modifier_option_id: String(row.id),
      group_code: row.group_code ?? null,
      group_name: row.group_name ?? null,
      option_code: row.option_code ?? null,
      option_name: row.option_name ?? null,
      price_add_cents: Math.round(Number(row.price_adjustment ?? 0)),
    }))
  }
  const modifierDeltaCents = modifiers.reduce((sum, row) => sum + row.price_add_cents, 0)
  const unitPriceCents = basePriceCents + variantDeltaCents + modifierDeltaCents
  const discountCents = toCents(raw.discountAmount, currencyCode)
  const lineSubtotalCents = Math.round(unitPriceCents * qty)
  const taxableBaseCents = Math.max(0, lineSubtotalCents - discountCents)
  const taxCents = Math.round((taxableBaseCents * Number(price.tax_basis_points ?? 0)) / 10_000)
  return {
    product_id: raw.productId,
    qty: String(raw.quantity),
    unit_price_cents: unitPriceCents,
    discount_cents: discountCents,
    tax_cents: taxCents,
    line_total_cents: taxableBaseCents + taxCents,
    variant_id: variantId,
    variant_name: variantName,
    note: raw.note ?? null,
    modifiers,
  }
}

export function registerSalesRoutes(app: FastifyInstance): void {
  app.get('/api/v1/local/session/current', async (req, reply) => {
    try {
      const { terminal } = requireOutletAccess(req, config.OUTLET_ID)
      const current = await findOpenSessionForRegister(config.OUTLET_ID, terminal.register_code)
      if (!current) return reply.send(null)
      const view = await buildSessionView(current.id)
      return reply.send(view)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 401).send({ error: error.message ?? 'unauthorized' })
    }
  })
  app.get('/api/local/session/current', async (req, reply) => {
    try {
      requireOutletAccess(req, config.OUTLET_ID)
      const terminal = requireTerminalSession(req)
      const current = await findOpenSessionForRegister(config.OUTLET_ID, terminal.register_code)
      const view = current ? await buildSessionView(current.id) : null
      return reply.send(view)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 401).send({ error: error.message ?? 'unauthorized' })
    }
  })

  app.post('/api/v1/sales/orders', async (req, reply) => {
    const body = submitSaleSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })
    const data = body.data
    const key = idemKey(req)
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, data.outletId)
      const result = await withIdempotency(key, 'sales.submit', async () => {
        const hubDeviceId = await loadHubDeviceId()
        const session = data.posSessionId
          ? await buildSessionView(data.posSessionId)
          : await buildSessionView((await findOpenSessionForRegister(data.outletId, terminal.register_code))?.id ?? 0)
        if (!session) {
          return {
            statusCode: 409,
            body: {
              error: 'session_required',
              message: `Register ${terminal.register_code} chưa có ca mở trên mini server.`,
            },
          }
        }
        const items = await withTx(async client => {
          const resolved: Array<Awaited<ReturnType<typeof resolveLocalLine>>> = []
          for (const item of data.items) {
            resolved.push(await resolveLocalLine(client, data.outletId, data.currencyCode, item))
          }
          return resolved
        })
        const subtotalCents = items.reduce((sum, item) => sum + Math.round(item.unit_price_cents * parseFloat(item.qty)), 0)
        const discountCents = items.reduce((sum, item) => sum + (item.discount_cents ?? 0), 0)
        const taxCents = items.reduce((sum, item) => sum + (item.tax_cents ?? 0), 0)
        const totalCents = items.reduce((sum, item) => sum + item.line_total_cents, 0)

        const { sale_id } = await sales.submitSale({
          outlet_id: data.outletId,
          pos_session_id: String(session.id),
          device_id: hubDeviceId,
          register_code: terminal.register_code,
          terminal_id: terminal.register_code,
          cashier_id: auth.user_id,
          cashier_username: auth.username,
          items,
          subtotal_cents: subtotalCents,
          discount_cents: discountCents,
          tax_cents: taxCents,
          total_cents: totalCents,
          note: data.note ?? null,
          order_type: data.orderType ?? 'pos',
          client_sale_id: data.clientSaleId ?? null,
        })
        const view = await buildSaleView(sale_id, data.currencyCode)
        publishLocalEvent('sale.updated', {
          sale_id,
          status: 'submitted',
          pos_session_id: session.id,
        })
        return { statusCode: 200, body: view }
      })
      return reply.code(result.statusCode).send(result.body)
    } catch (error: any) {
      const code = error instanceof sales.StockConflictError ? 409 : (error.statusCode ?? 500)
      return reply.code(code).send({ error: 'submit_failed', message: String(error.message ?? error) })
    }
  })

  app.post('/api/v1/sales/orders/:saleId/approve', async (req, reply) => {
    const saleId = (req.params as any).saleId as string
    const key = idemKey(req)
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, config.OUTLET_ID)
      const result = await withIdempotency(key, 'sales.approve', async () => {
        const hubDeviceId = await loadHubDeviceId()
        await sales.approveSale({
          sale_id: saleId,
          outlet_id: config.OUTLET_ID,
          actor_user_id: auth.user_id,
          actor_username: auth.username,
          device_id: hubDeviceId,
          register_code: terminal.register_code,
          terminal_id: terminal.register_code,
        })
        const view = await buildSaleView(saleId, 'VND')
        publishLocalEvent('sale.updated', {
          sale_id: saleId,
          status: 'approved',
        })
        return { statusCode: 200, body: view }
      })
      return reply.code(result.statusCode).send(result.body)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 400).send({ error: 'approve_failed', message: String(error.message ?? error) })
    }
  })

  app.post('/api/v1/sales/orders/:saleId/mark-payment-done', async (req, reply) => {
    const saleId = (req.params as any).saleId as string
    const body = paymentRequestSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })
    const data = body.data
    const key = idemKey(req)
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, config.OUTLET_ID)
      if (data.paymentMethod.toLowerCase() !== 'cash') {
        return reply.code(409).send({
          error: 'offline_payment_method_not_allowed',
          message: 'Offline POS hiện chỉ cho phép thanh toán tiền mặt.',
        })
      }
      const result = await withIdempotency(key, 'sales.payment', async () => {
        const hubDeviceId = await loadHubDeviceId()
        await sales.capturePayment({
          sale_id: saleId,
          method: 'cash',
          amount_cents: toCents(data.amount, 'VND'),
          device_id: hubDeviceId,
          register_code: terminal.register_code,
          terminal_id: terminal.register_code,
          captured_by_user_id: auth.user_id,
          captured_by_username: auth.username,
          transaction_ref: data.transactionRef ?? null,
          note: data.note ?? null,
          client_occurred_at: data.paymentTime,
        })
        const view = await buildSaleView(saleId, 'VND')
        publishLocalEvent('sale.updated', {
          sale_id: saleId,
          status: 'paid',
        })
        return { statusCode: 200, body: view }
      })
      return reply.code(result.statusCode).send(result.body)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 500).send({ error: 'payment_failed', message: String(error.message ?? error) })
    }
  })

  app.post('/api/v1/sales/orders/:saleId/cancel', async (req, reply) => {
    const saleId = (req.params as any).saleId as string
    const body = z.object({ reason: z.string().optional() }).safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' })
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, config.OUTLET_ID)
      const hubDeviceId = await loadHubDeviceId()
      await sales.voidSale({
        sale_id: saleId,
        outlet_id: config.OUTLET_ID,
        reason: body.data.reason ?? 'cancelled',
        actor_user_id: auth.user_id,
        actor_username: auth.username,
        device_id: hubDeviceId,
        register_code: terminal.register_code,
        terminal_id: terminal.register_code,
      })
      const view = await buildSaleView(saleId, 'VND')
      publishLocalEvent('sale.updated', {
        sale_id: saleId,
        status: 'voided',
      })
      return reply.send(view)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 400).send({ error: 'void_failed', message: String(error.message ?? error) })
    }
  })

  app.post('/api/v1/sales/orders/:saleId/refund', async (_req, reply) => {
    return reply.code(409).send({
      error: 'offline_refund_disabled',
      message: 'Refund offline đang bị tắt. Thực hiện hoàn tiền khi POS đã online.',
    })
  })

  app.post('/api/v1/sales/pos-sessions', async (req, reply) => {
    const body = openPosSessionSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })
    const data = body.data
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, data.outletId)
      const existing = await findOpenSessionForRegister(data.outletId, terminal.register_code)
      if (existing) {
        const existingView = await buildSessionView(existing.id)
        if (!data.takeover) {
          return reply.code(409).send({
            error: 'register_in_use',
            warning_code: 'register_in_use',
            message: `Register ${terminal.register_code} đang có ca mở trên mini server.`,
            existingSession: existingView,
          })
        }
        return reply.send(existingView)
      }
      const hubDeviceId = await loadHubDeviceId()
      const upstreamDeviceId = toUpstreamDeviceId(hubDeviceId)
      const out = await withTx(async client => {
        const { rows: idRows } = await client.query<{ id: string }>(`SELECT nextval('pos_session_id_seq')::text AS id`)
        const id = idRows[0].id
        const businessDate = formatLocalDate(new Date())
        const openingCash = toCents(data.cashFloat, 'VND')
        await client.query(
          `INSERT INTO pos_session
            (id, outlet_id, manager_id, device_id, register_code, register_display_name,
             opened_by_user_id, opened_by_username, status, business_date, opening_cash, opened_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,NOW())`,
          [
            id,
            data.outletId,
            auth.user_id,
            hubDeviceId,
            terminal.register_code,
            terminal.display_name,
            auth.user_id,
            auth.username,
            businessDate,
            openingCash,
          ]
        )
        await appendOutbox(client, {
          eventType: 'pos.session.opened',
          aggregateType: 'sales',
          aggregateId: id,
          payload: {
            session_id: id,
            sessionId: id,
            device_id: upstreamDeviceId,
            deviceId: upstreamDeviceId,
            register_code: terminal.register_code,
            registerCode: terminal.register_code,
            terminal_id: terminal.register_code,
            terminalId: terminal.register_code,
            register_display_name: terminal.display_name,
            registerDisplayName: terminal.display_name,
            outlet_id: data.outletId,
            outletId: data.outletId,
            manager_user_id: auth.user_id,
            managerUserId: auth.user_id,
            actor_user_id: auth.user_id,
            actorUserId: auth.user_id,
            opened_by_username: auth.username,
            openedByUsername: auth.username,
            currency_code: 'VND',
            currencyCode: 'VND',
            business_date: businessDate,
            businessDate,
            opening_cash: openingCash,
            openingCash,
          },
        })
        return buildSessionView(id, client)
      })
      publishLocalEvent('session.updated', {
        session_id: out?.id ?? null,
        register_code: terminal.register_code,
        status: 'open',
      })
      return reply.send(out)
    } catch (error: any) {
      return reply.code(error.statusCode ?? 500).send({ error: 'session_open_failed', message: String(error.message ?? error) })
    }
  })

  app.post('/api/v1/sales/pos-sessions/:sessionId/close', async (req, reply) => {
    const sessionId = (req.params as any).sessionId as string
    const body = closePosSessionSchema.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })
    try {
      requireDevicePair()
      const { auth, terminal } = requireOutletAccess(req, config.OUTLET_ID)
      const pending = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
         FROM outbox_event
         WHERE status IN ('PENDING', 'SYNCING', 'FAILED')`
      )
      if (Number(pending.rows[0].n) > 0) {
        return reply.code(409).send({
          error: 'outbox_not_empty',
          pending: Number(pending.rows[0].n),
          message: 'Chờ sync hoàn tất trước khi đóng ca.',
        })
      }
      await withTx(async client => {
        const upstreamDeviceId = toUpstreamDeviceId(await loadHubDeviceId())
        const { rows } = await client.query<{ register_code: string }>(
          `SELECT register_code
           FROM pos_session
           WHERE id = $1
             AND status = 'open'
           FOR UPDATE`,
          [sessionId]
        )
        if (rows.length === 0) throw new Error('session not open')
        if (rows[0].register_code !== terminal.register_code) {
          throw Object.assign(new Error('register_mismatch'), { statusCode: 409 })
        }
        await client.query(
          `UPDATE pos_session
           SET status = 'closed',
               closing_cash = $2,
               note = COALESCE($3, note),
               closed_at = NOW()
           WHERE id = $1`,
          [sessionId, toCents(body.data.closingCash, 'VND'), body.data.note ?? null]
        )
        await appendOutbox(client, {
          eventType: 'pos.session.closed',
          aggregateType: 'sales',
          aggregateId: sessionId,
          payload: {
            session_id: sessionId,
            sessionId,
            outlet_id: config.OUTLET_ID,
            outletId: config.OUTLET_ID,
            device_id: upstreamDeviceId,
            deviceId: upstreamDeviceId,
            register_code: terminal.register_code,
            registerCode: terminal.register_code,
            terminal_id: terminal.register_code,
            terminalId: terminal.register_code,
            actor_user_id: auth.user_id,
            actorUserId: auth.user_id,
            actor_username: auth.username,
            actorUsername: auth.username,
            note: body.data.note ?? null,
          },
        })
      })
      publishLocalEvent('session.updated', {
        session_id: sessionId,
        register_code: terminal.register_code,
        status: 'closed',
      })
      return reply.send({ ok: true })
    } catch (error: any) {
      return reply.code(error.statusCode ?? 400).send({ error: 'session_close_failed', message: String(error.message ?? error) })
    }
  })
}
