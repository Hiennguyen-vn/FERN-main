import pg from 'pg'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'

export const pool = new pg.Pool({
  connectionString: config.LOCAL_DB_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
})

pool.on('error', (err) => {
  logger.error({ err }, 'pg pool error')
})

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
