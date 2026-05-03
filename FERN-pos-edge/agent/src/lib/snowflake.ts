/**
 * Snowflake ID generator — agent-local worker_id (per device).
 * 64-bit: timestamp 41 | worker_id 10 | sequence 12.
 * Worker ID assigned at provisioning (128-1023 range).
 */

const EPOCH = 1700000000000n  // 2023-11-14
const WORKER_BITS = 10n
const SEQ_BITS = 12n
const MAX_SEQ = (1n << SEQ_BITS) - 1n
const WORKER_SHIFT = SEQ_BITS
const TIMESTAMP_SHIFT = SEQ_BITS + WORKER_BITS

let lastTimestamp = -1n
let sequence = 0n
let workerId: bigint | null = null

export function setWorkerId(id: number | bigint): void {
  const big = BigInt(id)
  if (big < 0n || big > (1n << WORKER_BITS) - 1n) {
    throw new Error(`workerId out of range: ${big}`)
  }
  workerId = big
}

export function nextId(): string {
  if (workerId === null) throw new Error('snowflake: workerId not set')
  let ts = BigInt(Date.now())
  if (ts < lastTimestamp) {
    ts = lastTimestamp  // clock skew — don't regress
  }
  if (ts === lastTimestamp) {
    sequence = (sequence + 1n) & MAX_SEQ
    if (sequence === 0n) {
      // wait next millisecond
      while (BigInt(Date.now()) <= ts) { /* spin */ }
      ts = BigInt(Date.now())
    }
  } else {
    sequence = 0n
  }
  lastTimestamp = ts
  const id = ((ts - EPOCH) << TIMESTAMP_SHIFT) | (workerId << WORKER_SHIFT) | sequence
  return id.toString()
}
