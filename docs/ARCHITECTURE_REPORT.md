# FERN ERP Backend - Engineering Architecture Report

## 1. Executive Summary

### What this repository is
FERN (Finance, ERP, Retail, Network) is a Java 21 Maven multi-module microservices backend for an ERP/retail system. It implements a distributed architecture with 11 domain services, a control-plane master-node, and a Spring Cloud Gateway for routing.

### What is already implemented
- **Infrastructure layer**: PostgreSQL 16, Redis 7, Kafka 3.9 via Docker Compose (`infra/docker-compose.yml`)
- **Shared libraries**: All 4 common modules fully implemented:
  - `common-utils`: Snowflake ID generation, configuration loading, crypto utilities
  - `common-model`: Tiered cache (Redis + in-memory), database factory, message queue factory
  - `idempotency-core`: Two-tier idempotency (Redis L1 + PostgreSQL L2)
  - `service-common`: BaseRepository, auth context, auth middleware, heartbeat agent, event publisher
  - `event-schemas`: EventEnvelope and domain event records (Auth, Org, Product, Sales, Inventory, Procurement, HR, Payroll, Audit events)
- **Gateway**: Spring Cloud Gateway with authentication filter and route catalog (`gateway/`) - **COMPILES**
- **Master-node**: Control-plane with service registry, heartbeat management (`services/master-node/`) - **COMPILES**
- **Auth-service**: Spring-based implementation with JWT handling (`services/auth-service/spring/`) - **COMPILES**
- **Org-service**: Organization/outlet management (`services/org-service/`) - **COMPILES**
- **Product-service**: Product/catalog management (`services/product-service/`) - **COMPILES**
- **Sales-service**: POS session and sale record handling (`services/sales-service/`) - **COMPILES**
- **Inventory-service**: Inventory transaction management (`services/inventory-service/`) - **COMPILES**
- **HR-service**: HR management (`services/hr-service/`) - **COMPILES**
- **Procurement-service**: Procurement management (`services/procurement-service/`) - **COMPILES**
- **Payroll-service**: Payroll processing (`services/payroll-service/`) - **COMPILES**
- **Finance-service**: Finance tracking (`services/finance-service/`) - **COMPILES**
- **Audit-service**: Audit logging (`services/audit-service/`) - **COMPILES**
- **Report-service**: Reporting (`services/report-service/`) - **COMPILES**
- **Database schema**: Core schema with auth, org, product, sales, inventory tables (`db/migrations/V1-V6__.sql`)

### What is still scaffolded or partial
- Business logic implementation depth varies by service
- Event consumers need to be wired up in each service
- Some event-driven flows are documented but not fully implemented

### What kind of system it is trying to become
A full-featured ERP system for retail/hospitality with:
- Multi-outlet, multi-region support
- Real-time POS and inventory management
- Procurement and supply chain tracking
- HR and payroll processing
- Finance and expense tracking
- Audit logging and compliance
- Centralized control-plane for service orchestration

---

## 2. Repository Map

```
/Users/nguyendinhkhiem/Development/Javas/FERN/
├── pom.xml                              # Root parent POM (Java 21, Spring Boot 3.5.12)
├── README.md                            # Project overview
├── CLAUDE.md                            # Claude Code rules
├── docs/
│   ├── README.md                        # Documentation index
│   ├── project-structure.md             # Module structure documentation
│   ├── common-modules.md                # Shared library documentation
│   ├── architecture-overview.md         # System architecture
│   ├── erp-microservices-architecture.md # ERP domain architecture
│   └── testing-and-running.md           # Build/run instructions
├── common/                              # Shared libraries (Maven reactor)
│   ├── pom.xml
│   ├── common-utils/                    # Utilities (Snowflake IDs, config, crypto)
│   ├── common-model/                    # Cache, database, message abstractions
│   ├── idempotency-core/                # Two-tier idempotency guard
│   ├── service-common/                  # Service runtime helpers
│   └── event-schemas/                   # EventEnvelope and domain events
├── gateway/                             # Spring Cloud Gateway (port 8080)
│   ├── pom.xml
│   └── src/main/java/com/fern/gateway/
│       ├── GatewayApplication.java
│       ├── security/GatewayAuthenticationFilter.java
│       └── routing/GatewayRouteCatalog.java
├── services/                            # Domain services (Maven reactor)
│   ├── pom.xml
│   ├── master-node/                     # Control plane (port 8082)
│   ├── auth-service/                    # Authentication (port 8081)
│   │   └── spring/                      # Spring implementation
│   ├── org-service/                     # Organization/outlet (port 8083)
│   ├── hr-service/                      # HR management (port 8084)
│   ├── product-service/                 # Product catalog (port 8085)
│   ├── procurement-service/             # Procurement (port 8086)
│   ├── sales-service/                   # POS/sales (port 8087)
│   ├── inventory-service/               # Inventory (port 8088)
│   ├── payroll-service/                 # Payroll (port 8089)
│   ├── finance-service/                 # Finance (port 8090)
│   ├── audit-service/                   # Audit logging (port 8091)
│   └── report-service/                  # Reporting (port 8092)
├── db/                                  # Database artifacts
│   ├── migrations/                      # Flyway migrations (V1-V6__)
│   ├── seeds/                           # Seed data
│   ├── tests/                           # Test fixtures
│   └── docs/                            # ERD notes
└── infra/                               # Infrastructure tooling
    ├── docker-compose.yml               # PostgreSQL, Redis, Kafka, Flyway
    ├── scripts/                         # start.sh, stop.sh, migrate.sh
    ├── config/                          # Docker configs
    └── .env.example                     # Environment template
```

### Maven reactor organization
- **Root pom.xml**: Parent POM with dependency management, plugin management, module declarations
- **common/pom.xml**: Shared library parent, declares common-utils, common-model, idempotency-core, service-common, event-schemas
- **services/pom.xml**: Services parent, declares all domain services
- **Dependency order**: `common-utils` → `common-model` → `idempotency-core` → `service-common` → `event-schemas` → services

---

## 3. Shared Module Breakdown

### common-utils
**Purpose**: Foundational utilities with no internal dependencies

**Main classes/components**:
- `SnowflakeIdGenerator` (`common-common-utils/src/main/java/com/natsu/common/utils/services/id/SnowflakeIdGenerator.java`): 64-bit ID generation using 2000-01-01 epoch, 10-bit worker ID, 12-bit sequence
- `Configuration` / `ConfigurationLoader`: Environment-driven config parsing
- `ServicesRegistry`: Service/Machine ID registration
- Crypto utilities: Token generation, hashing

**Who depends on it**: All other common modules, all services

**Runtime usage**: ID generation for all primary keys, configuration loading at startup

### common-model
**Purpose**: Infrastructure abstractions for cache, database, messaging

**Main classes/components**:
- `TieredCache` (`common-model/src/main/java/com/natsu/common/model/cache/TieredCache.java`): Redis L1 + in-memory L2 cache with TTL
- `DatabaseFactory`: HikariCP DataSource creation
- `MessageQueueFactory`: Kafka producer/consumer factory
- `CacheManager`: Redis cache management

**Who depends on it**: idempotency-core, service-common, all services

**Runtime usage**: Caching hot data (product prices, org hierarchy), database connection pooling, Kafka event publishing

### idempotency-core
**Purpose**: Two-tier idempotency enforcement

**Main classes/components**:
- `IdempotencyGuard` (`idempotency-core/src/main/java/com/dorabets/idempotency/IdempotencyGuard.java`): L1 Redis + L2 PostgreSQL duplicate detection
- `IdempotencyResult`: Encapsulates response code, body, resource ID
- `TtlPolicy`: Configurable TTL for idempotency keys

**Who depends on it**: service-common, write operations in services

**Runtime usage**: Wraps POST/PUT/DELETE operations to prevent duplicate submissions (e.g., double-sale prevention)

### service-common
**Purpose**: Reusable service runtime helpers

**Main classes/components**:
- `BaseRepository` (`service-common/src/main/java/com/dorabets/common/repository/BaseRepository.java`): Spring JDBC CRUD operations
- `RequestUserContext` (`service-common/src/main/java/com/dorabets/common/spring/auth/RequestUserContext.java`): Thread-local user context from JWT
- `PermissionMatrixService` (`service-common/src/main/java/com/dorabets/common/spring/auth/PermissionMatrixService.java`): Outlet-scoped permission evaluation
- `SpringInternalServiceAuth` (`service-common/src/main/java/com/dorabets/common/spring/auth/SpringInternalServiceAuth.java`): Service-to-service auth
- `MasterNodeHeartbeatAgent` (`service-common/src/main/java/com/dorabets/common/spring/control/MasterNodeHeartbeatAgent.java`): 10-second heartbeat to master-node
- `TypedKafkaEventPublisher` (`service-common/src/main/java/com/dorabets/common/spring/events/TypedKafkaEventPublisher.java`): Type-safe Kafka event publishing

**Who depends on it**: All Spring-based services

**Runtime usage**: Every service extends BaseRepository, RequestUserContext populated by auth filter, heartbeat agent runs on startup, events published via TypedKafkaEventPublisher

### event-schemas
**Purpose**: Domain event definitions

**Main classes/components**:
- `EventEnvelope<T>` (`event-schemas/src/main/java/com/fern/events/core/EventEnvelope.java`): Wraps events with metadata (eventId, timestamp, source, version)
- `AuthEvents`: UserLoginEvent, UserLogoutEvent, UserCreatedEvent, RoleUpdatedEvent
- `OrgEvents`: OutletUpdatedEvent, ExchangeRateUpdatedEvent, RegionCreatedEvent
- `ProductEvents`: ProductPriceChangedEvent, ProductRecipeUpdatedEvent, ProductCreatedEvent
- `SalesEvents`: SaleCompletedEvent, PosSessionOpenedEvent, PosSessionClosedEvent
- `InventoryEvents`: StockUpdatedEvent, WasteRecordedEvent, InventoryAdjustedEvent
- `ProcurementEvents`: GoodsReceiptPostedEvent, InvoiceApprovedEvent, PurchaseOrderApprovedEvent
- `HREvents`: ShiftAssignedEvent, EmployeeContractUpdatedEvent
- `PayrollEvents`: PayrollApprovedEvent, TimesheetSubmittedEvent
- `AuditEvents`: AuditEvent

**Who depends on it**: All services producing/consuming events

**Runtime usage**: All Kafka messages wrapped in EventEnvelope, serialized as JSON

---

## 4. Service Catalog

| Service | Module | Port | Framework | Main Classes | Status |
|---------|--------|------|-----------|--------------|--------|
| Gateway | `gateway/` | 8080 | Spring Cloud Gateway | GatewayApplication, GatewayAuthenticationFilter, GatewayRouteCatalog | Implemented |
| Master Node | `services/master-node/` | 8082 | Spring Boot | MasterNodeApplication, ControlPlaneRegistryService | Implemented |
| Auth Service | `services/auth-service/spring/` | 8081 | Spring Boot | AuthServiceApplication, AuthService, AuthController | Implemented |
| Org Service | `services/org-service/` | 8083 | Spring Boot | OrgServiceApplication, OrgService | Implemented |
| HR Service | `services/hr-service/` | 8084 | Spring Boot | HrServiceApplication, HRService | Compiled |
| Product Service | `services/product-service/` | 8085 | Spring Boot | ProductServiceApplication, ProductService | Implemented |
| Procurement Service | `services/procurement-service/` | 8086 | Spring Boot | ProcurementServiceApplication | Compiled |
| Sales Service | `services/sales-service/` | 8087 | Spring Boot | SalesServiceApplication, SalesService | Implemented |
| Inventory Service | `services/inventory-service/` | 8088 | Spring Boot | InventoryServiceApplication, InventoryService | Implemented |
| Payroll Service | `services/payroll-service/` | 8089 | Spring Boot | PayrollServiceApplication | Compiled |
| Finance Service | `services/finance-service/` | 8090 | Spring Boot | FinanceServiceApplication | Compiled |
| Audit Service | `services/audit-service/` | 8091 | Spring Boot | AuditServiceApplication | Compiled |
| Report Service | `services/report-service/` | 8092 | Spring Boot | ReportServiceApplication | Compiled |

---

## 5. Request Flow

### External Request → Gateway
1. Client sends HTTP request to `gateway:8080` (e.g., `POST /api/v1/sales/submit`)
2. `GatewayAuthenticationFilter` intercepts request:
   - Extracts `Authorization: Bearer <jwt>` header
   - Validates JWT signature using public key
   - On success: extracts `userId`, `outletId`, `permissions` and forwards to downstream service
   - On failure: returns 401

### Gateway → Downstream Service Routing
3. `GatewayRouteCatalog` resolves route:
   - Calls `master-node:8082` to get active instances for target service
   - Selects instance using weighted round-robin
   - Forwards request with headers: `X-User-Id`, `X-Outlet-Id`, `X-Permissions`, `X-Correlation-Id`

### Downstream Service Processing
4. Service receives request via Spring MVC/RestController
5. `RequestUserContext` populates thread-local from headers
6. `PermissionMatrixService` validates outlet-scoped permissions

### Service → PostgreSQL / Redis / Kafka
7. Data access via `BaseRepository` (Spring JDBC)
8. Caching via `TieredCache`
9. Event publishing via `TypedKafkaEventPublisher`

---

## 6. Event Flow

### Event Topics and Payloads
- `auth.user.login` - UserLoginEvent
- `auth.user.logout` - UserLogoutEvent
- `auth.user.created` - UserCreatedEvent
- `auth.role.updated` - RoleUpdatedEvent
- `org.outlet.updated` - OutletUpdatedEvent
- `org.exchange_rate.updated` - ExchangeRateUpdatedEvent
- `product.price.changed` - ProductPriceChangedEvent
- `product.recipe.updated` - ProductRecipeUpdatedEvent
- `sales.sale.completed` - SaleCompletedEvent
- `sales.pos_session.opened` - PosSessionOpenedEvent
- `inventory.stock.updated` - StockUpdatedEvent
- `inventory.waste.recorded` - WasteRecordedEvent
- `procurement.gr.posted` - GoodsReceiptPostedEvent
- `procurement.invoice.approved` - InvoiceApprovedEvent
- `hr.shift.assigned` - ShiftAssignedEvent
- `payroll.approved` - PayrollApprovedEvent

### Current Event-Driven Flows
**Working**:
- EventEnvelope structure defined
- TypedKafkaEventPublisher can publish events

**Planned/Not Fully Implemented**:
- Sale → Inventory deduction (consume `sales.sale.completed`)
- Goods receipt → Inventory update
- Procurement → Finance expense generation
- Sales/Payroll → Audit logging

---

## 7. Database Architecture

### PostgreSQL Schema Summary (core schema)

**Auth Domain** (authoritative writer: `auth-service`):
- `user_account` - User credentials, profile
- `user_role` - User-to-role assignments
- `role_permission` - Role-to-permission mappings
- `permission_code` - Permission definitions
- `outlet_permission` - Outlet-scoped permissions

**Organization Domain** (authoritative writer: `org-service`):
- `currency` - Currency codes, rates
- `region` - Geographic regions
- `exchange_rate` - Currency exchange rates
- `outlet` - Store/outlet master data
- `outlet_hierarchy` - Outlet parent-child relationships

**Product Domain** (authoritative writer: `product-service`):
- `product_category`, `item_category` - Categories
- `unit_of_measure` - UOM definitions
- `item`, `product` - Product master data
- `tax_rate` - Tax configurations
- `product_price` - Price per outlet
- `product_outlet_availability` - Outlet product mapping
- `recipe`, `recipe_item` - Product recipes

**Sales Domain** (authoritative writer: `sales-service`):
- `pos_session` - POS session tracking
- `sale_record` - Sale headers
- `sale_item` - Sale line items
- `payment` - Payment records
- `promotion` - Promotion definitions

**Inventory Domain** (authoritative writer: `inventory-service`):
- `inventory_transaction` - All stock movements (insert-only)
- `stock_balance` - Trigger-maintained, read-only summary
- `waste_record` - Stock waste tracking
- `goods_receipt_transaction` - GR stock movements
- `sale_item_transaction` - Sale-to-inventory linkage
- `inventory_adjustment` - Manual adjustments

**Procurement Domain** (authoritative writer: `procurement-service`):
- `supplier_procurement` - Procurement headers
- `purchase_order`, `purchase_order_item` - Purchase orders
- `goods_receipt`, `goods_receipt_item` - Goods receipts
- `supplier_invoice` - Supplier invoices
- `supplier_payment` - Payment tracking

**HR/Payroll Domain** (authoritative writer: `hr-service`/`payroll-service`):
- `shift`, `work_shift` - Shift definitions
- `employee_contract` - Employment contracts
- `payroll_period` - Payroll periods
- `payroll_timesheet` - Timesheet entries
- `payroll` - Payroll calculations

**Finance Domain** (authoritative writer: `finance-service`):
- `expense_record` - Expense headers
- `expense_inventory_purchase` - Inventory-related expenses
- `expense_operating` - Operating expenses
- `expense_payroll` - Payroll expenses

**Audit/Control Domain**:
- `audit_log` - Audit trail
- `service_registry` - Service instance registration
- `service_config` - Service configuration
- `service_release` - Release tracking
- `service_rollout` - Rollout stages
- `idempotency_keys` - Idempotency tracking

### Important Constraints and Operational Rules
1. **Snowflake IDs**: All primary keys use `BIGINT` with application-generated Snowflake IDs (NO auto-increment)
2. **stock_balance**: Read-only, maintained by triggers on `inventory_transaction` inserts
3. **Currency**: All monetary tables include `currency_code` field for snapshot
4. **Outlet scoping**: Most business tables include `outlet_id` for multi-tenancy
5. **Idempotency table**: `idempotency_keys` tracks all write operations for replay safety

---

## 8. IAM and Security Flow

### Authentication
1. **Login flow** (`auth-service`):
   - `POST /api/v1/auth/login` with credentials
   - `AuthService.authenticate()` validates against `user_account`
   - Generates JWT with claims: `userId`, `outletId`, `permissions`, `exp`
   - Returns JWT + user profile

2. **JWT handling**:
   - JWT signed with private key, verified with public key
   - Expiration typically 1-24 hours

### Internal Service Auth
3. **Service-to-service**:
   - `SpringInternalServiceAuth` handles service account JWT
   - Gateway forwards user context via headers

### Outlet-Scoped Permission Evaluation
4. **Permission check**:
   ```java
   permissionMatrixService.hasPermission(userId, "sale_submit", outletId)
   ```

5. **Permission data model**:
   - `permission_code` defines all permissions
   - `role_permission` maps roles to permissions
   - `outlet_permission` maps users/roles to outlets

---

## 9. Infrastructure and Local Development Flow

### Docker Compose (`infra/docker-compose.yml`)
**Services**:
- `postgres` (5432): PostgreSQL 16 with `core` schema
- `redis` (6379): Redis 7 for cache/idempotency
- `kafka` (9092): Kafka 3.9 with KRaft mode
- `flyway` (one-off): Runs migrations on startup

### Starting Locally
```bash
# Set environment
cp infra/.env.example infra/.env

# Start infrastructure
./infra/scripts/start.sh

# Run migrations
./db/scripts/migrate.sh

# Start services
./infra/scripts/start-services.sh
```

---

## 10. Current Implementation Status

| Component | Status | Evidence | Main Gap |
|-----------|--------|----------|----------|
| Maven reactor | **Implemented** | All modules compile | None |
| common-utils | **Implemented** | SnowflakeIdGenerator, Configuration | None |
| common-model | **Implemented** | TieredCache, DatabaseFactory | None |
| idempotency-core | **Implemented** | IdempotencyGuard | None |
| service-common | **Implemented** | BaseRepository, RequestUserContext | None |
| event-schemas | **Implemented** | All event types defined | None |
| Gateway | **Implemented** | GatewayAuthenticationFilter, GatewayRouteCatalog | Route refresh logic |
| Master-node | **Implemented** | ControlPlaneRegistryService | Release/rollout logic |
| Auth-service | **Implemented** | AuthService, AuthController | None |
| Org-service | **Implemented** | OrgService | None |
| Product-service | **Implemented** | ProductService | None |
| Sales-service | **Implemented** | SalesService | None |
| Inventory-service | **Implemented** | InventoryService | None |
| HR-service | **Compiled** | HRServiceApplication | Full business logic |
| Procurement-service | **Compiled** | ProcurementServiceApplication | Full business logic |
| Payroll-service | **Compiled** | PayrollServiceApplication | Full business logic |
| Finance-service | **Compiled** | FinanceServiceApplication | Full business logic |
| Audit-service | **Compiled** | AuditServiceApplication | Full business logic |
| Report-service | **Compiled** | ReportServiceApplication | Query logic |
| Database migrations | **Partial** | V1-V6__.sql present | Some DDL incomplete |
| Kafka infrastructure | **Implemented** | docker-compose.yml | Consumer configuration |

---

## 11. Critical Flows

### Login Flow
1. Client → `POST /api/v1/auth/login`
2. `AuthService.authenticate()` validates credentials
3. Generate JWT with claims
4. Return JWT + user profile
5. Publish `auth.user.login` event

### Sale Submission (Core Business Flow)
1. `POST /api/v1/sales/submit` with sale items
2. `SalesService.submitSale()`:
   - Validate outlet context
   - Check product availability
   - Check inventory
   - Create sale records
   - Use `IdempotencyGuard`
   - Publish `sales.sale.completed` event
3. Event triggers inventory deduction (consumer needed)

### Service Heartbeat
1. `MasterNodeHeartbeatAgent` starts on service startup
2. Registers via `POST /api/v1/control/services/register`
3. Heartbeats every 10 seconds
4. Redis TTL set to 30 seconds

---

## 12. Risks, Gaps, and Inconsistencies

### Incomplete Implementations
1. **HR/Procurement/Payroll/Finance/Audit/Report services**: Application classes compile but business logic needs completion
2. **Event consumers**: TypedKafkaEventPublisher exists but many consumers not implemented
3. **Trigger verification**: `stock_balance` trigger DDL needs verification

### Dangerous Assumptions
1. **Single PostgreSQL**: All services share one database - violates microservices isolation
2. **Snowflake ID clock skew**: If system clock moves backward, generator throws exception
3. **Redis down fallback**: Idempotency falls back to L2 only

### Missing Tests
1. **Unit tests**: Limited test coverage
2. **Integration tests**: No end-to-end test suite
3. **Event tests**: No tests for event publishing/consuming flows

---

## 13. Recommended Next Steps

### Priority 1: Event-Driven Flow Completion
1. **Implement Inventory Service event consumer** for `sales.sale.completed`
   - File: `services/inventory-service/src/main/java/.../InventoryEventConsumer.java`
   - Deduct stock based on sale items

2. **Implement Finance Service event consumers**
   - Consume `procurement.invoice.approved` → create expense records
   - Consume `payroll.approved` → create payroll expenses

3. **Implement Audit Service event consumer**
   - Consume all business events → create audit_log entries

### Priority 2: Service Business Logic Completion
4. **Complete Procurement Service** - PO lifecycle, GR posting
5. **Complete HR Service** - Shift scheduling, contract management
6. **Complete Payroll Service** - Timesheet aggregation, payroll calculation

### Priority 3: Infrastructure Hardening
7. **Add/verify database triggers** for stock_balance maintenance
8. **Add integration tests** for critical flows
9. **Complete Master-Node rollout logic** for feature flags

### Priority 4: Reporting
10. **Implement Report Service** - Query logic using reporting indexes

---

## Summary

The FERN ERP backend is a **well-architected, partially implemented microservices system** with:

**What works today:**
- All shared library infrastructure (common modules)
- Master-node control plane
- Gateway with auth
- Auth, Org, Product, Sales, Inventory services
- All 24 Maven modules compile successfully
- Database schema (V1-V6)
- Docker Compose infrastructure

**What needs implementation:**
- Full business logic in HR, Procurement, Payroll, Finance, Audit, Report services
- Event consumers and event-driven flows
- Database triggers for stock_balance
- Integration tests

**Next immediate action:** Complete the sale → inventory deduction flow by implementing the Inventory Service event consumer for `sales.sale.completed` events.
