# FERN Database Diagram

All tables below live in schema `core`.

This ERD is derived from the SQL migrations in:

- `db/migrations/V1__core_schema.sql`
- `db/migrations/V3__service_control_plane_and_idempotency.sql`
- `db/migrations/V4__auth_sessions.sql`
- `db/migrations/V5__public_pos_ordering_tables.sql`
- `db/migrations/V6__public_pos_order_tracking.sql`
- `db/migrations/V7__sales_order_lifecycle_and_stock_guards.sql`
- `db/migrations/V9__simulator_run_tracking.sql`
- `db/migrations/V10__simulator_cleanup_stock_sync_guard.sql`
- `db/migrations/V11__pos_session_reconciliation.sql`

`V2`, `V8`, and `V12` do not add new entities. They add indexes, trigger fixes, and data backfill.

## 1. Core / Org / IAM / HR / Auth

```mermaid
erDiagram
  currency {
    VARCHAR code PK
    VARCHAR name
    VARCHAR symbol
  }

  region {
    BIGINT id PK
    VARCHAR code UK
    BIGINT parent_region_id FK
    VARCHAR currency_code FK
    VARCHAR timezone_name
  }

  outlet {
    BIGINT id PK
    BIGINT region_id FK
    VARCHAR code UK
    location_status_enum status
  }

  role {
    VARCHAR code PK
    VARCHAR name UK
    role_status_enum status
  }

  permission {
    VARCHAR code PK
    VARCHAR name UK
  }

  role_permission {
    VARCHAR role_code PK, FK
    VARCHAR permission_code PK, FK
  }

  app_user {
    BIGINT id PK
    VARCHAR username UK
    VARCHAR employee_code UK
    user_status_enum status
  }

  user_role {
    BIGINT user_id PK, FK
    VARCHAR role_code PK, FK
    BIGINT outlet_id PK, FK
  }

  user_permission {
    BIGINT user_id PK, FK
    VARCHAR permission_code PK, FK
    BIGINT outlet_id PK, FK
  }

  shift {
    BIGINT id PK
    BIGINT outlet_id FK
    VARCHAR code
    TIME start_time
    TIME end_time
  }

  work_shift {
    BIGINT id PK
    BIGINT shift_id FK
    BIGINT user_id FK
    DATE work_date
    shift_schedule_status_enum schedule_status
    attendance_status_enum attendance_status
    approval_status_enum approval_status
  }

  employee_contract {
    BIGINT id PK
    BIGINT user_id FK
    VARCHAR region_code FK
    VARCHAR currency_code FK
    employment_type_enum employment_type
    salary_type_enum salary_type
    NUMERIC base_salary
    contract_status_enum status
  }

  auth_session {
    VARCHAR session_id PK
    BIGINT user_id FK
    BIGINT revoked_by_user_id FK
    TIMESTAMPTZ expires_at
    TIMESTAMPTZ revoked_at
  }

  currency ||--o{ region : default_for
  region ||--o{ region : parent_of
  region ||--o{ outlet : contains

  role ||--o{ role_permission : grants
  permission ||--o{ role_permission : maps

  app_user ||--o{ user_role : assigned
  role ||--o{ user_role : scoped_role
  outlet ||--o{ user_role : scoped_outlet

  app_user ||--o{ user_permission : granted
  permission ||--o{ user_permission : scoped_permission
  outlet ||--o{ user_permission : scoped_outlet

  outlet ||--o{ shift : defines
  shift ||--o{ work_shift : schedules
  app_user ||--o{ work_shift : works

  app_user ||--o{ employee_contract : has
  region ||--o{ employee_contract : tax_region
  currency ||--o{ employee_contract : salary_currency

  app_user ||--o{ auth_session : opens
```

Notes:

- `employee_contract.region_code` points to `region.code`, not `region.id`.
- `work_shift.assigned_by_user_id` and `work_shift.approved_by_user_id` also point to `app_user.id`.
- `employee_contract.created_by_user_id` also points to `app_user.id`.
- `auth_session.revoked_by_user_id` also points to `app_user.id`.

## 2. Catalog / Pricing

```mermaid
erDiagram
  product_category {
    VARCHAR code PK
    VARCHAR name UK
    BOOLEAN is_active
  }

  item_category {
    VARCHAR code PK
    VARCHAR name UK
    BOOLEAN is_active
  }

  unit_of_measure {
    VARCHAR code PK
    VARCHAR name UK
  }

  uom_conversion {
    VARCHAR from_uom_code PK, FK
    VARCHAR to_uom_code PK, FK
    NUMERIC conversion_factor
  }

  item {
    BIGINT id PK
    VARCHAR code UK
    VARCHAR category_code FK
    VARCHAR base_uom_code FK
    item_status_enum status
  }

  product {
    BIGINT id PK
    VARCHAR code UK
    VARCHAR category_code FK
    product_status_enum status
  }

  tax_rate {
    BIGINT region_id PK, FK
    BIGINT product_id PK, FK
    DATE effective_from PK
    NUMERIC tax_percent
  }

  recipe {
    BIGINT product_id PK, FK
    VARCHAR version PK
    VARCHAR yield_uom_code FK
    recipe_status_enum status
  }

  recipe_item {
    BIGINT product_id PK, FK
    VARCHAR version PK, FK
    BIGINT item_id PK, FK
    VARCHAR uom_code FK
    NUMERIC qty
  }

  product_outlet_availability {
    BIGINT product_id PK, FK
    BIGINT outlet_id PK, FK
    BOOLEAN is_available
  }

  product_price {
    BIGINT product_id PK, FK
    BIGINT outlet_id PK, FK
    DATE effective_from PK
    VARCHAR currency_code FK
    NUMERIC price_value
  }

  item_category ||--o{ item : classifies
  unit_of_measure ||--o{ uom_conversion : converts
  unit_of_measure ||--o{ item : base_unit

  product_category ||--o{ product : classifies

  region ||--o{ tax_rate : defines
  product ||--o{ tax_rate : taxed

  product ||--o{ recipe : has
  unit_of_measure ||--o{ recipe : yields_in
  recipe ||--o{ recipe_item : contains
  item ||--o{ recipe_item : consumes
  unit_of_measure ||--o{ recipe_item : measured_in

  product ||--o{ product_outlet_availability : offered_at
  outlet ||--o{ product_outlet_availability : offers

  product ||--o{ product_price : priced_at
  outlet ||--o{ product_price : outlet_price
  currency ||--o{ product_price : currency
```

Notes:

- `uom_conversion` has two foreign keys back to `unit_of_measure`: `from_uom_code` and `to_uom_code`.
- `product.created_by_user_id`, `product.updated_by_user_id`, `recipe.created_by_user_id`, `product_price.created_by_user_id`, and `product_price.updated_by_user_id` all point to `app_user.id`.

## 3. Procurement

```mermaid
erDiagram
  supplier_procurement {
    BIGINT id PK
    BIGINT region_id FK
    VARCHAR supplier_code UK
    supplier_status_enum status
  }

  purchase_order {
    BIGINT id PK
    BIGINT supplier_id FK
    BIGINT outlet_id FK
    VARCHAR currency_code FK
    DATE order_date
    po_status_enum status
  }

  purchase_order_item {
    BIGINT po_id PK, FK
    BIGINT item_id PK, FK
    VARCHAR uom_code FK
    NUMERIC qty_ordered
    NUMERIC qty_received
    po_item_status_enum status
  }

  goods_receipt {
    BIGINT id PK
    BIGINT po_id FK
    VARCHAR currency_code FK
    TIMESTAMPTZ receipt_time
    receipt_status_enum status
  }

  goods_receipt_item {
    BIGINT id PK
    BIGINT receipt_id FK
    BIGINT po_id FK
    BIGINT item_id FK
    VARCHAR uom_code FK
    NUMERIC qty_received
    NUMERIC unit_cost
  }

  supplier_invoice {
    BIGINT id PK
    BIGINT supplier_id FK
    VARCHAR currency_code FK
    DATE invoice_date
    supplier_invoice_status_enum status
    NUMERIC total_amount
  }

  supplier_invoice_receipt {
    BIGINT invoice_id PK, FK
    BIGINT receipt_id PK, FK
  }

  supplier_invoice_item {
    BIGINT invoice_id PK, FK
    INT line_number PK
    BIGINT goods_receipt_item_id FK
    supplier_invoice_line_type_enum line_type
    NUMERIC line_total
  }

  supplier_payment {
    BIGINT id PK
    BIGINT supplier_id FK
    VARCHAR currency_code FK
    payment_method_enum payment_method
    NUMERIC amount
    supplier_payment_status_enum status
  }

  supplier_payment_allocation {
    BIGINT payment_id PK, FK
    BIGINT invoice_id PK, FK
    NUMERIC allocated_amount
  }

  region ||--o{ supplier_procurement : located_in

  supplier_procurement ||--o{ purchase_order : receives
  outlet ||--o{ purchase_order : orders_for
  currency ||--o{ purchase_order : ordered_in

  purchase_order ||--o{ purchase_order_item : contains
  item ||--o{ purchase_order_item : ordered_item
  unit_of_measure ||--o{ purchase_order_item : ordered_uom

  purchase_order ||--o{ goods_receipt : fulfilled_by
  currency ||--o{ goods_receipt : received_in

  goods_receipt ||--o{ goods_receipt_item : receives
  purchase_order_item ||--o{ goods_receipt_item : matches_po_line
  unit_of_measure ||--o{ goods_receipt_item : receipt_uom

  supplier_procurement ||--o{ supplier_invoice : bills
  currency ||--o{ supplier_invoice : invoiced_in

  supplier_invoice ||--o{ supplier_invoice_receipt : links
  goods_receipt ||--o{ supplier_invoice_receipt : linked_receipt

  supplier_invoice ||--o{ supplier_invoice_item : lines
  goods_receipt_item ||--o{ supplier_invoice_item : matched_receipt_line

  supplier_procurement ||--o{ supplier_payment : paid
  currency ||--o{ supplier_payment : payment_currency
  supplier_payment ||--o{ supplier_payment_allocation : allocates
  supplier_invoice ||--o{ supplier_payment_allocation : settled
```

Notes:

- `goods_receipt_item` is anchored by two composite relationships: `(receipt_id, po_id) -> goods_receipt(id, po_id)` and `(po_id, item_id) -> purchase_order_item(po_id, item_id)`.
- `supplier_invoice` must be linked to at least one `goods_receipt` via trigger-enforced rules.
- `purchase_order.created_by_user_id`, `purchase_order.approved_by_user_id`, `goods_receipt.created_by_user_id`, `goods_receipt.approved_by_user_id`, `supplier_invoice.created_by_user_id`, `supplier_invoice.approved_by_user_id`, and `supplier_payment.created_by_user_id` all point to `app_user.id`.

## 4. Sales / POS

```mermaid
erDiagram
  ordering_table {
    BIGINT id PK
    BIGINT outlet_id FK
    TEXT table_code
    TEXT public_token UK
    ordering_table_status_enum status
  }

  pos_session {
    BIGINT id PK
    BIGINT outlet_id FK
    VARCHAR currency_code FK
    BIGINT manager_id FK
    DATE business_date
    pos_session_status_enum status
  }

  sale_record {
    BIGINT id PK
    BIGINT outlet_id FK
    BIGINT pos_session_id FK
    BIGINT ordering_table_id FK
    VARCHAR currency_code FK
    TEXT public_token UK
    order_type_enum order_type
    sale_order_status_enum status
    payment_status_enum payment_status
  }

  payment {
    BIGINT sale_id PK, FK
    BIGINT pos_session_id FK
    payment_method_enum payment_method
    payment_txn_status_enum status
    NUMERIC amount
  }

  sale_item {
    BIGINT sale_id PK, FK
    BIGINT product_id PK, FK
    NUMERIC qty
    NUMERIC unit_price
    NUMERIC line_total
  }

  promotion {
    BIGINT id PK
    promo_type_enum promo_type
    promo_status_enum status
    TIMESTAMPTZ effective_from
    TIMESTAMPTZ effective_to
  }

  promotion_scope {
    BIGINT promotion_id PK, FK
    BIGINT outlet_id PK, FK
  }

  sale_item_promotion {
    BIGINT sale_id PK, FK
    BIGINT product_id PK, FK
    BIGINT promotion_id PK, FK
  }

  pos_session_reconciliation {
    BIGINT session_id PK, FK
    BIGINT reconciled_by_user_id FK
    TIMESTAMPTZ reconciled_at
    NUMERIC expected_total
    NUMERIC actual_total
  }

  pos_session_reconciliation_line {
    BIGINT session_id PK, FK
    payment_method_enum payment_method PK
    NUMERIC expected_amount
    NUMERIC actual_amount
  }

  outlet ||--o{ ordering_table : owns

  outlet ||--o{ pos_session : runs
  currency ||--o{ pos_session : base_currency

  outlet ||--o{ sale_record : records
  pos_session ||--o{ sale_record : groups
  ordering_table ||--o{ sale_record : table_order
  currency ||--o{ sale_record : charged_in

  sale_record ||--|| payment : settled_by
  pos_session ||--o{ payment : captured_in

  sale_record ||--o{ sale_item : contains
  product ||--o{ sale_item : sold_product

  promotion ||--o{ promotion_scope : scoped
  outlet ||--o{ promotion_scope : enabled_at

  sale_item ||--o{ sale_item_promotion : receives
  promotion ||--o{ sale_item_promotion : applied

  pos_session ||--o| pos_session_reconciliation : closes_with
  pos_session_reconciliation ||--o{ pos_session_reconciliation_line : by_method
```

Notes:

- `payment` is intentionally 1:1 with `sale_record`; `sale_id` is both PK and FK.
- `sale_record.ordering_table_id` and `sale_record.public_token` were added in `V6__public_pos_order_tracking.sql`.
- `pos_session.manager_id` and `pos_session_reconciliation.reconciled_by_user_id` point to `app_user.id`.

## 5. Inventory

```mermaid
erDiagram
  stock_balance {
    BIGINT location_id PK, FK
    BIGINT item_id PK, FK
    NUMERIC qty_on_hand
    NUMERIC unit_cost
    DATE last_count_date
  }

  inventory_transaction {
    BIGINT id PK
    BIGINT outlet_id FK
    BIGINT item_id FK
    inventory_txn_type_enum txn_type
    NUMERIC qty_change
    DATE business_date
    TIMESTAMPTZ txn_time
  }

  waste_record {
    BIGINT inventory_transaction_id PK, FK
    BIGINT approved_by_user_id FK
    VARCHAR reason
  }

  goods_receipt_transaction {
    BIGINT inventory_transaction_id PK, FK
    BIGINT goods_receipt_item_id FK
  }

  sale_item_transaction {
    BIGINT inventory_transaction_id PK, FK
    BIGINT sale_id FK
    BIGINT product_id FK
    BIGINT item_id FK
  }

  manufacturing_batch {
    BIGINT id PK
    BIGINT outlet_id FK
    VARCHAR reference_code UK
    DATE business_date
  }

  manufacturing_transaction {
    BIGINT inventory_transaction_id PK, FK
    BIGINT manufacturing_batch_id FK
  }

  stock_count_session {
    BIGINT id PK
    BIGINT location_id FK
    DATE count_date
    stock_count_status_enum status
  }

  stock_count_line {
    BIGINT id PK
    BIGINT stock_count_session_id FK
    BIGINT item_id FK
    NUMERIC system_qty
    NUMERIC actual_qty
    NUMERIC variance_qty
  }

  inventory_adjustment {
    BIGINT inventory_transaction_id PK, FK
    BIGINT stock_count_line_id FK
    BIGINT approved_by_user_id FK
    VARCHAR reason
  }

  outlet ||--o{ stock_balance : keeps
  item ||--o{ stock_balance : balance_for

  outlet ||--o{ inventory_transaction : moves_stock
  item ||--o{ inventory_transaction : stock_item

  inventory_transaction ||--o| waste_record : waste_detail
  inventory_transaction ||--o| goods_receipt_transaction : receipt_detail
  goods_receipt_item ||--o| goods_receipt_transaction : source_line

  inventory_transaction ||--o| sale_item_transaction : sale_detail
  sale_item ||--o{ sale_item_transaction : consumes
  item ||--o{ sale_item_transaction : ingredient

  outlet ||--o{ manufacturing_batch : batches
  inventory_transaction ||--o| manufacturing_transaction : manufacturing_detail
  manufacturing_batch ||--o{ manufacturing_transaction : batch_lines

  outlet ||--o{ stock_count_session : counts
  stock_count_session ||--o{ stock_count_line : count_lines
  item ||--o{ stock_count_line : counted_item

  inventory_transaction ||--o| inventory_adjustment : adjustment_detail
  stock_count_line ||--o{ inventory_adjustment : posts_from
```

Notes:

- `stock_balance` is a cache table maintained by trigger from `inventory_transaction`.
- `sale_item_transaction.item_id` was added in `V7__sales_order_lifecycle_and_stock_guards.sql` and points to `item.id`.
- `waste_record.approved_by_user_id`, `stock_count_session.counted_by_user_id`, `stock_count_session.approved_by_user_id`, `manufacturing_batch.created_by_user_id`, `inventory_transaction.created_by_user_id`, and `inventory_adjustment.approved_by_user_id` point to `app_user.id`.

## 6. Finance / Expense / Audit

```mermaid
erDiagram
  payroll_period {
    BIGINT id PK
    BIGINT region_id FK
    DATE start_date
    DATE end_date
    DATE pay_date
  }

  payroll_timesheet {
    BIGINT id PK
    BIGINT payroll_period_id FK
    BIGINT user_id FK
    BIGINT outlet_id FK
    NUMERIC work_days
    NUMERIC overtime_hours
  }

  payroll {
    BIGINT id PK
    BIGINT payroll_timesheet_id FK
    VARCHAR currency_code FK
    NUMERIC base_salary_amount
    NUMERIC net_salary
    payroll_status_enum status
  }

  expense_record {
    BIGINT id PK
    BIGINT outlet_id FK
    VARCHAR currency_code FK
    DATE business_date
    NUMERIC amount
    expense_source_type_enum source_type
  }

  expense_inventory_purchase {
    BIGINT expense_record_id PK, FK
    BIGINT goods_receipt_id FK
  }

  expense_operating {
    BIGINT expense_record_id PK, FK
    TEXT description
  }

  expense_other {
    BIGINT expense_record_id PK, FK
    TEXT description
  }

  expense_payroll {
    BIGINT expense_record_id PK, FK
    BIGINT payroll_id FK
  }

  audit_log {
    BIGINT id PK
    BIGINT actor_user_id FK
    audit_action_enum action
    VARCHAR entity_name
    VARCHAR entity_id
    TIMESTAMPTZ created_at
  }

  region ||--o{ payroll_period : closes
  payroll_period ||--o{ payroll_timesheet : contains
  app_user ||--o{ payroll_timesheet : employee
  outlet ||--o{ payroll_timesheet : worked_at

  payroll_timesheet ||--o| payroll : pays
  currency ||--o{ payroll : payroll_currency

  outlet ||--o{ expense_record : records
  currency ||--o{ expense_record : expense_currency

  expense_record ||--o| expense_inventory_purchase : purchase_expense
  goods_receipt ||--o| expense_inventory_purchase : source_receipt

  expense_record ||--o| expense_operating : operating_expense
  expense_record ||--o| expense_other : other_expense

  expense_record ||--o| expense_payroll : payroll_expense
  payroll ||--o| expense_payroll : payroll_source

  app_user ||--o{ audit_log : acts
```

Notes:

- `payroll.payroll_timesheet_id` is `UNIQUE`, so the DB enforces one payroll row per timesheet.
- `expense_inventory_purchase.goods_receipt_id` and `expense_payroll.payroll_id` are both `UNIQUE`, so each source object can back at most one expense extension row.
- `payroll.approved_by_user_id`, `payroll_timesheet.approved_by_user_id`, and `expense_record.created_by_user_id` point to `app_user.id`.
- `audit_log` is polymorphic by `entity_name` and `entity_id`, so it does not use direct foreign keys to business tables.

## 7. Platform / Control Plane / Simulator

```mermaid
erDiagram
  service_instance {
    BIGINT id PK
    VARCHAR service_name
    VARCHAR version
    VARCHAR host
    INT port
    VARCHAR status
  }

  service_assignment {
    BIGINT id PK
    BIGINT instance_id FK
    BIGINT outlet_id FK
    VARCHAR service_name
    VARCHAR region_code
    BOOLEAN active
  }

  service_config_profile {
    BIGINT id PK
    VARCHAR service_name
    BIGINT config_version
    VARCHAR etag
    BOOLEAN active
  }

  feature_flag {
    BIGINT id PK
    VARCHAR service_name
    VARCHAR flag_key
    BOOLEAN enabled
  }

  service_release {
    BIGINT id PK
    VARCHAR service_name
    VARCHAR version
    VARCHAR status
  }

  service_rollout {
    BIGINT id PK
    BIGINT release_id FK
    VARCHAR stage
    VARCHAR desired_state
    VARCHAR actual_state
  }

  idempotency_keys {
    VARCHAR service_name PK
    VARCHAR idempotency_key PK
    CHAR request_hash
    VARCHAR status
    TIMESTAMPTZ expires_at
  }

  simulator_run {
    TEXT id PK
    TEXT namespace
    TEXT status
    TIMESTAMPTZ started_at
    TIMESTAMPTZ completed_at
    TIMESTAMPTZ cleaned_at
  }

  service_instance ||--o{ service_assignment : assigned
  outlet ||--o{ service_assignment : outlet_scope
  service_release ||--o{ service_rollout : rolls_out
```

Notes:

- `service_assignment.region_code` is a logical region scope only; it is not a foreign key to `region`.
- `service_config_profile`, `feature_flag`, and `idempotency_keys` are keyed by `service_name` but are not linked by foreign keys to `service_instance` or `service_release`.
- `simulator_run` is standalone and was extended in `V10__simulator_cleanup_stock_sync_guard.sql`.
