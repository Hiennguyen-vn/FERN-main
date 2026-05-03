import type { FastifyInstance } from 'fastify'
import type { ServerResponse } from 'node:http'
import { isAllowedOrigin } from '../config.js'

type LocalEventPayload = Record<string, unknown> | null

const clients = new Set<ServerResponse>()
const HEARTBEAT_MS = 25_000

function formatSse(eventType: string, payload: LocalEventPayload) {
  return `event: ${eventType}\ndata: ${JSON.stringify({
    type: eventType,
    at: new Date().toISOString(),
    payload,
  })}\n\n`
}

function writeSafe(client: ServerResponse, message: string) {
  try {
    client.write(message)
    return true
  } catch {
    clients.delete(client)
    return false
  }
}

export function publishLocalEvent(eventType: string, payload: LocalEventPayload = null) {
  const message = formatSse(eventType, payload)
  for (const client of clients) {
    writeSafe(client, message)
  }
}

export function registerLocalEventRoutes(app: FastifyInstance): void {
  const registerHandler = async (request: any, reply: any) => {
    const origin = request.headers.origin as string | undefined
    if (isAllowedOrigin(origin) && origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
      reply.raw.setHeader('Vary', 'Origin')
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    const client = reply.raw
    clients.add(client)
    writeSafe(client, formatSse('connected', { ok: true }))
    const heartbeat = setInterval(() => {
      writeSafe(client, ': ping\n\n')
    }, HEARTBEAT_MS)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(client)
      try {
        client.end()
      } catch {
        // already closed
      }
    })
  }

  app.get('/api/v1/local/events', registerHandler)
  app.get('/api/local/events', registerHandler)
}
