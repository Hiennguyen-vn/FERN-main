/**
 * Sliding-window rate limiter, in-memory. Pilot uses LAN-only agent so process-local
 * state is sufficient; persist to PG when scaling to multi-process or cluster.
 *
 * Bucket key = `${scope}:${identifier}` (e.g. "login:cashier", "login-ip:192.168.1.10").
 * Each call to `consume` records an attempt and returns whether the caller is currently
 * allowed (under threshold) or blocked.
 */

type Attempt = { ts: number }

type Bucket = {
  attempts: Attempt[]
  lockedUntil: number
}

const buckets = new Map<string, Bucket>()

export type RateLimitConfig = {
  windowMs: number      // attempts older than this are forgotten
  maxAttempts: number   // attempts allowed per window before lockout
  lockoutMs: number     // how long to refuse any further attempts after limit hit
}

export type RateLimitResult = {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

export function consume(key: string, cfg: RateLimitConfig, now: number = Date.now()): RateLimitResult {
  let b = buckets.get(key)
  if (!b) {
    b = { attempts: [], lockedUntil: 0 }
    buckets.set(key, b)
  }
  if (b.lockedUntil > now) {
    return { allowed: false, retryAfterMs: b.lockedUntil - now, remaining: 0 }
  }
  // prune expired
  const cutoff = now - cfg.windowMs
  b.attempts = b.attempts.filter(a => a.ts > cutoff)
  b.attempts.push({ ts: now })
  if (b.attempts.length > cfg.maxAttempts) {
    b.lockedUntil = now + cfg.lockoutMs
    b.attempts = []
    return { allowed: false, retryAfterMs: cfg.lockoutMs, remaining: 0 }
  }
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: Math.max(0, cfg.maxAttempts - b.attempts.length),
  }
}

/** Reset on successful auth so a legitimate user isn't locked out by their own typos. */
export function reset(key: string): void {
  buckets.delete(key)
}

/** Periodic GC for buckets that haven't been touched recently. Wire this into a startup interval. */
export function gc(now: number = Date.now()): number {
  let removed = 0
  for (const [key, bucket] of buckets.entries()) {
    const lastTs = bucket.attempts[bucket.attempts.length - 1]?.ts ?? 0
    if (bucket.lockedUntil < now && lastTs < now - 60 * 60 * 1000) {
      buckets.delete(key)
      removed++
    }
  }
  return removed
}
