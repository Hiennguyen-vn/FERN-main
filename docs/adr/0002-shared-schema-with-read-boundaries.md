# ADR-0002: Shared schema with read boundaries

## Status
Accepted (2026-05-01)

## Context
FERN runs as modular monolith with 13 services sharing one PostgreSQL `core` schema. Original "single writer per domain" doctrine violated in practice:
- `payroll-service` reads `core.user_role`, `core.user_permission`, `core.region`, `core.outlet` (IAM/org)
- `finance-service` joins `core.goods_receipt`, `core.payroll`, `core.supplier_invoice_item` (procurement/payroll)
- `inventory-service` previously read `core.sale_record` (sales) — **removed in V76 refactor**

## Decision
Codify pragmatic boundaries:

1. **Writes**: strict single-writer per aggregate. No service writes another domain's tables.
2. **Cross-domain reads**: allowed for **reporting and policy resolution** when:
   - Read is idempotent and tolerates eventual consistency
   - Schema field is stable (covered by event-schemas contract or migration policy)
   - Service doesn't replicate write-path logic
3. **Cross-domain writes via outbox only** (Phase 1 done): every state mutation appends to `core.outbox_event` in same transaction.
4. **Disallowed**: reading another domain's table inside event consumer write-path (eliminated `inventory.findSaleCreatedAt` — sales now publishes `saleCreatedAt` in `SaleApprovedEvent`).

## Consequences
- Schema migrations require cross-team review when touching tables read by ≥2 services.
- Future split into separate DBs requires either:
  - Replace cross-domain reads with RPC + cache (high churn)
  - Replicate read-only views via CDC (Debezium/ClickHouse already in stack)
- Documentation updated: see `docs/erp-microservices-architecture.md` for cross-read map.

## Cross-domain read inventory (as of V76)
| Reader | Tables read | Justification |
|---|---|---|
| payroll-service | core.user_role, core.user_permission | Authorization scope check; read-only |
| payroll-service | core.region, core.outlet | Outlet-region policy; read-only |
| finance-service | core.goods_receipt, core.supplier_invoice_item | Reporting joins for AP/expense views |
| finance-service | core.payroll, core.payroll_timesheet, core.payroll_period | Payroll-expense reporting |
| audit-service | (all event tables) | By design — audit log aggregation |

## Alternatives considered
- **Separate schema per service**: blocked by report-service requirements (joins cross-domain).
- **RPC for every cross-read**: 2× latency for reporting, no benefit at current scale.
- **CQRS with materialized views**: future work; tracked in roadmap.
