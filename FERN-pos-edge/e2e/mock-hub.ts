import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

type Terminal = {
  registerCode: string
  displayName: string
  outletId: number
  deviceId: number
}

type Session = {
  id: number
  outletId: number
  deviceId: number
  registerCode: string
  registerDisplayName: string
  openedByUserId: number
  openedByUsername: string
  status: 'open'
  openedAt: string
  businessDate: string
  managerId: number
  cashFloat: string
}

type MenuItemName = 'Cold Brew' | 'SSE Latte'

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [key, ...rest] = part.split('=')
        return [key, decodeURIComponent(rest.join('='))]
      }),
  )
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) as T : {} as T
}

function sessionView(session: Session) {
  return {
    id: session.id,
    outletId: session.outletId,
    deviceId: session.deviceId,
    registerCode: session.registerCode,
    registerDisplayName: session.registerDisplayName,
    openedByUserId: session.openedByUserId,
    openedByUsername: session.openedByUsername,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: null,
    businessDate: session.businessDate,
    managerId: session.managerId,
    cashFloat: session.cashFloat,
    closingCash: null,
    note: null,
  }
}

function menuView(productName: MenuItemName) {
  return {
    id: 1,
    code: 'MAIN',
    name: 'Main Menu',
    description: null,
    status: 'active',
    scopeType: 'outlet',
    scopeId: 1,
    categories: [
      {
        id: 10,
        code: 'COFFEE',
        name: 'Coffee',
        displayOrder: 1,
        items: [
          {
            id: 1001,
            productId: 501,
            productCode: 'CF-01',
            productName,
            productStatus: 'active',
            displayOrder: 1,
            isActive: true,
            priceCents: 45000,
            variants: [],
            modifierGroups: [],
          },
        ],
      },
    ],
  }
}

export class MockHubServer {
  private server: http.Server | null = null
  private readonly sseClients = new Set<ServerResponse>()
  private readonly terminals = new Map<string, Terminal>()
  private readonly sessions = new Map<string, Session>()
  private lanReachable = true
  private nextDeviceId = 100
  private nextSessionId = 1
  private productName: MenuItemName = 'Cold Brew'

  get openSessionCount() {
    return this.sessions.size
  }

  async start(port: number): Promise<string> {
    this.server = http.createServer((request, response) => {
      void this.handle(request, response)
    })
    await new Promise<void>((resolve) => {
      this.server!.listen(port, '127.0.0.1', resolve)
    })
    const address = this.server.address() as AddressInfo
    return `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    for (const client of this.sseClients) {
      client.end()
    }
    this.sseClients.clear()
    if (!this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server!.close(error => error ? reject(error) : resolve())
    })
    this.server = null
  }

  reset(): void {
    this.setLanReachable(true)
    this.terminals.clear()
    this.sessions.clear()
    this.nextDeviceId = 100
    this.nextSessionId = 1
    this.productName = 'Cold Brew'
  }

  setLanReachable(reachable: boolean): void {
    this.lanReachable = reachable
    if (!reachable) {
      for (const client of this.sseClients) {
        client.destroy()
      }
      this.sseClients.clear()
    }
  }

  renameProduct(name: MenuItemName): void {
    this.productName = name
    this.publish('menu.updated', { menuVersion: Date.now() })
  }

  publish(type: string, payload: Record<string, unknown> | null = null): void {
    const event = `event: ${type}\ndata: ${JSON.stringify({
      type,
      at: new Date().toISOString(),
      payload,
    })}\n\n`
    for (const client of this.sseClients) {
      client.write(event)
    }
  }

  private setCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin ?? '*'
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Vary', 'Origin')
  }

  private sendJson(request: IncomingMessage, response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.setCors(request, response)
    response.writeHead(status, {
      'Content-Type': 'application/json',
      ...headers,
    })
    response.end(JSON.stringify(body))
  }

  private terminalFromRequest(request: IncomingMessage): Terminal | null {
    const cookies = parseCookies(request.headers.cookie)
    const registerCode = cookies.fern_terminal
    return registerCode ? this.terminals.get(registerCode) ?? null : null
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.setCors(request, response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!this.lanReachable) {
      this.sendJson(request, response, 503, { message: 'hub_unreachable' })
      return
    }

    if (url.pathname === '/api/local/events' || url.pathname === '/api/v1/local/events') {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': request.headers.origin ?? '*',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      this.sseClients.add(response)
      response.write(`event: connected\ndata: ${JSON.stringify({
        type: 'connected',
        at: new Date().toISOString(),
        payload: { ok: true },
      })}\n\n`)
      request.on('close', () => {
        this.sseClients.delete(response)
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      this.sendJson(request, response, 200, {
        offline: true,
        offline_grace_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        user: { id: 11, username: 'cashier', display_name: 'Cashier 1', role: 'cashier' },
        scopes: [{ outlet_id: 1, role: 'cashier' }],
      }, {
        'Set-Cookie': 'fern_edge_session=test-edge; Path=/; SameSite=Lax',
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      const cookies = parseCookies(request.headers.cookie)
      if (!cookies.fern_edge_session) {
        this.sendJson(request, response, 401, { message: 'unauthenticated' })
        return
      }
      this.sendJson(request, response, 200, {
        id: 11,
        username: 'cashier',
        display_name: 'Cashier 1',
        scopes: [{ outlet_id: 1, role: 'cashier' }],
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/auth/lease-offline') {
      const cookies = parseCookies(request.headers.cookie)
      if (!cookies.fern_edge_session) {
        this.sendJson(request, response, 401, { message: 'unauthenticated' })
        return
      }
      this.sendJson(request, response, 200, {
        offline_grace_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/local/device/me') {
      const terminal = this.terminalFromRequest(request)
      this.sendJson(request, response, 200, terminal ? {
        device_id: terminal.deviceId,
        worker_id: 7,
        outlet_id: terminal.outletId,
        register_code: terminal.registerCode,
        display_name: terminal.displayName,
        paired_at: new Date().toISOString(),
        paired: true,
      } : {
        device_id: null,
        worker_id: 7,
        outlet_id: 1,
        register_code: null,
        display_name: null,
        paired: false,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/local/device/pair') {
      const body = await readJson<{ registerCode?: string; displayName?: string }>(request)
      const registerCode = body.registerCode ?? `POS-${this.nextDeviceId}`
      const terminal: Terminal = {
        registerCode,
        displayName: body.displayName ?? registerCode,
        outletId: 1,
        deviceId: this.nextDeviceId++,
      }
      this.terminals.set(registerCode, terminal)
      this.sendJson(request, response, 200, {
        device_id: terminal.deviceId,
        worker_id: 7,
        outlet_id: terminal.outletId,
        register_code: terminal.registerCode,
        display_name: terminal.displayName,
        paired_at: new Date().toISOString(),
        paired: true,
      }, {
        'Set-Cookie': `fern_terminal=${encodeURIComponent(registerCode)}; Path=/; SameSite=Lax`,
      })
      this.publish('device.paired', { registerCode })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/local/session/current') {
      const terminal = this.terminalFromRequest(request)
      const session = terminal ? this.sessions.get(terminal.registerCode) : null
      this.sendJson(request, response, 200, session ? sessionView(session) : null)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/sales/pos-sessions') {
      const terminal = this.terminalFromRequest(request)
      if (!terminal) {
        this.sendJson(request, response, 409, { message: 'terminal_not_paired' })
        return
      }
      const body = await readJson<{ outletId: number; cashFloat?: string; takeover?: boolean }>(request)
      const existing = this.sessions.get(terminal.registerCode)
      if (existing && !body.takeover) {
        this.sendJson(request, response, 409, {
          error: 'register_in_use',
          warning_code: 'register_in_use',
          message: `Register ${terminal.registerCode} is already open.`,
        })
        return
      }
      const session = existing ?? {
        id: this.nextSessionId++,
        outletId: body.outletId,
        deviceId: terminal.deviceId,
        registerCode: terminal.registerCode,
        registerDisplayName: terminal.displayName,
        openedByUserId: 11,
        openedByUsername: 'cashier',
        status: 'open' as const,
        openedAt: new Date().toISOString(),
        businessDate: '2026-04-25',
        managerId: 11,
        cashFloat: body.cashFloat ?? '0',
      }
      this.sessions.set(terminal.registerCode, session)
      this.publish('session.updated', { registerCode: terminal.registerCode })
      this.sendJson(request, response, 200, sessionView(session))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/sync/manifest') {
      this.sendJson(request, response, 200, {
        outlet_id: 1,
        outbox: { pending: 0, failed: 0, stale_syncing: 0 },
        catalog_cursor: { value: { cursor: 'catalog' }, updated_at: new Date().toISOString() },
        stock_cursor: null,
        recipe_cursor: null,
        menu_version: this.productName === 'Cold Brew' ? 1 : 2,
        clock_anchor: null,
        server_time: new Date().toISOString(),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/product/menus') {
      this.sendJson(request, response, 200, [menuView(this.productName)])
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/product/menus/1') {
      this.sendJson(request, response, 200, menuView(this.productName))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/inventory/products/501/availability') {
      this.sendJson(request, response, 200, {
        product_id: 501,
        outlet_id: 1,
        qty_available: 99,
        tracked_by_recipe: true,
        basis: 'recipe',
        last_synced_at: new Date().toISOString(),
      })
      return
    }

    this.sendJson(request, response, 404, { message: `No mock route for ${request.method} ${url.pathname}` })
  }
}
