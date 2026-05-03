import type { PoolClient } from 'pg'
import { withTx } from '../db/pool.js'
import { nextId } from '../lib/snowflake.js'
import { formatQty, resolveReservationRequirements } from './inventory-engine.js'
import { appendOutbox } from './outbox-writer.js'

function toUpstreamMoney(value: number, currencyCode = 'VND'): string {
  return currencyCode === 'VND' ? String(value) : String(value / 100)
}

function toUpstreamDeviceId(deviceId: string | null): string | null {
  return deviceId && /^\d{13,}$/.test(deviceId) ? deviceId : null
}

function formatQtyForDisplay(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.parseFloat(value.toFixed(3)).toString()
}

export type SubmitSaleModifierInput = {
  modifier_option_id: string
  group_code?: string | null
  group_name?: string | null
  option_code?: string | null
  option_name?: string | null
  price_add_cents: number
}

export type SubmitSaleItemInput = {
  product_id: string
  qty: string | number
  unit_price_cents: number
  discount_cents?: number
  tax_cents?: number
  line_total_cents: number
  variant_id?: string | null
  variant_name?: string | null
  note?: string | null
  modifiers?: SubmitSaleModifierInput[]
}

export type SubmitSaleInput = {
  outlet_id: string
  pos_session_id: string
  device_id: string | null
  register_code: string
  terminal_id?: string | null
  cashier_id: string | number
  cashier_username: string
  items: SubmitSaleItemInput[]
  subtotal_cents: number
  discount_cents?: number
  tax_cents?: number
  total_cents: number
  note?: string | null
  order_type?: string | null
  client_occurred_at?: string
  client_sale_id?: string | null
}

export type ApproveSaleInput = {
  sale_id: string
  outlet_id: string
  actor_user_id: string | number
  actor_username: string
  device_id: string | null
  register_code: string
  terminal_id?: string | null
}

export type CapturePaymentInput = {
  sale_id: string
  method: 'cash'
  amount_cents: number
  device_id: string | null
  register_code: string
  terminal_id?: string | null
  captured_by_user_id: string | number
  captured_by_username: string
  transaction_ref?: string | null
  note?: string | null
  client_occurred_at?: string
}

export type VoidSaleInput = {
  sale_id: string
  outlet_id: string
  reason: string
  actor_user_id: string | number
  actor_username: string
  device_id: string | null
  register_code: string
  terminal_id?: string | null
}

type ExistingPaymentRow = {
  id: string
}

export class StockConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockConflictError'
  }
}

export async function submitSale(input: SubmitSaleInput): Promise<{ sale_id: string }> {
  return withTx(async (client) => {
    const saleId = input.client_sale_id && /^\d{13,}$/.test(input.client_sale_id)
      ? input.client_sale_id
      : nextId()
    await client.query(
      `INSERT INTO sale_record
        (id, outlet_id, pos_session_id, cashier_id, cashier_username, status, note, order_type,
         subtotal_cents, discount_cents, tax_cents, total_cents, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
      [
        saleId,
        input.outlet_id,
        input.pos_session_id,
        input.cashier_id,
        input.cashier_username,
        input.note ?? null,
        input.order_type ?? 'pos',
        input.subtotal_cents,
        input.discount_cents ?? 0,
        input.tax_cents ?? 0,
        input.total_cents,
      ]
    )
    await reserveStockForSale(client, saleId, input.outlet_id, input.items)
    for (const item of input.items) {
      const saleItemId = nextId()
      await client.query(
        `INSERT INTO sale_item
          (id, sale_id, product_id, qty, unit_price_cents, discount_cents, tax_cents, line_total_cents,
           variant_id, variant_name, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          saleItemId,
          saleId,
          item.product_id,
          item.qty,
          item.unit_price_cents,
          item.discount_cents ?? 0,
          item.tax_cents ?? 0,
          item.line_total_cents,
          item.variant_id ?? null,
          item.variant_name ?? null,
          item.note ?? null,
        ]
      )
      for (const modifier of item.modifiers ?? []) {
        await client.query(
          `INSERT INTO sale_item_modifier
            (sale_item_id, modifier_option_id, group_code, group_name, option_code, option_name, price_add_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (sale_item_id, modifier_option_id) DO UPDATE
           SET group_code = EXCLUDED.group_code,
               group_name = EXCLUDED.group_name,
               option_code = EXCLUDED.option_code,
               option_name = EXCLUDED.option_name,
               price_add_cents = EXCLUDED.price_add_cents`,
          [
            saleItemId,
            modifier.modifier_option_id,
            modifier.group_code ?? null,
            modifier.group_name ?? null,
            modifier.option_code ?? null,
            modifier.option_name ?? null,
            modifier.price_add_cents,
          ]
        )
      }
    }

    await appendOutbox(client, {
      eventType: 'pos.sale.submitted',
      aggregateType: 'sales',
      aggregateId: saleId,
      payload: {
        sale_id: saleId,
        saleId,
        outlet_id: input.outlet_id,
        outletId: input.outlet_id,
        pos_session_id: input.pos_session_id,
        posSessionId: input.pos_session_id,
        device_id: toUpstreamDeviceId(input.device_id),
        deviceId: toUpstreamDeviceId(input.device_id),
        register_code: input.register_code,
        registerCode: input.register_code,
        terminal_id: input.terminal_id ?? input.register_code,
        terminalId: input.terminal_id ?? input.register_code,
        cashier_user_id: String(input.cashier_id),
        cashierUserId: String(input.cashier_id),
        cashier_username: input.cashier_username,
        cashierUsername: input.cashier_username,
        actor_user_id: String(input.cashier_id),
        actorUserId: String(input.cashier_id),
        currency_code: 'VND',
        currencyCode: 'VND',
        order_type: input.order_type ?? 'pos',
        orderType: input.order_type ?? 'pos',
        note: input.note ?? null,
        items: input.items.map(item => ({
          product_id: item.product_id,
          productId: item.product_id,
          quantity: String(item.qty),
          discount_amount: toUpstreamMoney(item.discount_cents ?? 0, 'VND'),
          discountAmount: toUpstreamMoney(item.discount_cents ?? 0, 'VND'),
          tax_amount: toUpstreamMoney(item.tax_cents ?? 0, 'VND'),
          taxAmount: toUpstreamMoney(item.tax_cents ?? 0, 'VND'),
          note: item.note ?? null,
          variant_id: item.variant_id ?? null,
          variantId: item.variant_id ?? null,
          variant_name: item.variant_name ?? null,
          variantName: item.variant_name ?? null,
          modifier_option_ids: (item.modifiers ?? []).map(modifier => modifier.modifier_option_id),
          modifierOptionIds: (item.modifiers ?? []).map(modifier => modifier.modifier_option_id),
        })),
      },
      clientOccurredAt: input.client_occurred_at ? new Date(input.client_occurred_at) : new Date(),
    })

    return { sale_id: saleId }
  })
}

export async function approveSale(input: ApproveSaleInput): Promise<void> {
  await withTx(async (client) => {
    const { rows } = await client.query<{ pos_session_id: string }>(
      `UPDATE sale_record
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'submitted'
       RETURNING pos_session_id::text`,
      [input.sale_id]
    )
    if (rows.length === 0) throw new Error(`sale ${input.sale_id} not found or not in submitted state`)
    await appendOutbox(client, {
      eventType: 'pos.sale.approved',
      aggregateType: 'sales',
      aggregateId: input.sale_id,
      payload: {
        sale_id: input.sale_id,
        saleId: input.sale_id,
        outlet_id: input.outlet_id,
        outletId: input.outlet_id,
        pos_session_id: rows[0].pos_session_id,
        posSessionId: rows[0].pos_session_id,
        actor_user_id: String(input.actor_user_id),
        actorUserId: String(input.actor_user_id),
        actor_username: input.actor_username,
        actorUsername: input.actor_username,
        device_id: toUpstreamDeviceId(input.device_id),
        deviceId: toUpstreamDeviceId(input.device_id),
        register_code: input.register_code,
        registerCode: input.register_code,
        terminal_id: input.terminal_id ?? input.register_code,
        terminalId: input.terminal_id ?? input.register_code,
      },
    })
  })
}

export async function capturePayment(input: CapturePaymentInput): Promise<{ payment_id: string }> {
  return withTx(async (client) => {
    const { rows: saleRows } = await client.query<{
      total_cents: string
      status: string
      pos_session_id: string
      outlet_id: string
    }>(
      `SELECT total_cents, status, pos_session_id::text, outlet_id::text
       FROM sale_record
       WHERE id = $1
       LIMIT 1`,
      [input.sale_id]
    )
    if (saleRows.length === 0) {
      throw new Error(`sale ${input.sale_id} not found`)
    }
    const sale = saleRows[0]
    const totalCents = Number(sale.total_cents)
    if (input.amount_cents !== totalCents) {
      throw new Error(`payment amount mismatch: expected ${totalCents}, got ${input.amount_cents}`)
    }

    const existingPayment = await loadExistingPayment(client, input.sale_id)
    if (sale.status === 'paid' && existingPayment) {
      return { payment_id: existingPayment.id }
    }
    if (sale.status !== 'approved') {
      throw new Error(`sale ${input.sale_id} cannot be paid in status ${sale.status}`)
    }

    const paymentId = nextId()
    const capturedAt = input.client_occurred_at ?? new Date().toISOString()
    await client.query(
      `INSERT INTO payment
        (id, sale_id, method, amount_cents, state, paid_at, offline_captured_at,
         device_id, captured_by_user_id, captured_by_username)
       VALUES ($1,$2,$3,$4,'PENDING_OFFLINE',COALESCE($5::timestamptz, NOW()),
               COALESCE($5::timestamptz, NOW()),$6,$7,$8)`,
      [
        paymentId,
        input.sale_id,
        input.method,
        input.amount_cents,
        input.client_occurred_at ?? null,
        input.device_id,
        input.captured_by_user_id,
        input.captured_by_username,
      ]
    )
    await client.query(
      `UPDATE sale_record
       SET status = 'paid', updated_at = NOW()
       WHERE id = $1`,
      [input.sale_id]
    )
    await appendOutbox(client, {
      eventType: 'pos.payment.captured',
      aggregateType: 'sales',
      aggregateId: input.sale_id,
      payload: {
        sale_id: input.sale_id,
        saleId: input.sale_id,
        pos_session_id: sale.pos_session_id,
        posSessionId: sale.pos_session_id,
        outlet_id: sale.outlet_id,
        outletId: sale.outlet_id,
        device_id: toUpstreamDeviceId(input.device_id),
        deviceId: toUpstreamDeviceId(input.device_id),
        register_code: input.register_code,
        registerCode: input.register_code,
        terminal_id: input.terminal_id ?? input.register_code,
        terminalId: input.terminal_id ?? input.register_code,
        captured_by_user_id: String(input.captured_by_user_id),
        capturedByUserId: String(input.captured_by_user_id),
        captured_by_username: input.captured_by_username,
        capturedByUsername: input.captured_by_username,
        actor_user_id: String(input.captured_by_user_id),
        actorUserId: String(input.captured_by_user_id),
        amount: toUpstreamMoney(input.amount_cents, 'VND'),
        payment_method: input.method,
        paymentMethod: input.method,
        transaction_ref: input.transaction_ref ?? null,
        transactionRef: input.transaction_ref ?? null,
        note: input.note ?? null,
        client_occurred_at: capturedAt,
        clientOccurredAt: capturedAt,
      },
      clientOccurredAt: new Date(capturedAt),
    })
    return { payment_id: paymentId }
  })
}

export async function voidSale(input: VoidSaleInput): Promise<void> {
  await withTx(async (client) => {
    const { rows: outletRows } = await client.query<{ outlet_id: string; pos_session_id: string }>(
      `SELECT outlet_id::text, pos_session_id::text
       FROM sale_record
       WHERE id = $1`,
      [input.sale_id]
    )
    const { rowCount } = await client.query(
      `UPDATE sale_record
       SET status = 'voided', updated_at = NOW()
       WHERE id = $1 AND status IN ('submitted','approved')`,
      [input.sale_id]
    )
    if (rowCount === 0) throw new Error(`sale ${input.sale_id} cannot be voided in current state`)
    if (outletRows.length > 0) {
      await releaseStockReservation(client, outletRows[0].outlet_id, input.sale_id)
    }
    await appendOutbox(client, {
      eventType: 'pos.sale.voided',
      aggregateType: 'sales',
      aggregateId: input.sale_id,
      payload: {
        sale_id: input.sale_id,
        saleId: input.sale_id,
        outlet_id: input.outlet_id,
        outletId: input.outlet_id,
        pos_session_id: outletRows[0]?.pos_session_id ?? null,
        posSessionId: outletRows[0]?.pos_session_id ?? null,
        device_id: toUpstreamDeviceId(input.device_id),
        deviceId: toUpstreamDeviceId(input.device_id),
        register_code: input.register_code,
        registerCode: input.register_code,
        terminal_id: input.terminal_id ?? input.register_code,
        terminalId: input.terminal_id ?? input.register_code,
        actor_user_id: String(input.actor_user_id),
        actorUserId: String(input.actor_user_id),
        actor_username: input.actor_username,
        actorUsername: input.actor_username,
        reason: input.reason,
      },
    })
  })
}

export async function refundSale(): Promise<void> {
  throw new Error('offline_refund_disabled')
}

async function loadExistingPayment(client: PoolClient, saleId: string): Promise<ExistingPaymentRow | null> {
  const { rows } = await client.query<ExistingPaymentRow>(
    `SELECT id::text
     FROM payment
     WHERE sale_id = $1
     LIMIT 1`,
    [saleId]
  )
  return rows[0] ?? null
}

async function reserveStockForSale(
  client: PoolClient,
  saleId: string,
  outletId: string,
  items: SubmitSaleItemInput[]
): Promise<void> {
  if (items.length === 0) return
  let requirements: Awaited<ReturnType<typeof resolveReservationRequirements>>
  try {
    requirements = await resolveReservationRequirements(client, items)
  } catch (error) {
    if (error instanceof StockConflictError) {
      throw error
    }
    throw new StockConflictError(error instanceof Error ? error.message : 'Không thể tính BOM cục bộ cho đơn hàng.')
  }
  if (requirements.length === 0) return

  const requestedByItem = new Map<string, { qty: number; strict: boolean; productIds: Set<string> }>()
  for (const requirement of requirements) {
    const existing = requestedByItem.get(requirement.itemId)
    if (existing) {
      existing.qty += requirement.qty
      existing.strict = existing.strict || requirement.strict
      existing.productIds.add(requirement.productId)
    } else {
      requestedByItem.set(requirement.itemId, {
        qty: requirement.qty,
        strict: requirement.strict,
        productIds: new Set([requirement.productId]),
      })
    }
  }

  const itemIds = [...requestedByItem.keys()]
  const { rows } = await client.query<{
    item_id: string
    item_name: string | null
    unit: string | null
    qty_on_hand: string
    qty_reserved_local: string
  }>(
    `SELECT sb.item_id, i.name AS item_name, i.unit,
            sb.qty_on_hand::text, sb.qty_reserved_local::text
     FROM stock_balance sb
     LEFT JOIN item i ON i.id = sb.item_id
     WHERE sb.outlet_id = $1
       AND sb.item_id = ANY($2::bigint[])
     FOR UPDATE OF sb`,
    [outletId, itemIds]
  )
  const rowByItem = new Map(rows.map(row => [String(row.item_id), row]))
  for (const [itemId, requirement] of requestedByItem.entries()) {
    const row = rowByItem.get(itemId)
    if (!row) {
      if (requirement.strict) {
        throw new StockConflictError(
          `Thiếu snapshot tồn cục bộ cho nguyên liệu #${itemId}. Cần sync tồn trước khi bán sản phẩm có recipe.`
        )
      }
      continue
    }
    const onHand = Number.parseFloat(row.qty_on_hand) || 0
    const reserved = Number.parseFloat(row.qty_reserved_local) || 0
    const available = onHand - reserved
    if (available + 0.000001 < requirement.qty) {
      const itemLabel = row.item_name?.trim() || `#${itemId}`
      const unit = row.unit?.trim() || ''
      const availableText = `${formatQtyForDisplay(available)}${unit ? ` ${unit}` : ''}`
      const requiredText = `${formatQtyForDisplay(requirement.qty)}${unit ? ` ${unit}` : ''}`
      throw new StockConflictError(
        `Không đủ tồn cục bộ cho ${itemLabel}. Còn ${availableText}, cần ${requiredText}.`
      )
    }
  }
  for (const [itemId, requirement] of requestedByItem.entries()) {
    if (!rowByItem.has(itemId)) continue
    await client.query(
      `UPDATE stock_balance
       SET qty_reserved_local = qty_reserved_local + $3::numeric
       WHERE outlet_id = $1 AND item_id = $2`,
      [outletId, itemId, formatQty(requirement.qty)]
    )
    await client.query(
      `INSERT INTO sale_inventory_reservation (sale_id, item_id, reserved_qty)
       VALUES ($1, $2, $3::numeric)
       ON CONFLICT (sale_id, item_id) DO UPDATE
       SET reserved_qty = sale_inventory_reservation.reserved_qty + EXCLUDED.reserved_qty`,
      [saleId, itemId, formatQty(requirement.qty)]
    )
  }
}

async function releaseStockReservation(client: PoolClient, outletId: string, saleId: string): Promise<void> {
  const { rows: reservationRows } = await client.query<{ item_id: string; reserved_qty: string }>(
    `SELECT item_id, reserved_qty::text
     FROM sale_inventory_reservation
     WHERE sale_id = $1`,
    [saleId]
  )
  if (reservationRows.length > 0) {
    for (const row of reservationRows) {
      const qty = Math.max(0, Number.parseFloat(row.reserved_qty) || 0)
      await client.query(
        `UPDATE stock_balance
         SET qty_reserved_local = GREATEST(qty_reserved_local - $3::numeric, 0)
         WHERE outlet_id = $1 AND item_id = $2`,
        [outletId, row.item_id, formatQty(qty)]
      )
    }
    await client.query(`DELETE FROM sale_inventory_reservation WHERE sale_id = $1`, [saleId])
    return
  }

  const { rows } = await client.query<{ product_id: string; qty: string }>(
    `SELECT product_id, qty::text
     FROM sale_item
     WHERE sale_id = $1`,
    [saleId]
  )
  for (const row of rows) {
    const qty = Math.max(0, Number.parseFloat(row.qty) || 0)
    await client.query(
      `UPDATE stock_balance
       SET qty_reserved_local = GREATEST(qty_reserved_local - $3::numeric, 0)
       WHERE outlet_id = $1 AND item_id = $2`,
      [outletId, row.product_id, formatQty(qty)]
    )
  }
}
