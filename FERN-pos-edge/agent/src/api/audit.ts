import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTx } from '../db/pool.js'
import { appendOutbox } from '../services/outbox-writer.js'
import { requireEdgeSession } from '../lib/edge-session.js'

const idSchema = z.union([z.string(), z.number()]).transform(String)
  .refine(s => /^\d{1,32}$/.test(s), { message: 'invalid_id' })

const auditEventSchema = z.object({
  event_id: idSchema,
  actor_user_id: z.number().int().nullable(),
  actor_username: z.string().max(64).nullable(),
  outlet_id: idSchema.nullable(),
  device_id: idSchema.nullable(),
  action: z.string().regex(/^[a-z_]{1,64}$/, 'invalid_action'),
  target_type: z.string().max(32).nullable().optional(),
  target_id: idSchema.nullable().optional(),
  payload: z.record(z.unknown()),
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/, 'invalid_hash'),
  created_at_device: z.number().int().nonnegative(),
})

const recordSchema = z.object({
  events: z.array(auditEventSchema).min(1).max(100),
})

export function registerAuditRoutes(app: FastifyInstance): void {
  app.post('/api/v1/audit/record', async (req, reply) => {
    try {
      requireEdgeSession(req)
    } catch (err: any) {
      return reply.code(err.statusCode ?? 401).send({ error: 'unauthorized' })
    }
    const body = recordSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', detail: body.error.format() })

    // Append each as a discrete outbox event. Server-side relay forwards to audit-service.
    // event_id from browser is the idempotency anchor end-to-end.
    await withTx(async client => {
      for (const evt of body.data.events) {
        await appendOutbox(client, {
          eventType: 'pos.audit.recorded',
          aggregateType: 'audit',
          aggregateId: evt.event_id,
          payload: evt,
          clientOccurredAt: new Date(evt.created_at_device),
        })
      }
    })
    return reply.send({ accepted: body.data.events.length })
  })
}
