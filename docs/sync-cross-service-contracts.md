# Sync Cross-Service Contracts

## Purpose

This document defines the current cross-service sync contracts between publisher services and `sync-service`.

Its goal is to make producer/consumer ownership explicit so that payload, aggregate, or event changes are treated as contract changes rather than internal refactors.

## Contract Boundary

Cross-service sync contracts do not depend on internal `sync-service` packages.

They currently flow through:

- `com.fern.common.sync.CentralSyncOutboxWriter`
- `com.fern.common.sync.LocalSyncOutboxWriter`
- `com.fern.common.sync.SyncPayloadSchemas`
- `core.central_outbox`
- `core.sync_outbox`

That means:

- changing `central.*`, `edge.*`, `transport.http`, `state`, `apply`, or `tier` inside `sync-service` is usually an internal refactor
- changing `SyncPayloadSchemas`, outbox writer semantics, aggregate names, event names, or handler-required payload fields is a cross-service contract change

## Producer To Consumer Matrix

### Central-to-store contracts

| Producer service | Producer class | Event type | Aggregate type | Payload schema | Outbox | `sync-service` consumer |
|---|---|---|---|---|---|---|
| `product-service` | `ProductRepository` | `PRODUCT_CREATED`, `PRODUCT_UPDATED` | `PRODUCT` | `SyncPayloadSchemas.ProductPayload` | `core.central_outbox` | `apply.handlers.ProductSyncPayloadHandler` |
| `product-service` | `ProductRepository` | `CATEGORY_UPDATED` | `CATEGORY` | `SyncPayloadSchemas.CategoryPayload` | `core.central_outbox` | `apply.handlers.CategorySyncPayloadHandler` |
| `product-service` | `ProductRepository` | `PRICE_POLICY_UPDATED` | `PRICE_POLICY` | `SyncPayloadSchemas.PricePolicyPayload` | `core.central_outbox` | `apply.handlers.PricePolicySyncPayloadHandler` |
| `product-service` | `ProductRepository` | `ITEM_AVAILABILITY_UPDATED` | `ITEM_AVAILABILITY` | `SyncPayloadSchemas.ItemAvailabilityPayload` | `core.central_outbox` | `apply.handlers.ItemAvailabilitySyncPayloadHandler` |
| `product-service` | `MenuRepository` | `MENU_UPDATED` | `MENU` | `SyncPayloadSchemas.MenuPayload` | `core.central_outbox` | `apply.handlers.MenuSyncPayloadHandler` |
| `sales-service` | `SalesPromotionRepository` | `PROMOTION_UPDATED` | `PROMOTION` | `SyncPayloadSchemas.PromotionPayload` | `core.central_outbox` | `apply.handlers.PromotionSyncPayloadHandler` |
| `org-service` | `OrgRepository` | `STORE_CONFIG_UPDATED` | `STORE_CONFIG` | `SyncPayloadSchemas.StoreConfigPayload` | `core.central_outbox` | `apply.handlers.StoreConfigSyncPayloadHandler` |

### Store-to-central contracts

These contracts are currently ingested by `sync-service` central upload flow and persisted in `core.central_inbox`.

| Producer service | Producer class | Event type | Aggregate type | Payload schema | Outbox | `sync-service` consumer |
|---|---|---|---|---|---|---|
| `sales-service` | `SalesRepository` | `SALE_ORDER_CREATED` | `SALE_ORDER` | `SyncPayloadSchemas.SaleOrderPayload` | `core.sync_outbox` | central upload/inbox acceptance via `SyncUploadService` |
| `sales-service` | `SalesRepository` | `PAYMENT_CREATED` or `PAYMENT_TRANSACTION` payload family | `PAYMENT_TRANSACTION` | `SyncPayloadSchemas.PaymentTransactionPayload` | `core.sync_outbox` | central upload/inbox acceptance via `SyncUploadService` |
| `sales-service` | `SalesRepository` | `SALE_ORDER_CANCELLED` | `SALE_ORDER` | `SyncPayloadSchemas.SaleOrderCancelledPayload` | `core.sync_outbox` | central upload/inbox acceptance via `SyncUploadService` |
| `sales-service` | `CashMovementService` | `CASH_MOVEMENT_CREATED` | `CASH_MOVEMENT` | `SyncPayloadSchemas.CashMovementPayload` | `core.sync_outbox` | central upload/inbox acceptance via `SyncUploadService` |
| `sales-service` | `KitchenTicketRepository` | `KITCHEN_TICKET_CREATED`, `KITCHEN_TICKET_UPDATED` | `KITCHEN_TICKET` | `SyncPayloadSchemas.KitchenTicketPayload` | `core.sync_outbox` | central upload/inbox acceptance via `SyncUploadService` |

## Handler Expectations That Matter

The following are the most important field-level expectations currently enforced by `sync-service` handlers:

### `ProductSyncPayloadHandler`

- requires or derives `productId`
- expects `code`, `name`, `categoryCode`, `status`
- tolerates optional `categoryName`, `imageUrl`, `description`, `deleted`

### `CategorySyncPayloadHandler`

- expects `code`, `name`
- consumes optional `active`, `description`

### `PricePolicySyncPayloadHandler`

- requires `productId`
- requires `storeId` or `outletId`
- requires `priceValue` or `unitPrice`
- consumes optional `currencyCode`, `effectiveFrom`, `effectiveTo`

### `ItemAvailabilitySyncPayloadHandler`

- requires `productId`
- requires `outletId` or `storeId`
- expects `available`

### `MenuSyncPayloadHandler`

- requires or derives `menuId`
- expects `code`, `name`, `status`, `scopeType`
- consumes nested `categories[*].categoryId` and `categories[*].items[*].menuItemId`

### `PromotionSyncPayloadHandler`

- requires or derives `promotionId`
- expects `name`, `promoType`, `status`
- consumes optional `valueAmount`, `valuePercent`, `effectiveFrom`, `effectiveTo`, `outletIds`

### `StoreConfigSyncPayloadHandler`

- requires `storeId` or `outletId`
- requires `regionId`
- expects `code`, `name`, `status`
- consumes optional `address`, `phone`, `email`, `openedAt`, `closedAt`

## Review Rules

Treat the following as cross-service contract changes:

- renaming `eventType`
- renaming `aggregateType`
- changing `SyncPayloadSchemas` field names or required fields
- changing outbox direction (`central_outbox` vs `sync_outbox`)
- changing handler-required payload semantics

Treat the following as internal `sync-service` refactors:

- moving code between `central`, `edge`, `transport.http`, `state`, `apply`, `tier`, `orchestration`
- changing `CentralSyncFacade` composition
- moving adapter implementations under a clearer technical package

## Immediate Test Priorities

The highest-value contract tests to add next are:

1. `product-service` payload compatibility with `ProductSyncPayloadHandler`, `CategorySyncPayloadHandler`, `PricePolicySyncPayloadHandler`, `ItemAvailabilitySyncPayloadHandler`, and `MenuSyncPayloadHandler`
2. `org-service` `StoreConfigPayload` compatibility with `StoreConfigSyncPayloadHandler`
3. `sales-service` transactional payload acceptance for central upload scope checks and ingest assumptions
