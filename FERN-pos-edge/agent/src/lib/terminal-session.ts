import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const COOKIE_NAME = 'fern_edge_terminal'

export type TerminalSession = {
  register_code: string
  display_name: string
  outlet_id: number | string
  paired_at: string
}

function signBytes(value: string): Buffer {
  return createHmac('sha256', `${config.EDGE_SESSION_SECRET}:terminal`).update(value).digest()
}

function encode(payload: TerminalSession): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signBytes(body).toString('base64url')}`
}

function decode(raw: string): TerminalSession | null {
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TerminalSession
  } catch {
    return null
  }
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

export function setTerminalSession(reply: FastifyReply, session: TerminalSession): void {
  reply.header('set-cookie', serializeTerminalSessionCookie(session))
}

export function clearTerminalSession(reply: FastifyReply): void {
  reply.header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function serializeTerminalSessionCookie(session: TerminalSession, maxAgeSeconds: number = 30 * 24 * 60 * 60): string {
  return `${COOKIE_NAME}=${encode(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function readTerminalSession(req: FastifyRequest): TerminalSession | null {
  const raw = parseCookies(req.headers.cookie).get(COOKIE_NAME)
  if (!raw) return null
  return decode(raw)
}

export function requireTerminalSession(req: FastifyRequest): TerminalSession {
  const session = readTerminalSession(req)
  if (!session) {
    throw Object.assign(new Error('terminal_not_paired'), { statusCode: 409 })
  }
  return session
}
