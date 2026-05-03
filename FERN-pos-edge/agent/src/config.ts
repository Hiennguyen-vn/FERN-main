import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

const schema = z.object({
  LOCAL_DB_URL: z.string().url(),
  FERN_GATEWAY_URL: z.string().url(),
  OUTLET_ID: z.string().regex(/^\d+$/, 'OUTLET_ID must be numeric'),
  OUTLET_NAME: z.string().optional(),
  DEVICE_ID: z.string().optional(),
  DEVICE_TOKEN_FILE: z.string().default('./device-token.json'),
  EDGE_SESSION_SECRET: z.string().min(32).optional(),
  AGENT_PORT: z.coerce.number().int().default(8099),
  AGENT_HOST: z.string().default('127.0.0.1'),
  ALLOWED_ORIGINS: z.string().optional(),
  OFFLINE_STOCK_IN_ENABLED: z.coerce.boolean().default(false),
  OFFLINE_WASTE_ENABLED: z.coerce.boolean().default(true),
  STOCK_IN_MAX_QTY_PER_MOVEMENT: z.coerce.number().positive().default(1000),
  STOCK_IN_MAX_MOVEMENTS_PER_SHIFT: z.coerce.number().int().positive().default(50),
  WASTE_MAX_QTY_PER_MOVEMENT: z.coerce.number().positive().default(1000),
  WASTE_MAX_MOVEMENTS_PER_SHIFT: z.coerce.number().int().positive().default(50),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid agent config:', parsed.error.format())
  process.exit(1)
}
const parsedData = parsed.data

const SECRET_FILE = resolve(process.env.EDGE_SESSION_SECRET_FILE ?? './session-secret.key')

function loadOrCreateSessionSecret(): string {
  if (parsedData.EDGE_SESSION_SECRET) return parsedData.EDGE_SESSION_SECRET
  try {
    if (existsSync(SECRET_FILE)) {
      const stored = readFileSync(SECRET_FILE, 'utf8').trim()
      if (stored.length >= 32) return stored
    }
  } catch (err) {
    console.warn('Could not read existing session secret, regenerating:', err)
  }
  const fresh = randomBytes(32).toString('base64url')
  try {
    mkdirSync(dirname(SECRET_FILE), { recursive: true })
    writeFileSync(SECRET_FILE, fresh, { mode: 0o600 })
    chmodSync(SECRET_FILE, 0o600)
  } catch (err) {
    console.warn('Could not persist session secret to disk; sessions will not survive restart:', err)
  }
  return fresh
}

const edgeSessionSecret = loadOrCreateSessionSecret()
const allowedOrigins = (parsed.data.ALLOWED_ORIGINS?.trim()
  ? parsed.data.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS)

if (!parsed.data.EDGE_SESSION_SECRET && !['127.0.0.1', 'localhost', '::1'].includes(parsed.data.AGENT_HOST)) {
  console.error('EDGE_SESSION_SECRET is required when AGENT_HOST is not loopback')
  process.exit(1)
}

export const config = {
  ...parsed.data,
  EDGE_SESSION_SECRET: edgeSessionSecret,
  ALLOWED_ORIGINS: allowedOrigins,
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Missing Origin (curl, server-to-server) → no CORS headers issued. fastify-cors still
  // serves the body, so /health and similar non-browser callers keep working. Browser
  // requests always carry Origin, so this is the correct deny-by-default for them.
  if (!origin) return false
  if (config.ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const url = new URL(origin)
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
      && (url.port === '5173' || url.port === '5174' || url.port === '4173')
  } catch {
    return false
  }
}
