# Sync Service Operations

## Runtime Roles

`sync-service` currently supports two runtime roles inside one codebase:

- `centralRole`: `SYNC_MODE=CENTRAL`
- `edgeRole`: `SYNC_MODE=STORE`

The long-term direction is to keep these roles operationally distinct now and only split them into separate deployables later if the lifecycle and observability are mature enough.

## Central Role

Responsibilities:

- serve `/api/sync/upload`
- serve `/api/sync/download`
- serve `/api/sync/ack`
- serve `/api/sync/status/*`
- provision/revoke/rotate sync nodes
- manage central inbox/outbox and global sync status

Operational expectations:

- `syncRuntime.role=centralRole` in health details
- no scheduler-driven edge upload/download loop should be relied on

## Edge Role

Responsibilities:

- claim local outbox safely
- upload store-originated events
- download central events
- apply payloads locally
- send ack and persist cursor

Required configuration:

- `SYNC_MODE=STORE`
- `SYNC_NODE_ID`
- `SYNC_STORE_ID`
- `CENTRAL_SYNC_URL`

Operational expectations:

- `syncRuntime.role=edgeRole` in health details
- `core.sync_offsets` should advance for stream `central-outbox`
- `core.sync_logs` should contain both `STORE_TO_CENTRAL` and `CENTRAL_TO_STORE` batches

## Key Operational Tables

- `core.sync_outbox`: local pending uploads
- `core.sync_offsets`: per-node cursor state
- `core.sync_logs`: batch-level operational logs
- `core.sync_conflicts`: apply conflicts / manual review queue
- `core.sync_event_acks`: central acknowledgement history

## Recommended Alerts

- high count of `core.sync_conflicts` rows in `OPEN`
- `core.sync_outbox` backlog growing while `sync_logs` show repeated `FAILED`
- `core.sync_offsets.last_cursor` stalled for active edge nodes
- repeated upload/download failures for one `node_id`

## Split Decision Checklist

Consider splitting into `sync-central-service` and `sync-edge-agent` only when:

- both sync directions are stable end-to-end
- retry/delivery semantics are finalized
- observability is strong enough to debug cross-runtime failures
- deployment cadence differs between central and edge
- team ownership or blast radius concerns justify the extra operational surface
