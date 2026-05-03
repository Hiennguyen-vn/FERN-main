import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const COOKIE_NAME = 'fern_edge_session'
const SESSION_SCHEMA_VERSION = 2

export type EdgeSession = {
  v: number
  user_id: string
  username: string
  display_name: string | null
  role: string
  allowed_outlet_ids: (number | string)[]
  offline_grace_until: string | null
  issued_at: string
}

function signBytes(value: string): Buffer {
  return createHmac('sha256', config.EDGE_SESSION_SECRET).update(value).digest()
}

function encode(payload: EdgeSession): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signBytes(body).toString('base64url')
  return `${body}.${signature}`
}

function decode(raw: string): EdgeSession | null {
  const [body, signature] = raw.split('.')
  if (!body || !signature) return null
  let given: Buffer
  try {
    given = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  const expected = signBytes(body)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as EdgeSession
    if (parsed.v !== SESSION_SCHEMA_VERSION) return null
    if (typeof parsed.user_id !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function serializeCookie(value: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!header) return out
  for (const chunk of header.split(';')) {
    const [name, ...rest] = chunk.trim().split('=')
    if (!name || rest.length === 0) continue
    out.set(name, rest.join('='))
  }
  return out
}

export function setEdgeSession(reply: FastifyReply, session: EdgeSession): void {
  const maxAgeSeconds = session.offline_grace_until
    ? Math.max(60, Math.floor((Date.parse(session.offline_grace_until) - Date.now()) / 1000))
    : 24 * 60 * 60
  reply.header('set-cookie', serializeEdgeSessionCookie(session, maxAgeSeconds))
}

export function clearEdgeSession(reply: FastifyReply): void {
  reply.header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function serializeEdgeSessionCookie(session: EdgeSession, maxAgeSeconds: number = 24 * 60 * 60): string {
  return serializeCookie(encode(session), maxAgeSeconds)
}

export function readEdgeSession(req: FastifyRequest): EdgeSession | null {
  const raw = parseCookies(req.headers.cookie).get(COOKIE_NAME)
  if (!raw) return null
  const parsed = decode(raw)
  if (!parsed) return null
  if (parsed.offline_grace_until && Date.parse(parsed.offline_grace_until) < Date.now()) {
    return null
  }
  return parsed
}

export function requireEdgeSession(req: FastifyRequest): EdgeSession {
  const session = readEdgeSession(req)
  if (!session) {
    throw Object.assign(new Error('unauthorized'), { statusCode: 401 })
  }
  return session
}
