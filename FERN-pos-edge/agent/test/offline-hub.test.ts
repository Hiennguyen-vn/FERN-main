import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'
import { config } from '../src/config.js'
import { drainOnce } from '../src/services/outbox-relay.js'
import { publishLocalEvent } from '../src/services/local-events.js'
import { fernClient } from '../src/upstream/fern-client.js'
import {
  ensureAgentTestDb,
  makeEdgeCookie,
  makeTerminalCookie,
  resetLocalDb,
  seedHubIdentity,
} from './helpers.js'

let app: FastifyInstance
const originalPost = fernClient.post.bind(fernClient)

before(async () => {
  await ensureAgentTestDb()
  await seedHubIdentity()
  app = await createApp(7)
})

beforeEach(async () => {
  fernClient.post = originalPost
  await resetLocalDb()
  await seedHubIdentity()
})

after(async () => {
  fernClient.post = originalPost
  if (app) {
    await app.close()
  }
  await pool.end()
})

test('different registers can open sessions in parallel while the same register is soft-locked', async () => {
  const cashierCookie = makeEdgeCookie()
  const registerACookie = makeTerminalCookie({ register_code: 'REGISTER-A', display_name: 'Register A' })
  const registerBCookie = makeTerminalCookie({ register_code: 'REGISTER-B', display_name: 'Register B' })

  const openA = await app.inject({
    method: 'POST',
    url: '/api/v1/sales/pos-sessions',
    headers: { cookie: `${cashierCookie}; ${registerACookie}` },
    payload: { outletId: 1, cashFloat: '100000' },
  })
  assert.equal(openA.statusCode, 200)

  const conflict = await app.inject({
    method: 'POST',
    url: '/api/v1/sales/pos-sessions',
    headers: {
      cookie: `${makeEdgeCookie({ user_id: 12, username: 'cashier-2', display_name: 'Cashier 2' })}; ${registerACookie}`,
    },
    payload: { outletId: 1, cashFloat: '50000' },
  })
  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.json().warning_code, 'register_in_use')

  const openB = await app.inject({
    method: 'POST',
    url: '/api/v1/sales/pos-sessions',
    headers: { cookie: `${cashierCookie}; ${registerBCookie}` },
    payload: { outletId: 1, cashFloat: '25000' },
  })
  assert.equal(openB.statusCode, 200)

  const { rows } = await pool.query<{ register_code: string }>(
    `SELECT register_code FROM pos_session ORDER BY register_code`,
  )
  assert.deepEqual(rows.map(row => row.register_code), ['REGISTER-A', 'REGISTER-B'])
})

test('stale SYNCING outbox rows are reclaimed and acknowledged on the next relay pass', async () => {
  const eventId = '9000000000001'
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, sync_attempt_id, sync_started_at, client_occurred_at, created_at
     ) VALUES (
       $1, 'pos.sale.approved', 'idem-1', 'sales', 7001, '{}'::jsonb,
       'SYNCING', 'stale-attempt', NOW() - INTERVAL '35 seconds', NOW(), NOW()
     )`,
    [eventId],
  )

  fernClient.post = (async () => ({
    data: {
      accepted: [eventId],
      rejected: [],
    },
  })) as typeof fernClient.post

  const drained = await drainOnce()
  assert.equal(drained, 1)

  const { rows } = await pool.query<{
    status: string
    sync_attempt_id: string | null
    sync_started_at: string | null
    synced_at: string | null
  }>(
    `SELECT status, sync_attempt_id, sync_started_at, synced_at
     FROM outbox_event
     WHERE id = $1`,
    [eventId],
  )

  assert.equal(rows[0].status, 'ACKED')
  assert.equal(rows[0].sync_attempt_id, null)
  assert.equal(rows[0].sync_started_at, null)
  assert.ok(rows[0].synced_at)
})

test('sync manifest exposes stale SYNCING rows for terminal health banners', async () => {
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, sync_attempt_id, sync_started_at, client_occurred_at, created_at
     ) VALUES
       (9000000000002, 'pos.sale.submitted', 'idem-pending', 'sales', 7002, '{}'::jsonb,
        'PENDING', NULL, NULL, NOW(), NOW()),
       (9000000000003, 'pos.sale.submitted', 'idem-failed', 'sales', 7003, '{}'::jsonb,
        'FAILED', NULL, NULL, NOW(), NOW()),
       (9000000000004, 'pos.sale.submitted', 'idem-stale', 'sales', 7004, '{}'::jsonb,
        'SYNCING', 'stale-attempt', NOW() - INTERVAL '45 seconds', NOW(), NOW())`,
  )

  const manifest = await app.inject({
    method: 'GET',
    url: '/api/v1/sync/manifest',
  })

  assert.equal(manifest.statusCode, 200)
  assert.deepEqual(manifest.json().outbox, {
    pending: 1,
    failed: 1,
    stale_syncing: 1,
  })
})

test('stale SYNCING rows are reclaimed after mini server restart', async () => {
  const eventId = '9000000000005'
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, sync_attempt_id, sync_started_at, client_occurred_at, created_at
     ) VALUES (
       $1, 'pos.payment.captured', 'idem-restart', 'sales', 7005, '{}'::jsonb,
       'SYNCING', 'stale-before-restart', NOW() - INTERVAL '31 seconds', NOW(), NOW()
     )`,
    [eventId],
  )

  await app.close()
  app = await createApp(7)

  fernClient.post = (async () => ({
    data: {
      accepted: [eventId],
      rejected: [],
    },
  })) as typeof fernClient.post

  const drained = await drainOnce()
  assert.equal(drained, 1)

  const { rows } = await pool.query<{ status: string; sync_attempt_id: string | null }>(
    `SELECT status, sync_attempt_id
     FROM outbox_event
     WHERE id = $1`,
    [eventId],
  )
  assert.equal(rows[0].status, 'ACKED')
  assert.equal(rows[0].sync_attempt_id, null)
})

test('outbox relay pushes dependent sale events in created_at and id order', async () => {
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, client_occurred_at, created_at
     ) VALUES
       (9000000000012, 'pos.payment.captured', 'idem-order-payment', 'sales', 7012,
        '{"sale_id":7012,"outlet_id":1}'::jsonb, 'PENDING',
        '2026-04-27T09:00:02.000Z', '2026-04-27T09:00:02.000Z'),
       (9000000000010, 'pos.sale.submitted', 'idem-order-submit', 'sales', 7012,
        '{"sale_id":7012,"outlet_id":1}'::jsonb, 'PENDING',
        '2026-04-27T09:00:00.000Z', '2026-04-27T09:00:00.000Z'),
       (9000000000011, 'pos.sale.approved', 'idem-order-approve', 'sales', 7012,
        '{"sale_id":7012,"outlet_id":1}'::jsonb, 'PENDING',
        '2026-04-27T09:00:01.000Z', '2026-04-27T09:00:01.000Z')`
  )

  const pushedTypes: string[] = []
  fernClient.post = (async (_url: string, body?: any) => {
    pushedTypes.push(...body.events.map((event: any) => event.type))
    return {
      data: {
        accepted: body.events.map((event: any) => event.eventId),
        rejected: [],
      },
    }
  }) as typeof fernClient.post

  const drained = await drainOnce()
  assert.equal(drained, 3)
  assert.deepEqual(pushedTypes, [
    'pos.sale.submitted',
    'pos.sale.approved',
    'pos.payment.captured',
  ])
})

test('payment-before-approval rejection stays retryable and does not fail local payment', async () => {
  await seedPaidSaleWithPayment({ saleId: 7013, paymentState: 'PENDING_OFFLINE' })
  const eventId = '9000000000013'
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, client_occurred_at, created_at
     ) VALUES (
       $1, 'pos.payment.captured', 'idem-payment-before-approval', 'sales', 7013,
       '{"sale_id":7013,"outlet_id":1}'::jsonb, 'PENDING',
       '2026-04-27T09:05:00.000Z', '2026-04-27T09:05:00.000Z'
     )`,
    [eventId],
  )

  fernClient.post = (async (_url: string, body?: any) => ({
    data: {
      accepted: [],
      rejected: body.events.map((event: any) => ({
        eventId: event.eventId,
        reason: 'Only approved orders can be marked as payment done',
      })),
    },
  })) as typeof fernClient.post

  const drained = await drainOnce()
  assert.equal(drained, 1)

  const { rows } = await pool.query<{ status: string; attempt_count: number; retry_after: string | null; last_error: string | null; payment_state: string }>(
    `SELECT o.status, o.attempt_count, o.retry_after::text, o.last_error, p.state AS payment_state
     FROM outbox_event o
     JOIN payment p ON p.sale_id = o.aggregate_id
     WHERE o.id = $1`,
    [eventId],
  )
  assert.equal(rows[0].status, 'PENDING')
  assert.equal(rows[0].attempt_count, 1)
  assert.ok(rows[0].retry_after)
  assert.equal(rows[0].last_error, 'Only approved orders can be marked as payment done')
  assert.equal(rows[0].payment_state, 'PENDING_OFFLINE')
})

test('manual retry of failed payment outbox resets local payment to pending offline', async () => {
  await seedPaidSaleWithPayment({ saleId: 7014, paymentState: 'FAILED' })
  const eventId = '9000000000014'
  await pool.query(
    `INSERT INTO outbox_event (
       id, event_type, idempotency_key, aggregate_type, aggregate_id, payload,
       status, last_error, client_occurred_at, created_at
     ) VALUES (
       $1, 'pos.payment.captured', 'idem-manual-payment-retry', 'sales', 7014,
       '{"sale_id":7014,"outlet_id":1}'::jsonb, 'FAILED',
       'Only approved orders can be marked as payment done',
       '2026-04-27T09:10:00.000Z', '2026-04-27T09:10:00.000Z'
     )`,
    [eventId],
  )

  const retry = await app.inject({
    method: 'POST',
    url: `/api/v1/sync/outbox/${eventId}/retry`,
    headers: { cookie: makeEdgeCookie({ role: 'manager' }) },
  })
  assert.equal(retry.statusCode, 200, retry.body)

  const { rows } = await pool.query<{ outbox_status: string; last_error: string | null; payment_state: string; reconciled_at: string | null }>(
    `SELECT o.status AS outbox_status, o.last_error, p.state AS payment_state, p.reconciled_at::text
     FROM outbox_event o
     JOIN payment p ON p.sale_id = o.aggregate_id
     WHERE o.id = $1`,
    [eventId],
  )
  assert.equal(rows[0].outbox_status, 'PENDING')
  assert.equal(rows[0].last_error, null)
  assert.equal(rows[0].payment_state, 'PENDING_OFFLINE')
  assert.equal(rows[0].reconciled_at, null)
})

test('local SSE stream publishes hub events to connected terminals', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  assert.ok(address && typeof address === 'object')

  const response = await fetch(`http://127.0.0.1:${address.port}/api/local/events`)
  assert.equal(response.status, 200)
  assert.ok(response.body)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  const readUntil = async (needle: string): Promise<string> => {
    let buffer = ''
    while (!buffer.includes(needle)) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
    }
    return buffer
  }

  await readUntil('event: connected')
  publishLocalEvent('sync.updated', { acked: 1 })
  const payload = await readUntil('event: sync.updated')
  assert.match(payload, /event: sync\.updated/)
  assert.match(payload, /"acked":1/)

  await reader.cancel()
  await app.close()
  app = await createApp(7)
})

test('stock-in simple writes local movement, updates stock, and dedupes by idempotency key', async () => {
  const previousFlag = config.OFFLINE_STOCK_IN_ENABLED
  config.OFFLINE_STOCK_IN_ENABLED = true
  try {
    await pool.query(
      `INSERT INTO item (id, sku, name, unit, updated_at)
       VALUES (601, 'MILK', 'Milk', 'pcs', NOW())`
    )
    await pool.query(
      `INSERT INTO stock_balance (item_id, outlet_id, qty_on_hand, synced_at)
       VALUES (601, 1, 5, NOW())`
    )

    const managerCookie = makeEdgeCookie({ role: 'manager' })
    const terminalCookie = makeTerminalCookie({ register_code: 'REGISTER-STOCK', display_name: 'Register Stock' })
    const cookie = `${managerCookie}; ${terminalCookie}`
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/pos-sessions',
      headers: { cookie },
      payload: { outletId: 1, cashFloat: '0' },
    })
    assert.equal(open.statusCode, 200)

    const payload = {
      outletId: 1,
      itemId: 601,
      quantity: 10,
      reason: 'EMERGENCY_RECEIPT',
      note: 'Received from local storage',
      createdAtDevice: '2026-04-27T10:00:00.000Z',
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/stock-in-simple',
      headers: { cookie, 'Idempotency-Key': 'stock-in-test-1' },
      payload,
    })
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(first.json().syncStatus, 'PENDING')

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/stock-in-simple',
      headers: { cookie, 'Idempotency-Key': 'stock-in-test-1' },
      payload,
    })
    assert.equal(duplicate.statusCode, 200)
    assert.equal(duplicate.json().eventId, first.json().eventId)

    const { rows } = await pool.query<{ qty_on_hand: string; movements: string; outbox: string }>(
      `SELECT
         (SELECT qty_on_hand::text FROM stock_balance WHERE outlet_id = 1 AND item_id = 601) AS qty_on_hand,
         (SELECT COUNT(*)::text FROM inventory_movement WHERE item_id = 601) AS movements,
         (SELECT COUNT(*)::text FROM outbox_event WHERE event_type = 'pos.inventory.stock-in.recorded') AS outbox`
    )
    assert.equal(rows[0].qty_on_hand, '15.000')
    assert.equal(rows[0].movements, '1')
    assert.equal(rows[0].outbox, '1')
  } finally {
    config.OFFLINE_STOCK_IN_ENABLED = previousFlag
  }
})

async function seedPaidSaleWithPayment(input: { saleId: number; paymentState: 'PENDING_OFFLINE' | 'FAILED' }): Promise<void> {
  const sessionId = input.saleId + 100000
  const paymentId = input.saleId + 200000
  await pool.query(
    `INSERT INTO pos_session (
       id, outlet_id, manager_id, status, business_date, opening_cash,
       device_id, opened_by_user_id, opened_by_username, register_code, register_display_name
     ) VALUES (
       $1, 1, 11, 'open', CURRENT_DATE, 0,
       101, 11, 'manager-1', 'REGISTER-RETRY', 'Register Retry'
     )`,
    [sessionId],
  )
  await pool.query(
    `INSERT INTO sale_record (
       id, outlet_id, pos_session_id, cashier_id, cashier_username, status,
       subtotal_cents, discount_cents, tax_cents, total_cents
     ) VALUES (
       $1, 1, $2, 11, 'cashier-1', 'paid',
       10000, 0, 0, 10000
     )`,
    [input.saleId, sessionId],
  )
  await pool.query(
    `INSERT INTO payment (
       id, sale_id, method, amount_cents, state, paid_at,
       device_id, captured_by_user_id, captured_by_username, offline_captured_at, reconciled_at
     ) VALUES (
       $1, $2, 'cash', 10000, $3, NOW(),
       101, 11, 'cashier-1', NOW(), CASE WHEN $3 = 'FAILED' THEN NOW() ELSE NULL END
     )`,
    [paymentId, input.saleId, input.paymentState],
  )
}

test('waste writes local movement, decrements stock, and dedupes by idempotency key', async () => {
  const previousFlag = config.OFFLINE_WASTE_ENABLED
  config.OFFLINE_WASTE_ENABLED = true
  try {
    await pool.query(
      `INSERT INTO item (id, sku, name, unit, updated_at)
       VALUES (602, 'CREAM', 'Cream', 'pcs', NOW())`
    )
    await pool.query(
      `INSERT INTO stock_balance (item_id, outlet_id, qty_on_hand, synced_at)
       VALUES (602, 1, 12, NOW())`
    )

    const managerCookie = makeEdgeCookie({ role: 'manager' })
    const terminalCookie = makeTerminalCookie({ register_code: 'REGISTER-WASTE', display_name: 'Register Waste' })
    const cookie = `${managerCookie}; ${terminalCookie}`
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/pos-sessions',
      headers: { cookie },
      payload: { outletId: 1, cashFloat: '0' },
    })
    assert.equal(open.statusCode, 200)

    const payload = {
      outletId: 1,
      itemId: 602,
      quantity: 2,
      businessDate: '2026-04-27',
      reason: 'SPILL',
      note: 'Dropped during prep',
      createdAtDevice: '2026-04-27T11:00:00.000Z',
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/waste',
      headers: { cookie, 'Idempotency-Key': 'waste-test-1' },
      payload,
    })
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(first.json().syncStatus, 'PENDING')
    assert.equal(first.json().movementType, 'WASTE')

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/waste',
      headers: { cookie, 'Idempotency-Key': 'waste-test-1' },
      payload,
    })
    assert.equal(duplicate.statusCode, 200)
    assert.equal(duplicate.json().eventId, first.json().eventId)

    const { rows } = await pool.query<{ qty_on_hand: string; movements: string; outbox: string }>(
      `SELECT
         (SELECT qty_on_hand::text FROM stock_balance WHERE outlet_id = 1 AND item_id = 602) AS qty_on_hand,
         (SELECT COUNT(*)::text FROM inventory_movement WHERE item_id = 602 AND movement_type = 'WASTE') AS movements,
         (SELECT COUNT(*)::text FROM outbox_event WHERE event_type = 'pos.inventory.waste.recorded') AS outbox`
    )
    assert.equal(rows[0].qty_on_hand, '10.000')
    assert.equal(rows[0].movements, '1')
    assert.equal(rows[0].outbox, '1')
  } finally {
    config.OFFLINE_WASTE_ENABLED = previousFlag
  }
})
