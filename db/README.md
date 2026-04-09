# FERN PostgreSQL Database Guide

This directory contains the approved PostgreSQL design for the FERN backend. The schema is production-oriented, region-aware, migration-driven, and documented so future work can stay consistent.

## Purpose

The database supports a single master PostgreSQL deployment with:

- one logical application schema: `core`
- one hierarchical `region` model for countries, regions, and sub-regions
- outlet-scoped operations for IAM, HR, procurement, sales, and inventory
- snapshot currency storage on monetary tables
- application-generated Snowflake `bigint` keys
- PostgreSQL-enforced relational integrity where that is appropriate

This structure is intended for a shared master database today, with service-level regional allocation handled by backend configuration and deployment policy.

## Directory Layout

- `migrations/`
  - Flyway SQL migrations
- `seeds/`
  - optional reference and sample seed data
- `scripts/`
  - helper commands to migrate, reset, seed, and run SQL tests
- `tests/`
  - plain SQL validation suite
- `docs/`
  - review notes, table dictionary, and testing guidance
- `flyway.conf`
  - Flyway defaults used by the Docker tooling

## Core Design Rules

### 1. Database topology

- One PostgreSQL database
- One application schema: `core`
- Region hierarchy is data-driven through `core.region`

### 2. Primary key strategy

- Surrogate entity keys use `bigint`
- IDs are assigned by application code, not by PostgreSQL
- PostgreSQL `IDENTITY` and sequences are intentionally not used for entity PKs because the repository already provides Snowflake ID generation in:
  - [SnowflakeIdGenerator.java](/Users/nguyendinhkhiem/Development/Javas/FERN/common/common-utils/src/main/java/com/natsu/common/utils/services/id/SnowflakeIdGenerator.java)

### 3. Natural keys kept where they are semantically stable

- `currency.code`
- `role.code`
- `permission.code`
- category codes
- UOM codes

These are treated as stable business identifiers and are not reused after soft delete.

### 4. Soft delete policy

Soft delete is used only on mutable master data where recovery and historical lookup matter:

- `outlet`
- `app_user`
- `employee_contract`
- `item`
- `product`
- `supplier_procurement`
- `role`
- `permission`

Soft delete is not used on transactional fact tables such as:

- `sale_record`
- `payment`
- `inventory_transaction`
- `goods_receipt`
- `supplier_invoice`
- `supplier_payment`
- `payroll`
- `audit_log`

Those rows should stay immutable and use lifecycle status values instead.

### 5. Timestamp policy

- `created_at` defaults to `now()`
- `updated_at` defaults to `now()`
- `updated_at` triggers use `clock_timestamp()` so that multiple row updates within one transaction get distinct wall-clock timestamps
- business dates remain `date`
- event timestamps remain `timestamptz`

### 6. Currency policy

Any table that stores money carries a snapshot `currency_code`. This avoids historical ambiguity if a region changes default currency in the future.

### 7. JSONB policy

`jsonb` is intentionally limited to audit payloads and future external metadata-style extensions. Arrays are intentionally not used in this schema.

## Table Groups

### Reference and organization

- `currency`
- `region`
- `exchange_rate`
- `outlet`

### IAM

- `role`
- `permission`
- `role_permission`
- `app_user`
- `user_role`
- `user_permission`

IAM assignments are outlet-scoped. Global access is modeled by creating rows for each outlet a user can operate in.

### HR and attendance

- `shift`
- `work_shift`
- `employee_contract`

Cross-midnight shifts are intentionally rejected. Contract precedence is application-side by design.

### Intentional Design Tradeoffs

The following decisions were explicitly approved during schema review:

1. **Overlapping employee contracts are allowed.** Multiple active contracts for the same user can coexist. The application determines precedence by date range and employment type. No exclusion constraint is applied.

2. **Payment is 1:1 with sale_record.** The `payment` table uses `sale_id` as its primary key. Split payments across multiple rows are not supported at the database level. If split payment support is needed in the future, this requires a migration to a composite key.

3. **Sale item is aggregated by product.** The `sale_item` primary key is `(sale_id, product_id)`. The same product cannot appear on two separate lines within one sale. Different sizes or modifiers should be modeled as distinct products.

4. **Negative stock is allowed.** `stock_balance.qty_on_hand` has no `>= 0` constraint. Negative values can occur from late-posting or reconciliation flows. Stricter control should use a reservation/availability design rather than a blanket check.

5. **Cross-midnight shifts are rejected.** The `chk_shift_end_after_start` constraint requires `end_time > start_time`. Overnight shifts are not supported by design.

6. **Inventory transaction signs are enforced.** The `chk_inventory_txn_sign` constraint requires positive `qty_change` for inbound types (`purchase_in`, `stock_adjustment_in`, `manufacture_in`) and negative for outbound types (`sale_usage`, `waste_out`, `stock_adjustment_out`, `manufacture_out`).

### Product, recipe, and pricing

- `product_category`
- `item_category`
- `unit_of_measure`
- `uom_conversion`
- `item`
- `product`
- `tax_rate`
- `recipe`
- `recipe_item`
- `product_outlet_availability`
- `product_price`

### Procurement

- `supplier_procurement`
- `purchase_order`
- `purchase_order_item`
- `goods_receipt`
- `goods_receipt_item`
- `supplier_invoice`
- `supplier_invoice_receipt`
- `supplier_invoice_item`
- `supplier_payment`
- `supplier_payment_allocation`

Invoices must be linked to at least one goods receipt. Payment allocations are constrained to prevent supplier/currency mismatches and over-allocation.

### Sales and POS

- `pos_session`
- `sale_record`
- `payment`
- `sale_item`
- `promotion`
- `promotion_scope`
- `sale_item_promotion`

`payment` is intentionally modeled as one row per sale because you explicitly approved single-payment-record behavior.

### Inventory

- `stock_balance`
- `inventory_transaction`
- `waste_record`
- `goods_receipt_transaction`
- `sale_item_transaction`
- `manufacturing_batch`
- `manufacturing_transaction`
- `inventory_adjustment`
- `stock_count_session`
- `stock_count_line`

`stock_balance` is a cache table maintained by trigger from `inventory_transaction`.

### Payroll, expense, and audit

- `payroll_period`
- `payroll_timesheet`
- `payroll`
- `expense_record`
- `expense_inventory_purchase`
- `expense_operating`
- `expense_other`
- `expense_payroll`
- `audit_log`

## PostgreSQL Decisions And Rationale

### `bigint` with Snowflake instead of `IDENTITY`

This is the correct choice for this repository because:

- IDs are generated by services, not a single database node
- inserts stay region-independent
- services can create records before a DB round-trip if needed
- future microservices can share one ID strategy

Tradeoff:

- the application must never forget to provide IDs

### `timestamptz`

Used for operational time values such as:

- `created_at`
- `updated_at`
- `payment_time`
- `receipt_time`
- `opened_at`
- `closed_at`

This avoids silent timezone drift between services and operators.

### `numeric`

Chosen instead of floating-point types for:

- money amounts
- tax percentages
- conversion factors
- inventory quantities

Policy:

- money totals: `numeric(18,2)`
- unit costs and quantity-related rates: `numeric(18,4)`
- conversion rates: `numeric(20,8)`

### `text` vs constrained `varchar`

`varchar(n)` is used when the business has a real maximum:

- codes
- email
- phone
- invoice numbers

`text` is used for:

- notes
- addresses
- descriptions
- URLs
- user agent strings

### `jsonb`

Used on `audit_log.old_data` and `audit_log.new_data` only. No broad JSON modeling is used for core business entities.

### ENUMs

PostgreSQL ENUMs are used because you explicitly requested them. They are appropriate here because these value sets are stable backend constants, not user-managed lookup data.

Tradeoff:

- changing ENUMs later requires a migration, not just a row insert

## Index Strategy

### B-tree indexes

Used for:

- all PKs and unique constraints
- most FK lookup paths
- status filters
- outlet/date and user/date access paths
- `(entity_name, entity_id)` lookup on `audit_log`

### BRIN indexes

Used for append-heavy time-series tables:

- `sale_record.created_at`
- `inventory_transaction.txn_time`
- `audit_log.created_at`

This keeps index size small while still helping time-range scans.

### GIN and GiST

Not used by default in V1:

- `GIN` is deferred until audit JSON or text search proves necessary
- `GiST` is not needed because overlap constraints were intentionally kept application-side

## Migration Flow

### Migrations

- [V1__core_schema.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/migrations/V1__core_schema.sql)
- [V2__reporting_indexes.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/migrations/V2__reporting_indexes.sql)

V1 creates:

- schema `core`
- ENUMs
- tables
- FK/PK/unique/check constraints
- triggers for `updated_at`
- trigger-based stock balance maintenance
- deferred validation triggers for invoices and supplier payment allocations

V2 adds reporting-optimized indexes for outlet-scoped analytic queries.

### Optional seeds

- [000_baseline_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/000_baseline_seed.sql)
- [001_reference_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/001_reference_seed.sql)
- [002_sample_operational_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/002_sample_operational_seed.sql)
- [003_demo_seed.sql](/Users/nguyendinhkhiem/Development/Javas/FERN/db/seeds/003_demo_seed.sql)

These are not applied automatically during migration. They are intended for local development and demo/testing convenience.
`seed.sh` applies only the minimal baseline seed; sample outlets, accounts, and operational/demo records stay in the higher-numbered seed packs for manual use.

## Local PostgreSQL Setup

### 1. Start PostgreSQL and Redis

```sh
cp infra/.env.example infra/.env
./infra/setup.sh
```

### 2. Apply schema

```sh
./db/scripts/migrate.sh
```

### 3. Load optional seeds

```sh
./db/scripts/seed.sh
```

### 4. Reset schema and re-run migration

```sh
./db/scripts/reset.sh
```

### 5. Run SQL tests

```sh
./db/scripts/run_sql_tests.sh
```

### 6. Reset and reseed baseline data

```sh
./db/scripts/reset_and_seed.sh
```

## SQL Usage Guidance

### Inserts

- always generate entity IDs in the application layer
- always populate snapshot `currency_code` on monetary records
- prefer inserting headers and lines inside one transaction
- let PostgreSQL fill `created_at` and `updated_at`

Example:

```sql
INSERT INTO core.sale_record (
  id,
  outlet_id,
  pos_session_id,
  currency_code,
  order_type,
  status,
  payment_status,
  subtotal,
  discount,
  tax_amount,
  total_amount
) VALUES (
  1234567890123,
  2000,
  3000,
  'VND',
  'dine_in',
  'completed',
  'paid',
  65000.00,
  5000.00,
  6000.00,
  66000.00
);
```

### Updates

- update mutable headers and master data normally
- `updated_at` is trigger-managed
- do not mutate immutable transactional history unless the lifecycle explicitly allows it

### Deletes

- use soft delete for master data
- use status transitions for transactional facts
- avoid physical delete outside controlled maintenance or privacy workflows

### Joins

Common reporting joins:

- outlet -> region
- purchase_order -> purchase_order_item
- goods_receipt -> goods_receipt_item
- supplier_invoice -> supplier_invoice_receipt -> goods_receipt
- sale_record -> sale_item -> product
- inventory_transaction -> subtype tables

### Transactions

Wrap business operations in one transaction when they affect:

- a header plus line items
- inventory plus stock balance side effects
- supplier payment plus allocations
- invoice plus receipt linkage

### Locking

Recommended patterns:

- lock the header row before updating derived totals
- lock the payment row before modifying allocations
- lock the relevant `stock_balance` row if you add service-side stock reservation logic later

### Upserts

Use upsert only where the record is conceptually cache-like or idempotent:

- `stock_balance` is maintained by trigger
- reference seeds can safely use `ON CONFLICT DO NOTHING`

Avoid upserting business facts like invoices, receipts, or payments unless the upstream integration contract is explicitly idempotent.

## Sample Query Examples

### Get outlet products with current price

```sql
SELECT
  p.code,
  p.name,
  pp.currency_code,
  pp.price_value
FROM core.product p
JOIN core.product_outlet_availability poa
  ON poa.product_id = p.id
JOIN core.product_price pp
  ON pp.product_id = p.id
 AND pp.outlet_id = poa.outlet_id
WHERE poa.outlet_id = 2000
  AND poa.is_available = TRUE
  AND pp.effective_to IS NULL;
```

### Get receipts attached to an invoice

```sql
SELECT
  si.invoice_number,
  gr.id AS receipt_id,
  gr.business_date,
  gr.total_price
FROM core.supplier_invoice si
JOIN core.supplier_invoice_receipt sir
  ON sir.invoice_id = si.id
JOIN core.goods_receipt gr
  ON gr.id = sir.receipt_id
WHERE si.id = 8200;
```

### Get ingredient-level inventory usage for one sale

```sql
SELECT
  sit.sale_id,
  it.item_id,
  i.code AS item_code,
  it.qty_change,
  it.txn_time
FROM core.sale_item_transaction sit
JOIN core.inventory_transaction it
  ON it.id = sit.inventory_transaction_id
JOIN core.item i
  ON i.id = it.item_id
WHERE sit.sale_id = 950400;
```

## Codex Continuation Prompts

Use prompts like these to continue safely:

### Add a new module

```text
Review the current PostgreSQL schema in db/migrations and db/docs, preserve the existing naming and snapshot currency rules, and propose a new schema extension for [module name]. Do not modify existing tables without first listing the exact proposed changes, constraints, indexes, and migration impact.
```

### Add a new table

```text
Design a new PostgreSQL table in the core schema that follows the existing FERN rules: bigint Snowflake IDs, timestamptz audit timestamps, ENUM status types, no arrays, jsonb only when justified, and no identity columns. Show the exact migration SQL, documentation updates, and SQL tests before applying anything.
```

### Change a constraint

```text
Audit the existing constraint set for [table name], explain current invariants, propose the exact constraint changes and migration risks, and only then update the Flyway migration set, db docs, and SQL tests consistently.
```

## More Detailed Documentation

- [Database Docs Index](/Users/nguyendinhkhiem/Development/Javas/FERN/db/docs/README.md)
- [Schema Review](/Users/nguyendinhkhiem/Development/Javas/FERN/db/docs/schema-review.md)
- [Data Dictionary](/Users/nguyendinhkhiem/Development/Javas/FERN/db/docs/data-dictionary.md)
- [Testing Guide](/Users/nguyendinhkhiem/Development/Javas/FERN/db/docs/testing-guide.md)
