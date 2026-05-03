import { config } from './config.js'
import { logger } from './lib/logger.js'
import { pool } from './db/pool.js'
import { runMigrations } from './db/migrate.js'
import { setWorkerId } from './lib/snowflake.js'
import { startClockAnchor } from './services/clock-anchor.js'
import { startCatalogPuller } from './services/catalog-puller.js'
import { startRecipePuller } from './services/recipe-puller.js'
import { startStockPuller } from './services/stock-puller.js'
import { startOutboxRelay } from './services/outbox-relay.js'
import { createApp } from './app.js'

async function bootstrap() {
  await runMigrations()

  // Load worker_id from device_meta if provisioned; otherwise default to 1 for dev.
  const { rows } = await pool.query<{ value: { worker_id: number } }>(
    `SELECT value FROM device_meta WHERE key = 'worker_id'`
  )
  const workerId = rows[0]?.value?.worker_id ?? 1
  setWorkerId(workerId)
  logger.info({ workerId, outletId: config.OUTLET_ID }, 'agent booting')

  const app = await createApp(workerId)

  await app.listen({ port: config.AGENT_PORT, host: config.AGENT_HOST })
  logger.info({ port: config.AGENT_PORT }, 'agent listening')

  startClockAnchor()
  startCatalogPuller()
  startRecipePuller()
  startStockPuller()
  startOutboxRelay()

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down')
    await app.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

bootstrap().catch(err => {
  logger.error({ err: String(err), stack: err.stack }, 'agent bootstrap failed')
  process.exit(1)
})
