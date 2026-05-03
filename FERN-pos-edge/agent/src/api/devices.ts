import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fernClient, persistDeviceToken } from '../upstream/fern-client.js'
import { pool } from '../db/pool.js'
import { setWorkerId } from '../lib/snowflake.js'
import { logger } from '../lib/logger.js'
import { config } from '../config.js'
import { readTerminalSession, setTerminalSession } from '../lib/terminal-session.js'
import { publishLocalEvent } from '../services/local-events.js'

const snowflakeIdSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().positive(),
]).transform(value => String(value))

const provisionSchema = z.object({
  outlet_id: snowflakeIdSchema.optional(),
  device_label: z.string().min(1),
  browser_fingerprint_hash: z.string().optional(),
})

const localPairSchema = z.object({
  registerCode: z.string().trim().min(1).max(64).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
})

async function loadHubIdentity() {
  const { rows } = await pool.query<{ key: string, value: any }>(
    `SELECT key, value FROM device_meta WHERE key IN ('device_id', 'worker_id')`
  )
  const map = Object.fromEntries(rows.map(row => [row.key, row.value]))
  return {
    deviceId: map.device_id?.device_id ? String(map.device_id.device_id) : null,
    workerId: map.worker_id?.worker_id ? Number(map.worker_id.worker_id) : null,
  }
}

function normalizeRegisterCode(input?: string): string {
  const raw = (input ?? 'REGISTER-DEFAULT').trim().toUpperCase()
  return raw.replace(/[^A-Z0-9_-]/g, '-').slice(0, 64) || 'REGISTER-DEFAULT'
}

export function registerDeviceRoutes(app: FastifyInstance): void {
  /** Provision device against FERN central; cache device_id + worker_id locally. */
  app.post('/api/v1/devices/provision', async (req, reply) => {
    const body = provisionSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' })
    const outletId = body.data.outlet_id ?? config.OUTLET_ID

    try {
      const resp = await fernClient.post('/api/v1/devices/provision', {
        outlet_id: outletId,
        device_label: body.data.device_label,
        browser_fingerprint_hash: body.data.browser_fingerprint_hash ?? null,
      }, {
        headers: req.headers.authorization ? { Authorization: String(req.headers.authorization) } : {},
      })
      const deviceId = String(resp.data.device_id)
      const workerId = Number(resp.data.worker_id)
      await pool.query(
        `INSERT INTO device_meta (key, value, updated_at) VALUES ('device_id', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify({ device_id: deviceId })]
      )
      await pool.query(
        `INSERT INTO device_meta (key, value, updated_at) VALUES ('worker_id', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify({ worker_id: workerId })]
      )
      setWorkerId(workerId)
      return reply.send({ device_id: deviceId, worker_id: workerId })
    } catch (err: any) {
      logger.warn({ err: String(err) }, 'provision upstream failed')
      return reply.code(err.response?.status ?? 503).send({ error: 'provision_failed', message: String(err) })
    }
  })

  /** Redeem a manager-issued pair token → store device-JWT locally. */
  app.post('/api/v1/devices/pair', async (req, reply) => {
    const body = z.object({ pair_token: z.string().min(1) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' })
    try {
      const resp = await fernClient.post<{
        deviceId: string | number; outletId: string | number; deviceLabel: string
        workerId?: number
        deviceToken: string; expiresAt: string; pairedAt: string
      }>('/api/v1/devices/pair', { pairToken: body.data.pair_token })
      persistDeviceToken(resp.data.deviceToken, resp.data.expiresAt)
      const deviceId = String(resp.data.deviceId)
      const outletId = String(resp.data.outletId)
      const workerId = resp.data.workerId
      await pool.query(
        `INSERT INTO device_meta (key, value, updated_at) VALUES ('device_id', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify({ device_id: deviceId })]
      )
      if (workerId != null) {
        await pool.query(
          `INSERT INTO device_meta (key, value, updated_at) VALUES ('worker_id', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify({ worker_id: workerId })]
        )
        setWorkerId(workerId)
      }
      logger.info({ deviceId, outletId, workerId }, 'device paired')
      return reply.send({ device_id: deviceId, outlet_id: outletId, worker_id: workerId ?? null, paired_at: resp.data.pairedAt })
    } catch (err: any) {
      logger.warn({ err: String(err) }, 'device pair failed')
      return reply.code(err.response?.status ?? 503).send({ error: 'pair_failed', message: String(err) })
    }
  })

  const pairLocal = async (req: any, reply: any) => {
    const body = localPairSchema.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })
    const registerCode = normalizeRegisterCode(body.data.registerCode)
    const displayName = body.data.displayName?.trim() || registerCode
    const pairedAt = new Date().toISOString()
    setTerminalSession(reply, {
      register_code: registerCode,
      display_name: displayName,
      outlet_id: config.OUTLET_ID,
      paired_at: pairedAt,
    })
    const hub = await loadHubIdentity()
    publishLocalEvent('device.paired', {
      outlet_id: config.OUTLET_ID,
      register_code: registerCode,
      display_name: displayName,
      device_id: hub.deviceId,
    })
    return reply.send({
      device_id: hub.deviceId,
      worker_id: hub.workerId,
      outlet_id: config.OUTLET_ID,
      register_code: registerCode,
      display_name: displayName,
      paired_at: pairedAt,
    })
  }

  const currentLocal = async (req: any, reply: any) => {
    const hub = await loadHubIdentity()
    const terminal = readTerminalSession(req)
    return reply.send({
      device_id: hub.deviceId,
      worker_id: hub.workerId,
      outlet_id: config.OUTLET_ID,
      register_code: terminal?.register_code ?? null,
      display_name: terminal?.display_name ?? null,
      paired_at: terminal?.paired_at ?? null,
      paired: terminal != null && String(terminal.outlet_id) === config.OUTLET_ID,
    })
  }

  app.post('/api/v1/local/device/pair', pairLocal)
  app.post('/api/local/device/pair', pairLocal)
  app.get('/api/v1/local/device/me', currentLocal)
  app.get('/api/local/device/me', currentLocal)

  /** Return cached device_id + worker_id. PWA calls this on boot. */
  app.get('/api/v1/devices/current', async (req, reply) => {
    const hub = await loadHubIdentity()
    const terminal = readTerminalSession(req)
    return reply.send({
      device_id: hub.deviceId,
      worker_id: hub.workerId,
      outlet_id: config.OUTLET_ID,
      register_code: terminal?.register_code ?? null,
      display_name: terminal?.display_name ?? null,
    })
  })
}
