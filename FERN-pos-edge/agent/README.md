# FERN POS Edge — Node Agent

Local outlet-side backend. Runs on the preconfigured outlet mini server. LAN POS
terminals authenticate locally with user/PIN; the mini server stores the central
Device JWT and is the only component that syncs upstream to the FERN gateway.

## Architecture

```
LAN POS terminal (Chrome/Edge)  ─HTTP→  Agent (mini-server:8099)  ─pg→  Postgres
                                                │
                                                └──HTTPS + Device JWT→ FERN central
```

- PWA keeps its FERN-compatible REST contract — it only switches `baseURL` to the agent.
- Browser terminals never store a central JWT; their local session token is only valid on the LAN agent.
- Agent owns sales, sessions, payments, and catalog reads locally.
- Outbox relay pushes `pos.session.opened | pos.sale.* | pos.payment.captured` events to `/api/v1/sync/push`, retries with exponential backoff.
- Catalog / stock / clock pullers fetch updates from FERN when online.
- Upstream calls require a paired Device JWT; shared internal/service tokens are not supported for sync.

## Local dev

Requirements: Node 20, Docker Desktop.

```bash
# 1. Start local Postgres
cd ../infra
docker compose up -d postgres-edge

# 2. Install + run agent (auto-applies migrations on boot)
cd ../agent
cp .env.example .env
npm install
npm run dev
```

In development, the agent listens on `http://localhost:8099`. In outlet
deployment, bind it to the mini server LAN interface, for example
`http://192.168.1.10:8099`.

Smoke check:

```bash
curl http://localhost:8099/health
curl http://localhost:8099/api/v1/sync/manifest
```

## Endpoints served locally

| Path | Purpose |
|---|---|
| `POST /api/v1/auth/login` | Local user/PIN login; creates a LAN-only session |
| `GET /api/v1/auth/me` | Local session identity |
| `POST /api/v1/auth/logout` | Clear local session |
| `POST /api/v1/auth/lease-offline` | Proxy FERN; store `offline_grace_until` |
| `POST /api/v1/devices/provision` | Proxy FERN, cache `device_id` + `worker_id` |
| `POST /api/v1/devices/pair` | Redeem central pair token and persist Device JWT on the mini server |
| `GET /api/v1/devices/current` | Local cached device info |
| `GET /api/v1/product/menus` | Local catalog (FERN-compatible MenuView) |
| `GET /api/v1/product/prices` | Local prices |
| `GET /api/v1/menus` | Simplified menu + current price |
| `GET /api/v1/inventory/stock-balances` | Local stock snapshot |
| `POST /api/v1/sales/pos-sessions` | Open session (id via pos_session_id_seq) |
| `POST /api/v1/sales/pos-sessions/:id/close` | Close — 409 if outbox non-empty |
| `POST /api/v1/sales/orders` | Submit sale — writes local + outbox |
| `POST /api/v1/sales/orders/:id/approve` | Approve |
| `POST /api/v1/sales/orders/:id/mark-payment-done` | Capture payment |
| `POST /api/v1/sales/orders/:id/cancel` | Void |
| `POST /api/v1/sales/orders/:id/refund` | Refund |
| `GET /api/v1/sync/manifest` | Local sync status (outbox depth, cursors) |

## Env vars

| Key | Default | Notes |
|---|---|---|
| `LOCAL_DB_URL` | — | e.g. `postgresql://pos:pos_dev@localhost:5434/pos_edge` |
| `FERN_GATEWAY_URL` | — | e.g. `http://localhost:8080` |
| `OUTLET_ID` | `1` | Outlet this agent belongs to |
| `DEVICE_ID` | *(empty)* | Populated by provision flow |
| `DEVICE_TOKEN_FILE` | `./device-token.json` | Local file where the paired Device JWT is persisted |
| `EDGE_SESSION_SECRET` | *(generated for loopback dev)* | Required when `AGENT_HOST` is not loopback; use a stable 32+ char secret |
| `AGENT_PORT` | `8099` | HTTP listen port |
| `AGENT_HOST` | `127.0.0.1` | Bind host; use `0.0.0.0` on the mini server for LAN POS terminals |
| `ALLOWED_ORIGINS` | local dev origins | Comma-separated browser origins allowed to call the agent |
| `LOG_LEVEL` | `info` | pino level |

## Windows deployment

1. Install Node 20 LTS.
2. Install Postgres 16 (or use Docker Desktop container).
3. Copy repo to `C:\pos-edge\`.
4. `npm install && npm run build` in `agent/`.
5. Register as Windows service via `nssm install fern-pos-agent "C:\Program Files\nodejs\node.exe" "C:\pos-edge\agent\dist\index.js"`.
6. Configure POS terminals to call the mini server LAN URL, for example `http://192.168.1.10:8099`.
7. Daily backup: scheduled `pg_dump -U pos pos_edge > D:\backups\pos_edge_$(date).sql`.
