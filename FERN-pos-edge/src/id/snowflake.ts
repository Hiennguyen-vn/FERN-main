// Client-side Snowflake ID generator.
// Worker ID loaded from Dexie meta after device provision (W2 backend).
// Falls back to random 0-127 range until provisioned.

const CUSTOM_EPOCH = 946684800000n // 2000-01-01T00:00:00Z
const WORKER_ID_BITS = 10n
const SEQUENCE_BITS = 12n
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n

let workerId = 0n
let sequence = 0n
let lastTimestamp = -1n

export function setWorkerId(id: number): void {
  workerId = BigInt(id)
}

export function generateId(): string {
  let timestamp = BigInt(Date.now())

  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1n) & MAX_SEQUENCE
    if (sequence === 0n) {
      // wait next ms
      while (timestamp <= lastTimestamp) {
        timestamp = BigInt(Date.now())
      }
    }
  } else {
    sequence = 0n
  }

  lastTimestamp = timestamp

  const id =
    ((timestamp - CUSTOM_EPOCH) << (WORKER_ID_BITS + SEQUENCE_BITS)) |
    (workerId << SEQUENCE_BITS) |
    sequence

  return id.toString()
}
