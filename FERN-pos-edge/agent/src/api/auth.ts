import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { verifyPassword } from '../lib/password-hash.js'
import { clearEdgeSession, requireEdgeSession, setEdgeSession, type EdgeSession } from '../lib/edge-session.js'
import { config } from '../config.js'
import { consume, reset, type RateLimitConfig } from '../lib/rate-limit.js'

const LOGIN_LIMIT_USER: RateLimitConfig = { windowMs: 5 * 60_000, maxAttempts: 5, lockoutMs: 15 * 60_000 }
const LOGIN_LIMIT_IP: RateLimitConfig = { windowMs: 5 * 60_000, maxAttempts: 20, lockoutMs: 15 * 60_000 }

const loginSchema = z.object({
  username: z.string().trim().min(1),
  pin: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
}).refine(body => Boolean(body.pin ?? body.password), {
  message: 'pin_required',
  path: ['pin'],
})

const DEFAULT_LOCAL_SESSION_MS = 12 * 60 * 60 * 1000
const LEGACY_CENTRAL_COOKIE = 'dorabets_session'

type LocalUserRow = {
  id: string
  username: string
  display_name: string
  role: string
  token_exp_at: string | null
  pin_hash: string | null
  password_hash: string | null
  allowed_outlet_ids: unknown
}

export function registerAuthRoutes(app: FastifyInstance): void {
  /** Local LAN login. Browser terminals receive only the mini-server session cookie. */
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' })

    // Rate limit: per-username (slow-down brute force on one account) AND per-IP (slow
    // distributed guessing). Both must allow. Reset on successful auth below.
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown'
    const userKey = `login:${body.data.username.toLowerCase()}`
    const ipKey = `login-ip:${ip}`
    const userLimit = consume(userKey, LOGIN_LIMIT_USER)
    const ipLimit = consume(ipKey, LOGIN_LIMIT_IP)
    if (!userLimit.allowed || !ipLimit.allowed) {
      const retry = Math.max(userLimit.retryAfterMs, ipLimit.retryAfterMs)
      reply.header('Retry-After', Math.ceil(retry / 1000).toString())
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Quá nhiều lần thử đăng nhập. Vui lòng đợi và thử lại sau.',
        retry_after_seconds: Math.ceil(retry / 1000),
      })
    }

    const user = await findLocalUser(body.data.username)
    if (!user) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Tài khoản chưa được đồng bộ xuống mini server.',
      })
    }
    // Verify against the field the client actually sent. Refusing the OR-fallback prevents a
    // PIN credential from being accepted as a password and vice versa.
    const verified = body.data.pin != null
      ? verifyPassword(body.data.pin, user.pin_hash)
      : body.data.password != null
        ? verifyPassword(body.data.password, user.password_hash)
        : false
    if (!verified) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Sai PIN local' })
    }

    const allowedOutletIds = normalizeAllowedOutletIds(user.allowed_outlet_ids)
    if (!isAllowedForThisOutlet(allowedOutletIds)) {
      return reply.code(403).send({ error: 'forbidden_outlet', message: 'User không có quyền tại outlet này.' })
    }

    const expiresAt = resolveLocalSessionExpiry(await loadOfflineGraceUntil(), user.token_exp_at)
    const session = buildSession(user, allowedOutletIds, expiresAt)
    await pool.query(
      `UPDATE app_user SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [user.id]
    )
    setEdgeSession(reply, session)
    clearLegacyCentralSessionCookie(reply)
    reset(userKey)
    reset(ipKey)
    return reply.send(publicSessionResponse(session, false))
  })

  /** Current local LAN session. Does not call FERN central or forward browser cookies. */
  app.get('/api/v1/auth/me', async (req, reply) => {
    try {
      const session = requireEdgeSession(req)
      return reply.send({
        id: session.user_id,
        username: session.username,
        display_name: session.display_name ?? session.username,
        scopes: scopesFor(session),
      })
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
  })

  /** Local logout only. */
  app.post('/api/v1/auth/logout', async (_req, reply) => {
    clearEdgeSession(reply)
    clearLegacyCentralSessionCookie(reply)
    return reply.send({ ok: true })
  })

  /** Renew the local LAN session window; no central user JWT is issued to browser terminals. */
  app.post('/api/v1/auth/lease-offline', async (req, reply) => {
    try {
      const session = requireEdgeSession(req)
      const expiresAt = new Date(Date.now() + DEFAULT_LOCAL_SESSION_MS)
      const nextSession = { ...session, offline_grace_until: expiresAt.toISOString(), issued_at: new Date().toISOString() }
      await storeOfflineGraceUntil(expiresAt)
      setEdgeSession(reply, nextSession)
      return reply.send({ offline_grace_until: expiresAt.toISOString(), offline_ttl_seconds: DEFAULT_LOCAL_SESSION_MS / 1000 })
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
  })
}

async function findLocalUser(username: string): Promise<LocalUserRow | null> {
  const { rows } = await pool.query<LocalUserRow>(
    `SELECT id, username, display_name, role, token_exp_at, pin_hash, password_hash, allowed_outlet_ids
     FROM app_user
     WHERE username = $1
     LIMIT 1`,
    [username]
  )
  return rows[0] ?? null
}

function normalizeAllowedOutletIds(raw: unknown): string[] {
  const ids = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? parseJsonArray(raw)
      : []
  const normalized = ids.map(String).filter(v => /^\d+$/.test(v) && v !== '0')
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [config.OUTLET_ID]
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isAllowedForThisOutlet(allowedOutletIds: string[]): boolean {
  return allowedOutletIds.includes(config.OUTLET_ID)
}

function resolveLocalSessionExpiry(graceUntil: Date | null, tokenExpAt: string | null): Date {
  const configured = graceUntil ?? (tokenExpAt ? new Date(tokenExpAt) : null)
  if (configured && !Number.isNaN(configured.getTime()) && configured > new Date()) {
    return configured
  }
  return new Date(Date.now() + DEFAULT_LOCAL_SESSION_MS)
}

function buildSession(user: LocalUserRow, allowedOutletIds: string[], expiresAt: Date): EdgeSession {
  return {
    v: 2,
    user_id: String(user.id),
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    allowed_outlet_ids: allowedOutletIds,
    offline_grace_until: expiresAt.toISOString(),
    issued_at: new Date().toISOString(),
  }
}

function scopesFor(session: EdgeSession): Array<{ outlet_id: string; role: string }> {
  return session.allowed_outlet_ids.map(outletId => ({
    outlet_id: String(outletId),
    role: session.role,
  }))
}

function publicSessionResponse(session: EdgeSession, offline: boolean) {
  return {
    local: true,
    offline,
    offline_grace_until: session.offline_grace_until,
    user: {
      id: session.user_id,
      username: session.username,
      display_name: session.display_name,
      role: session.role,
    },
    scopes: scopesFor(session),
  }
}

function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('set-cookie')
  if (!existing) {
    reply.header('set-cookie', cookie)
  } else if (Array.isArray(existing)) {
    reply.header('set-cookie', [...existing.map(String), cookie])
  } else {
    reply.header('set-cookie', [String(existing), cookie])
  }
}

function clearLegacyCentralSessionCookie(reply: FastifyReply): void {
  appendSetCookie(reply, `${LEGACY_CENTRAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

async function storeOfflineGraceUntil(until: Date): Promise<void> {
  await pool.query(
    `INSERT INTO device_meta (key, value, updated_at) VALUES ('offline_grace_until', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ until: until.toISOString() })]
  )
}

async function loadOfflineGraceUntil(): Promise<Date | null> {
  const { rows } = await pool.query<{ value: { until?: string } }>(
    `SELECT value FROM device_meta WHERE key = 'offline_grace_until' LIMIT 1`
  )
  const raw = rows[0]?.value?.until
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
