# Simulator vs DB Coverage Audit (V1–V73)

Snapshot 2026-05-01. DB truth: `db/migrations/V1–V73` (Flyway, schemas: `core`, `crm`, `public`).

## Summary

- Tables created in DB: ~140 (excluding partition `_default`/`_<date>` suffixes).
- Tables written by simulator: 64.
- **Real gap (excluding partition noise + control-plane internals): 38 tables across 8 module groups.**

## Gap by Module

### CRM / Loyalty (V58, V60) — **fully missing**
- `crm.customer`, `crm.points_ledger`, `crm.otp_request`, `crm.customer_allergy`
- `core.sale_record.customer_id` (FK link, currently null in sim) — V60
- → **CrmPhase needed.** Knobs: newCustomerPerDay, repeatRate, loyaltyEnrollRate, otpVerifyRate.

### Catalog Depth (V14–V16, V18, V55, V69, V70)
- `core.menu`, `menu_category`, `menu_item`, `menu_item_exclusion`, `daypart`, `channel`
- `core.product_variant`, `product_modifier_group`, `modifier_group`, `modifier_option`, `modifier_recipe_effect`
- `core.allergen`, `product_allergen`
- `core.publish_item`, `publish_version`, `catalog_audit_log`, `catalog_override`
- → Extend CatalogPhase: variants, modifier groups, menus, allergens, publish workflow.

### Promotion Rules (V50, V51) — header only sim'd
- `core.promotion_bxgy_rule`, `promotion_combo_rule`, `promotion_combo_rule_item`, `promotion_subsidy_rule`
- → Extend PromotionPhase to emit rule rows for ~30% promotions.

### POS / Sales (V36, V42, V57, V67, V68)
- `core.cash_movement` — cash drawer in/out
- `core.sale_oversell_line` — POS_OVERSELL flag rows (V36)
- `core.sale_inventory_reversal` — void/refund inventory restore
- `core.void_reason` (taxonomy seed; semi-static)
- `core.sale_item_modifier` — modifier captured on sale line
- → Extend SalesPhase: cash movements per session, oversell ~1%, void/refund cycle, modifiers on items.

### Inventory (V56, V71)
- `core.stock_lot`, `stock_reservation` — FIFO lots + reservations
- → Extend InventoryPhase: lot tracking on receipts, reservations on B2B orders.

### HR / Workforce (V17)
- `core.shift_role_requirement` — role headcount target per shift
- → Extend WorkforcePhase: emit requirements; SalesPhase honor when scheduling.

### Finance (V40, V65)
- `core.tax_rule` (V40 — semi-static; one-time seed)
- `core.expense_document` (V65) — attached docs per expense_record
- → Seed tax_rule once at sim start; ExpensePhase emit 1 doc per ~70% expenses.

### Audit / Manager Override (V18)
- `core.manager_override_audit`
- → Sales/Inventory phase: emit on price override, oversell approve, waste >threshold.

### IAM (V18, etc.)
- `core.user_permission` (override grants beyond role) — sim only writes user_role
- → Optional, low-priority.

## Excluded From Gap (intentional)

- Partition placeholders: `*_`, `*_default`, partman-managed.
- Control plane: `service_*`, `service_instance`, `feature_flag`, `shedlock`, `outbox_event*`, `idempotency_keys`, `processed_events*`, `device_*`, `auth_session` (sim already covers app_user/role).
- Reporting views: `recipe_cost_view` (V72).

## Action Priority

1. **CrmPhase** + sale_record.customer_id link (Step 3 of plan).
2. **Sales depth**: cash_movement, void/refund/reversal, modifiers, oversell (Step 2/4).
3. **Finance**: tax_rule seed + expense_document (Step 5).
4. **Catalog depth**: variants + modifiers + menus (extend Step 8 config + new sub-phase).
5. **Inventory lots/reservations** (Step 4 dependency).
6. **HR shift_role_requirement** (Step 6).
7. Promotion rules + manager_override_audit (Step 5/6 polish).
