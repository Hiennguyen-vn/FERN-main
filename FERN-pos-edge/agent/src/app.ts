import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'
import { config, isAllowedOrigin } from './config.js'
import { registerAuthRoutes } from './api/auth.js'
import { registerCatalogRoutes } from './api/catalog.js'
import { registerDeviceRoutes } from './api/devices.js'
import { registerSalesRoutes } from './api/sales.js'
import { registerSyncRoutes } from './api/sync.js'
import { registerAuditRoutes } from './api/audit.js'
import { registerInventoryRoutes } from './api/inventory.js'
import { registerLocalEventRoutes } from './services/local-events.js'

export async function createApp(workerId: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true })
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    exposedHeaders: ['Content-Type', 'Cache-Control'],
  })

  app.get('/health', async () => ({
    status: 'ok',
    outlet_id: config.OUTLET_ID,
    worker_id: workerId,
    upstream: config.FERN_GATEWAY_URL,
  }))

  registerAuthRoutes(app)
  registerCatalogRoutes(app)
  registerDeviceRoutes(app)
  registerSalesRoutes(app)
  registerInventoryRoutes(app)
  registerSyncRoutes(app)
  registerAuditRoutes(app)
  registerLocalEventRoutes(app)

  return app
}
