import pg from 'pg'
import { config } from '../src/config.js'
import { runMigrations } from '../src/db/migrate.js'
import { pool } from '../src/db/pool.js'
import { serializeEdgeSessionCookie, type EdgeSession } from '../src/lib/edge-session.js'
import { serializeTerminalSessionCookie, type TerminalSession } from '../src/lib/terminal-session.js'
import { setWorkerId } from '../src/lib/snowflake.js'

let migrationsReady = false

export async function ensureAgentTestDb(): Promise<void> {
  if (!migrationsReady) {
    await ensureSafeTestDatabase()
    await runMigrations()
    migrationsReady = true
  }
}

export async function resetLocalDb(): Promise<void> {
  assertSafeTestDatabase()
  await pool.query(`
    TRUNCATE TABLE
      sale_item_modifier,
      sale_item,
      payment,
      sale_inventory_reservation,
      inventory_movement,
      outbox_event,
      sale_record,
      pos_session,
      stock_balance,
      recipe_component,
      recipe,
      item,
      product_modifier_group,
      modifier_option,
      modifier_group,
      product_variant,
      product_price,
      product,
      app_user,
      outlet,
      device_meta
    RESTART IDENTITY CASCADE
  `)
}

async function ensureSafeTestDatabase(): Promise<void> {
  const dbName = currentDatabaseName()
  assertSafeTestDatabase(dbName)
  const adminUrl = new URL(config.LOCAL_DB_URL)
  adminUrl.pathname = '/postgres'
  const client = new pg.Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [dbName],
    )
    if (!rows[0]?.exists) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`)
    }
  } finally {
    await client.end()
  }
}

function assertSafeTestDatabase(dbName = currentDatabaseName()): void {
  if (process.env.ALLOW_AGENT_TEST_DB_RESET === '1') return
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset non-test database "${dbName}". Set LOCAL_DB_URL to a *_test database.`)
  }
}

function currentDatabaseName(): string {
  const url = new URL(config.LOCAL_DB_URL)
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export async function seedHubIdentity(deviceId: number = 101, workerId: number = 7): Promise<void> {
  await pool.query(
    `INSERT INTO device_meta (key, value, updated_at)
     VALUES
       ('device_id', $1::jsonb, NOW()),
       ('worker_id', $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ device_id: String(deviceId) }), JSON.stringify({ worker_id: workerId })],
  )
  setWorkerId(workerId)
}

export async function seedBasicProduct(outletId: number = 1): Promise<void> {
  await pool.query(
    `INSERT INTO product (id, sku, name, category_id, is_active, tax_basis_points, updated_at)
     VALUES (501, 'CF-01', 'Cold Brew', 10, TRUE, 800, NOW())`,
  )
  await pool.query(
    `INSERT INTO product_price (product_id, outlet_id, price_cents, effective_from, effective_to, updated_at)
     VALUES (501, $1, 45000, NOW() - INTERVAL '1 day', NULL, NOW())`,
    [outletId],
  )
}

export function makeEdgeCookie(overrides: Partial<EdgeSession> = {}): string {
  const session: EdgeSession = {
    user_id: overrides.user_id ?? 11,
    username: overrides.username ?? 'cashier-1',
    display_name: overrides.display_name ?? 'Cashier 1',
    role: overrides.role ?? 'cashier',
    allowed_outlet_ids: overrides.allowed_outlet_ids ?? [1],
    offline_grace_until: overrides.offline_grace_until ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    issued_at: overrides.issued_at ?? new Date().toISOString(),
  }
  return serializeEdgeSessionCookie(session)
}

export function makeTerminalCookie(overrides: Partial<TerminalSession> = {}): string {
  const terminal: TerminalSession = {
    register_code: overrides.register_code ?? 'REGISTER-A',
    display_name: overrides.display_name ?? 'Register A',
    outlet_id: overrides.outlet_id ?? 1,
    paired_at: overrides.paired_at ?? new Date().toISOString(),
  }
  return serializeTerminalSessionCookie(terminal)
}
