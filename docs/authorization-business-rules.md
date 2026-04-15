# FERN Authorization Business Rules

> Last updated: 2026-04-15
>
> This document describes the canonical role taxonomy, scope model, and domain-level authorization rules enforced by the `AuthorizationPolicyService` layer.

---

## 1. Scope Model

Authorization scope is determined by where a user's role assignments fan out in the org hierarchy.
The DB schema stores all assignments at the **outlet** level (`user_role` table with `outlet_id`).
The policy layer collapses outlet-level assignments back into logical scopes at read time.

| Scope | Description | DB Representation |
|-------|-------------|-------------------|
| **Global** | Full system access, no filtering | `superadmin` assigned to all active outlets |
| **Region** | All outlets within a region | Role assigned to every outlet in a region; policy collapses to single region scope |
| **Outlet** | Single outlet | Role assigned to one outlet |

Region-scoped role assignment is performed via **fan-out**: when assigning a region-scoped role, `auth-service` writes one `user_role` row per outlet in that region.
When reading back, `AuthorizationPolicyService.resolveUserProfile()` collapses matching outlet sets back into `ScopeType.REGION` assignments.

---

## 2. Canonical Roles

Ten business roles form the canonical taxonomy. All legacy role codes are mapped to one of these via `RoleAliasResolver`.

| Role | Code | Default Scope | Purpose |
|------|------|---------------|---------|
| **Superadmin** | `superadmin` | Global | Full system access. Emergency override. |
| **Admin** | `admin` | Outlet / Region | IAM governance within scope. No business operations. |
| **Region Manager** | `region_manager` | Region | Operational oversight and read access across a region. |
| **Outlet Manager** | `outlet_manager` | Outlet | Store-level business owner. Final approver for procurement, inventory exceptions, internal expenses, POS. |
| **Staff** | `staff` | Outlet | POS/cashier operator. Sales order flow only. |
| **Product Manager** | `product_manager` | Region | Catalog/menu/pricing management within a region. |
| **Procurement** | `procurement` | Outlet | Purchase order creation and processing within an outlet. No final approval. |
| **Finance** | `finance` | Region | Financial operations, expense management, payroll approval within a region. |
| **Kitchen Staff** | `kitchen_staff` | Outlet | Kitchen fulfillment. No business operations beyond outlet membership. |
| **HR** | `hr` | Region | Employee contracts, scheduling, payroll preparation within a region. No payroll approval. |

---

## 3. Legacy Role Mapping

These stored role codes are mapped to canonical roles transparently. They continue to work for existing accounts but are not assignable in the new IAM UI.

| Legacy Code | Canonical Role |
|---|---|
| `cashier`, `staff_pos` | Staff |
| `procurement_officer` | Procurement |
| `hr_manager` | HR |
| `finance_manager`, `finance_approver`, `regional_finance`, `accountant` | Finance |
| `regional_manager` | Region Manager |
| `system_admin`, `technical_admin` | Admin |

Codes outside this mapping (e.g. `inventory_clerk`) are hidden from the business catalog but still function via compatibility mapping for existing accounts.

---

## 4. Domain Access Matrix

The table below shows which capabilities each role has across all service domains.
**W** = Write/Mutate, **R** = Read, **A** = Approve, **-** = Denied, **(scope)** = limited to own scope.

| Domain | superadmin | admin | region_manager | outlet_manager | staff | product_manager | procurement | finance | hr | kitchen_staff |
|--------|-----------|-------|----------------|----------------|-------|-----------------|-------------|---------|-----|---------------|
| **Org read** | R | R | R | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) |
| **Org mutate** | W | W | - | - | - | - | - | - | - | - |
| **Catalog read** | R | R (outlet) | R (region) | R (outlet) | R (outlet) | R (region) | R (outlet) | R (outlet) | R (outlet) | R (outlet) |
| **Catalog mutate** | W | - | - | - | - | W | - | - | - | - |
| **Sales write** | W | - | - | W (outlet) | W (outlet) | - | - | - | - | - |
| **Sales read** | R | R (outlet) | R (region) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) |
| **Procurement write** | W | - | - | W (outlet) | - | - | W (outlet) | - | - | - |
| **Procurement approve** | A | - | - | A (outlet) | - | - | - | - | - | - |
| **Procurement read** | R | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) |
| **Inventory write** | W | - | - | W (outlet) | - | - | - | - | - | - |
| **Inventory read** | R | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (outlet) |
| **Finance write** | W | - | - | W | - | - | - | W | - | - |
| **Finance read** | R | - | R | R | - | - | - | R | - | - |
| **Payroll prepare** | W | - | - | - | - | - | - | - | W (region) | - |
| **Payroll approve** | A | - | - | - | - | - | - | A (region) | - | - |
| **HR schedule** | W | - | - | W (outlet) | - | - | - | - | W (region) | - |
| **HR contracts** | W | - | - | W (outlet, limited roles) | - | - | - | - | W (region, all roles) | - |
| **Audit read** | R | R | R | - | - | - | - | - | - | - |
| **Report read** | R | R (outlet) | R (region) | R (outlet) | R (outlet) | R (outlet) | R (outlet) | R (region) | R (outlet) | R (outlet) |

---

## 5. Domain Rules in Detail

### 5.1 Organization (`org-service`)

- **Administrative read** (list all regions/outlets without filtering): `superadmin`, `admin`, `region_manager`.
- **Mutation** (create outlet, upsert exchange rate): `superadmin`, `admin`.
- All other roles see only outlets/regions reachable through their outlet assignments.

### 5.2 Product Catalog (`product-service`)

- **Catalog mutation** (create product/item, upsert price/recipe): `superadmin`, `product_manager`, or any user with `product.catalog.write` permission.
- **Catalog read by outlet** (list prices, find price): any user with the outlet in their scope. `product_manager` and `region_manager` see all outlets within their region.

### 5.3 Sales (`sales-service`)

- **Sales write** (open/close POS session, submit/approve/cancel sale, mark payment): `superadmin`, `outlet_manager`, `staff`, or any user with `sales.order.write` permission.
- **Sales write for specific outlet**: must have role at that outlet specifically, or `superadmin`.
- **Sales read scope resolution**:
  - `superadmin` and internal services: no filtering (null = all outlets).
  - `region_manager`: all outlets in their region(s).
  - Others: only outlets in `context.outletIds()`.
- **Promotion write**: same as sales write, but must specify and be scoped to target outlet IDs.
- **CRM read**: follows the same scoping as sales read.

### 5.4 Procurement (`procurement-service`)

- **Procurement write** (create PO, create goods receipt, create invoice, create payment): `superadmin`, `outlet_manager` (at outlet), `procurement` (at outlet), or `purchase.write` permission.
- **Procurement approve** (approve PO, approve goods receipt): `superadmin`, `outlet_manager` (at outlet), or `purchase.approve` permission. Note: `procurement` role alone cannot approve.
- **Procurement read**: `superadmin`, `procurement` (at outlet), `outlet_manager` (at outlet), or any user with outlet in scope.
- **Supplier management** (global procurement read/write): requires at least one outlet where user has procurement write access.

### 5.5 Inventory (`inventory-service`)

- **Inventory write** (create waste, stock count session, post stock count): `superadmin`, `outlet_manager` (at outlet), or `inventory.write` permission.
- **Inventory read** (stock balances, transactions): any user with the outlet in their scope. `superadmin` sees all.
- **Event-driven mutations** (sale completed, goods receipt posted): handled by internal service consumers, bypassing user auth.

### 5.6 Finance (`finance-service`)

- **Finance write** (create operating/other expense): `superadmin`, `finance`, `outlet_manager`.
- **Finance read** (list/get expenses): `superadmin`, `finance`, `region_manager`, `outlet_manager`.
- **Finance readable outlet resolution**: union of outlets from `finance`, `region_manager`, and `outlet_manager` role assignments.
- **Event-driven expense creation** (invoice approved, payroll approved): internal service consumers.

### 5.7 Payroll (`payroll-service`)

- **Payroll prepare** (create period, timesheet, draft): `superadmin`, `hr` (at region).
- **Payroll approve** (approve/reject payroll): `superadmin`, `finance` (at region).
- **HR prepares, Finance approves** is the enforced separation of duties.
- Cross-region isolation: `hr` in HCM cannot prepare payroll for NY region; `finance` in HCM cannot approve NY payroll.

### 5.8 HR (`hr-service`)

- **HR schedule** (shift management, work shift assignment):
  - Write: `superadmin`, `hr` (at outlet within region), `outlet_manager` (at outlet), or `hr.schedule` permission.
  - Read: same as write, plus any user with outlet membership for read-only access.
- **HR contracts**:
  - `hr` (region): can create/manage contracts for all role types within their region.
  - `outlet_manager` (outlet): can create contracts only for `staff`, `procurement`, `kitchen_staff`, `outlet_manager` within their outlet. Cannot create contracts for `hr`, `finance`, `region_manager`, `product_manager`.
  - `superadmin`: unrestricted.

### 5.9 Audit (`audit-service`)

- **Audit read** (query audit logs, security events, traces): `superadmin`, `admin`, `region_manager`.
- All other roles are denied audit access.

### 5.10 Reports (`report-service`)

- **Report read** (sales summary, expense summary, inventory movement, low stock): `superadmin`, `region_manager` (at outlet within region), `outlet_manager` (at outlet), `finance` (at outlet within region), or any user with outlet in scope.
- Report service reads from DB replica to avoid impacting transactional load.

---

## 6. Internal Service Bypass

All `AuthorizationPolicyService` methods grant full access when `context.internalService()` is true.
This applies to service-to-service calls authenticated via `X-Internal-Service-Token` header, which the gateway strips from external requests.
Internal service bypass covers:
- Kafka event consumers (inventory updates from sales, finance updates from procurement)
- Cross-service API calls (e.g., product-service calling org-service for outlet info)

---

## 7. Permission Matrix Fallback

For fine-grained access beyond canonical roles, the system supports outlet-level permissions stored in `user_permission`.
These are checked as fallback when canonical role checks don't grant access:

| Permission Code | Grants |
|---|---|
| `product.catalog.write` | Catalog mutation for the assigned outlet |
| `sales.order.write` | Sales write for the assigned outlet |
| `purchase.write` | Procurement write for the assigned outlet |
| `purchase.approve` | Procurement approval for the assigned outlet |
| `inventory.write` | Inventory write for the assigned outlet |
| `hr.schedule` | HR scheduling for the assigned outlet |
| `auth.user.write` | IAM user management (governance fallback) |
| `auth.role.write` | IAM role management (governance fallback) |

---

## 8. Key Design Decisions

1. **Admin is governance-only**: `admin` was intentionally changed from global bypass to scoped governance. This is the only behavioral change from the legacy model.
2. **No DB schema changes**: all scope information is derived from existing `user_role` + `user_permission` tables via fan-out/collapse.
3. **Separation of duties for payroll**: HR prepares, Finance approves. Neither can do both unless they hold both roles.
4. **Procurement approve vs write**: `procurement` role can create POs but cannot approve them. Only `outlet_manager` or `purchase.approve` permission holders can approve.
5. **Region scope via fan-out**: assigning a region-scoped role writes one row per outlet in the region. Removing an outlet from a region automatically adjusts the user's effective scope.
6. **Outlet membership as read floor**: any user with an outlet in their JWT `outletIds` can read basic data (catalog prices, reports, inventory balances) for that outlet, regardless of their business role.

---

## 9. Test Coverage

All business rules are verified by `AuthorizationPolicyDomainAccessTest` (193 tests) covering:

| Test Suite | Tests | Scope |
|---|---|---|
| `SuperadminGlobalBypass` | 21 | All domains granted |
| `AdminScopedGovernance` | 17 | Org mutation + audit read allowed; all business ops denied |
| `RegionManagerScopedRead` | 17 | Region-scoped read for org/sales/reports/audit; no writes |
| `OutletManagerScopedOps` | 22 | Outlet-scoped business operations; cross-outlet denied |
| `StaffPosOnly` | 18 | POS/sales only; everything else denied |
| `ProductManagerCatalog` | 14 | Catalog mutation only |
| `ProcurementOutletWrite` | 12 | Procurement write (no approve); cross-outlet denied |
| `FinanceRegionScoped` | 16 | Finance read/write + payroll approve; no payroll prepare |
| `HrRegionScoped` | 14 | Payroll prepare + HR schedule; no payroll approve |
| `KitchenStaffMinimal` | 10 | Outlet membership read only |
| `InternalServiceBypass` | 21 | All domains granted for service-to-service |
| `LegacyAliasMapping` | 7 | cashier->staff, procurement_officer->procurement, etc. |
| `CrossScopeIsolation` | 4 | HCM roles cannot access NY resources |
