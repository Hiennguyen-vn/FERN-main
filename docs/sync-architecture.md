# Offline-First Sync Architecture

## Problem

FERN runs a central server for chain operations and store edge servers for local selling during network outages. Store servers must keep selling against a local database, then sync store-owned transactions to central when connectivity returns. Central must distribute master data changes back to stores without letting one store read or write another store's private scope.

This design adds a dedicated `sync-service` and keeps existing business services unchanged. Existing APIs, sales logic, catalog logic, and reporting logic continue to run as-is.

## Current Backend Context

- Stack: Java 21, Spring Boot 3.5, Maven multi-module, Spring Cloud Gateway, JDBC repositories through `BaseRepository`, PostgreSQL, Redis, Kafka, Flyway SQL migrations.
- Runtime topology: shared PostgreSQL primary plus PostgreSQL replica for read-heavy consumers such as report paths, not database-per-service.
- Existing 12 services: `auth-service`, `master-node`, `org-service`, `hr-service`, `product-service`, `procurement-service`, `sales-service`, `inventory-service`, `payroll-service`, `finance-service`, `audit-service`, `report-service`.
- Existing sync-adjacent code: `sales-service` owns `/api/v1/sync` for POS catalog/stock pull and POS push. The new service uses `/api/sync` to avoid breaking that route.
- Service conventions: controllers in `api`, application services in `application`, JDBC repositories in `infrastructure`, DTO records in `api`, errors through `ServiceException` and the shared global exception handler.

## Added Components

- `services/sync-service`: central sync API and store-agent scaffold.
- `com.fern.common.sync.CentralSyncOutboxWriter`: shared writer for central master-data events.
- `com.fern.common.sync.LocalSyncOutboxWriter`: shared writer for store-local transaction events.
- `com.fern.common.sync.SyncPayloadSchemas`: shared payload records for product, category, price, menu, promotion, store config, item availability, sale order, payment, cash movement, and kitchen ticket sync events.
- `core.sync_nodes`: store node registry and status.
- `core.central_outbox`: central-to-store event stream.
- `core.central_inbox`: idempotent store-to-central accepted event log.
- `core.sync_outbox`, `core.sync_inbox`, `core.sync_cursor`, `core.local_node_config`: store-local sync agent tables.
- `core.sync_event_acks`, `core.sync_offsets`, `core.sync_conflicts`, `core.sync_logs`, `core.local_applied_versions`: operational tracking, cursors, conflict logging, and version checks.

## Central to Store

Central writes master-data changes into `central_outbox`.

Implemented publishers:

- `product-service` writes `PRODUCT_CREATED` / `PRODUCT_UPDATED` from `ProductRepository` in the same transaction as product mutation.
- `product-service` writes `CATEGORY_UPDATED` from product category create/update in the same transaction as category mutation.
- `product-service` writes `PRICE_POLICY_UPDATED` from `ProductRepository.upsertPrice` in the same transaction as price mutation.
- `product-service` writes `ITEM_AVAILABILITY_UPDATED` from product outlet availability changes.
- `product-service` writes `MENU_UPDATED` from `MenuRepository` for menu header/category/item mutations.
- `sales-service` writes `PROMOTION_UPDATED` from promotion create/update/status changes. Global promotions target all stores; outlet-scoped promotions target each outlet separately.
- `org-service` writes `STORE_CONFIG_UPDATED` from outlet create/update/status changes.

Examples:

- `PRODUCT_UPDATED`
- `CATEGORY_UPDATED`
- `MENU_UPDATED`
- `PRICE_POLICY_UPDATED`
- `PROMOTION_UPDATED`
- `STORE_CONFIG_UPDATED`
- `ITEM_AVAILABILITY_UPDATED`
- `TAX_POLICY_UPDATED` (planned)
- `PAYMENT_METHOD_UPDATED` (planned)

Rules:

- Central wins for product, category, menu, price policy, promotion, tax policy, and global item availability.
- Events carry `version` and `created_at`; store applies only newer versions for central-owned aggregates.
- Store calls `GET /api/sync/download?storeId=...&cursor=...`.
- Download only returns events with `target_scope = ALL_STORES` or `target_scope = STORE` for that `storeId`.
- Store calls `POST /api/sync/ack` after applying events.

## Store to Central

Store writes local transaction events into `sync_outbox` in the same local transaction as the business write.

Implemented publishers:

- `sales-service` writes `SALE_ORDER_CREATED` from `SalesRepository.submitSale`.
- `sales-service` writes `PAYMENT_CREATED` from `SalesRepository.markPaymentDone`.
- `sales-service` writes `SALE_ORDER_CANCELLED` from `SalesRepository.cancelSale`.
- `sales-service` writes `CASH_MOVEMENT_CREATED` from `CashMovementService.record`.
- `sales-service` writes `KITCHEN_TICKET_CREATED` and `KITCHEN_TICKET_UPDATED` from `KitchenTicketRepository`.

Examples:

- `SALE_ORDER_CREATED`
- `PAYMENT_CREATED`
- `KITCHEN_TICKET_CREATED`
- `KITCHEN_TICKET_UPDATED`
- `CASH_MOVEMENT_CREATED`
- `SALE_ORDER_CANCELLED`
- `STOCK_MOVEMENT_CREATED` (planned)
- `RETURN_ORDER_CREATED` (planned)

Rules:

- Store owns transaction data.
- Central appends accepted events to `central_inbox` by `store_id`.
- `central_inbox.event_id` is unique, so retries with the same event id are idempotent.
- Central rejects cross-store payloads where `payload.storeId`, `payload.store_id`, `payload.outletId`, or `payload.outlet_id` does not match request `storeId`.

## API

### Upload

`POST /api/sync/upload`

```json
{
  "nodeId": "store-10-edge-1",
  "storeId": 10,
  "events": [
    {
      "eventId": "sale-1001-created",
      "eventType": "SALE_ORDER_CREATED",
      "aggregateType": "SALE_ORDER",
      "aggregateId": "1001",
      "version": 1,
      "occurredAt": "2026-06-24T04:00:00Z",
      "payload": {
        "storeId": 10,
        "totalAmount": 79000,
        "pricePolicyVersion": 12
      }
    }
  ]
}
```

Response:

```json
{
  "accepted": ["sale-1001-created"],
  "duplicated": [],
  "rejected": []
}
```

### Download

`GET /api/sync/download?storeId=10&cursor=0`

```json
{
  "events": [
    {
      "eventId": "101",
      "eventType": "PRICE_POLICY_UPDATED",
      "aggregateType": "PRICE_POLICY",
      "aggregateId": "price-7",
      "version": 12,
      "occurredAt": "2026-06-24T04:00:00Z",
      "payload": {
        "storeId": 10,
        "unitPrice": 59000
      }
    }
  ],
  "nextCursor": "101",
  "hasMore": false
}
```

### Ack

`POST /api/sync/ack`

```json
{
  "nodeId": "store-10-edge-1",
  "storeId": 10,
  "events": [
    {
      "eventId": "101",
      "status": "APPLIED"
    }
  ]
}
```

### Status

`GET /api/sync/status/10`

Returns last upload/download timestamps and pending/error counters.

## Security

- Each store node is registered in `sync_nodes`.
- Internal provisioning calls `POST /api/sync/internal/nodes/provision` and receives a one-time visible `clientSecret`.
- Store edge calls `POST /api/sync/handshake` with `nodeId`, `storeId`, and `clientSecret`; central verifies the hash in `sync_nodes`, registers/refreshes `device_registry`, and returns a device JWT.
- Internal/user callers need internal service context, `superadmin`, `sync:nodes:manage`, or `sync:nodes:provision` for node administration endpoints.
- Credential rotation: `POST /api/sync/internal/nodes/{nodeId}/rotate-secret` returns a new one-time visible `clientSecret`.
- Revocation: `POST /api/sync/internal/nodes/{nodeId}/revoke` marks the node `REVOKED` and revokes its device token.
- Gateway treats `/api/sync` as device-class traffic.
- Device/JWT context must match requested `storeId`.
- Active node check requires `sync_nodes.id = nodeId`, matching `store_id`, and `status = ACTIVE`.
- Store A cannot upload payloads for Store B.
- Store A cannot download Store B targeted events.
- Internal service calls can publish central outbox events through `POST /api/sync/internal/central-outbox`.

## Payload Schema

Payloads are emitted with shared Java records in `SyncPayloadSchemas` instead of ad-hoc maps:

- `ProductPayload`: `productId`, `code`, `name`, `categoryCode`, `status`, `imageUrl`, `description`, `deleted`, `version`, `updatedAt`.
- `CategoryPayload`: `categoryId`, `code`, `name`, `parentCategoryId`, `status`, `version`, `updatedAt`.
- `PricePolicyPayload`: `productId`, `outletId`, `currencyCode`, `priceValue`, `effectiveFrom`, `effectiveTo`, `version`, `updatedAt`.
- `MenuPayload`: menu header plus categories and menu items.
- `PromotionPayload`: promotion header, outlet scope list, and promotion rule DTOs.
- `StoreConfigPayload`: outlet/store identity, code, name, region, status, timezone, version, and update time.
- `ItemAvailabilityPayload`: product/outlet identity, global/store availability flags, reason, version, and update time.
- `SaleOrderPayload`: sale header, immutable sale-time line prices, discounts, taxes, totals, and created time.
- `PaymentTransactionPayload`: payment method, amount, currency, status, payment time, and transaction reference.
- `SaleOrderCancelledPayload`, `CashMovementPayload`, and `KitchenTicketPayload`: store-owned operational events for append-only central ingestion.

## Store Apply Handlers

The store-side agent routes downloaded events by `eventType` and `aggregateType`.

Implemented handlers:

- `PRODUCT_CREATED` / `PRODUCT_UPDATED`: upserts `core.product`.
- `CATEGORY_UPDATED`: upserts `core.product_category`.
- `PRICE_POLICY_UPDATED`: upserts `core.product_price`.
- `MENU_UPDATED`: replaces the downloaded menu tree in `core.menu`, `core.menu_category`, `core.menu_item`, and `core.menu_item_exclusion`.
- `ITEM_AVAILABILITY_UPDATED`: upserts `core.product_outlet_availability`.
- `STORE_CONFIG_UPDATED`: upserts `core.outlet`.
- `PROMOTION_UPDATED`: upserts `core.promotion` and replaces `core.promotion_scope`.

Central-owned handlers record applied versions in `local_applied_versions` and skip older versions.

## Conflict Rules

- Product, category, menu, price policy, promotion, tax policy: Central wins.
- Sale order, payment, kitchen ticket: Store owns; central append-only.
- Stock movement: append movement; never overwrite balance directly.
- Item availability: `canSell = globalAvailable AND storeAvailable`.
- Unknown conflicts are recorded to `sync_conflicts` for manual review.

## Version Rules

- Central-to-store events carry a monotonically increasing `version` or cursor id.
- Store records applied versions in `local_applied_versions`.
- Store applies central-owned aggregates only if incoming version is newer.
- Orders must preserve `price_policy_version` and `unit_price_at_sale_time` in payload/domain storage so historical orders are not repriced.

## Retry Rules

- Store sync agent reads `sync_outbox` where status is `PENDING` or `FAILED`.
- Successful upload marks accepted or duplicated events as `SENT`.
- Network failures mark events `FAILED`, increment `retry_count`, and store `last_error`.
- Events are retained after send for auditability.

## Running

Local Maven:

```bash
mvn -pl services/sync-service -am spring-boot:run
```

Docker Compose:

```bash
cd infra
docker compose up sync-service gateway
```

Important config:

- `SYNC_MODE=CENTRAL` or `SYNC_MODE=STORE`
- `SYNC_ENABLED=true`
- `SYNC_LOCAL_OUTBOX_ENABLED=true` on store-edge business services that should write `core.sync_outbox`
- `SYNC_UPLOAD_INTERVAL_SECONDS=15`
- `SYNC_DOWNLOAD_INTERVAL_SECONDS=15`
- `SYNC_BATCH_SIZE=100`
- `CENTRAL_SYNC_URL=http://sync-service:8094`
- `SYNC_NODE_ID=store-10-edge-1`
- `SYNC_STORE_ID=10`

## Example Flows

Central price update:

1. `product-service` calls `ProductRepository.upsertPrice`, which writes `PRICE_POLICY_UPDATED` to `central_outbox` in the same transaction.
2. Store calls `/api/sync/download?storeId=10&cursor=<last>`.
3. Store applies the event if version is newer.
4. Store records ack through `/api/sync/ack`.

Store offline order:

1. Sales service on store edge writes sale order to local DB.
2. `SalesRepository.submitSale` writes `SALE_ORDER_CREATED` to `sync_outbox` in the same local transaction.
3. Store agent uploads batch to `/api/sync/upload` when network returns.
4. Central stores the event in `central_inbox`; duplicate retries return `duplicated`.

## Integration Still Needed

- Wire tax policy and payment method mutations to `central_outbox` once their owning write paths are finalized.
- Wire inventory stock movement and return-order transaction writes to `sync_outbox`. Inventory already has offline movement/event paths, so this should be designed carefully to avoid duplicate stock movement ingestion.
- Extend promotion store apply beyond header/scope to typed rule tables such as `promotion_bxgy_rule`, `promotion_combo_rule`, and `promotion_subsidy_rule`.
- Add region/reference-data sync required by `STORE_CONFIG_UPDATED` before applying outlets whose `region_id` is not yet present locally.
- Replace timestamp-suffixed `KITCHEN_TICKET_UPDATED` event ids with a deterministic persisted event sequence if exact update deduplication is required across transaction retries.
- Add operational dashboards over `sync_logs`, `sync_conflicts`, and status counters.
