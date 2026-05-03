// Offline authentication: cache credentials after successful online login so
// the POS keeps working when the central is unreachable.
//
// Storage: Dexie table `deviceCredential` (one row per user_id).
// Hashing: PBKDF2-SHA256 (310k iter, 16-byte salt) — uses Web Crypto only,
//          works in browsers and Tauri webview without a Wasm bundle.
//          When the app moves to Tauri, swap this for argon2id via
//          tauri-plugin-stronghold or rust crate `argon2`.
//
// Flow:
//   loginOnline() — server validated → call cacheCredential() to store hash
//   loginOffline() — verify supplied password against cached hash + grace window
//
// Grace window: 24 hours from last successful online login. After that the
// device must reach central at least once or the user is locked out.

import { db, type DeviceCredential } from '../db/schema'

const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const HASH_BYTES = 32
const GRACE_MS = 24 * 60 * 60 * 1000

export interface CacheCredentialInput {
  userId: number
  username: string
  password: string
  scopes: string[]
  outletIds: string[]
  displayName: string | null
}

export interface OfflineLoginResult {
  userId: number
  username: string
  displayName: string | null
  scopes: string[]
  outletIds: string[]
  graceUntil: number
}

export type OfflineLoginErrorCode = 'NO_CACHE' | 'GRACE_EXPIRED' | 'BAD_PASSWORD'

export class OfflineLoginError extends Error {
  readonly code: OfflineLoginErrorCode
  constructor(code: OfflineLoginErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export async function cacheCredential(input: CacheCredentialInput): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await pbkdf2(input.password, salt)
  const cachedAt = Date.now()
  const row: DeviceCredential = {
    user_id: input.userId,
    username: input.username,
    password_hash: encodeHash(salt, hash),
    scopes: JSON.stringify(input.scopes),
    outlet_ids: JSON.stringify(input.outletIds),
    display_name: input.displayName,
    cached_at: cachedAt,
    expires_at: cachedAt + GRACE_MS,
    last_offline_login_at: null,
  }
  await db.deviceCredential.put(row)
}

export async function loginOffline(username: string, password: string): Promise<OfflineLoginResult> {
  const row = await db.deviceCredential.where('username').equals(username).first()
  if (!row) throw new OfflineLoginError('NO_CACHE', 'No cached credential — connect once before going offline')
  if (Date.now() > row.expires_at) {
    throw new OfflineLoginError('GRACE_EXPIRED', 'Offline grace expired — reconnect to refresh credentials')
  }
  const ok = await verifyHash(password, row.password_hash)
  if (!ok) throw new OfflineLoginError('BAD_PASSWORD', 'Invalid password')
  await db.deviceCredential.update(row.user_id, { last_offline_login_at: Date.now() })
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    scopes: JSON.parse(row.scopes) as string[],
    outletIds: JSON.parse(row.outlet_ids) as string[],
    graceUntil: row.expires_at,
  }
}

export async function clearCachedCredential(userId: number): Promise<void> {
  await db.deviceCredential.delete(userId)
}

export async function hasCachedCredentialFor(username: string): Promise<boolean> {
  const row = await db.deviceCredential.where('username').equals(username).first()
  return row != null && Date.now() <= row.expires_at
}

// ─── Crypto helpers ──────────────────────────────────────────────────────

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    HASH_BYTES * 8
  )
  return new Uint8Array(bits)
}

function encodeHash(salt: Uint8Array, hash: Uint8Array): string {
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`
}

async function verifyHash(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false
  const salt = unb64(parts[2])
  const expected = unb64(parts[3])
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    expected.length * 8
  )
  return constantTimeEquals(new Uint8Array(bits), expected)
}

// XOR-accumulate diff before branching. JS engines MAY still leak via JIT speculative
// optimization or microarchitectural side channels — Web Crypto offers no constant-time
// guarantee in browsers. Acceptable for this LAN-only POS threat model where attackers
// would already need code execution on the device to time the comparison; revisit if
// PBKDF2 verification ever moves to a network-exposed endpoint.
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function b64(buf: Uint8Array): string {
  let s = ''
  for (const byte of buf) s += String.fromCharCode(byte)
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
