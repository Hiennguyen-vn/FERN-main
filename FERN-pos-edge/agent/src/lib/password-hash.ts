import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const HASH_BYTES = 32
const HASH_PREFIX = 'pbkdf2_sha256'

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, HASH_BYTES, 'sha256')
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, encoded: string | null | undefined): boolean {
  if (!encoded) return false
  const parts = encoded.split('$')
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations < 1) return false
  const salt = Buffer.from(parts[2], 'base64')
  const expected = Buffer.from(parts[3], 'base64')
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
