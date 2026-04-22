# INTER-MODULE FLOWS — Luồng nghiệp vụ xuyên module

Mô tả các flow vắt qua ≥2 service. Chi tiết từng bước nằm trong UC từng module; tài liệu này giữ bức tranh tổng.

## 1. Procure-to-Pay (P2P)

```mermaid
flowchart LR
  PO[Purchase Order<br/>procurement] -->|approved| GR[Goods Receipt<br/>procurement]
  GR -->|posted| INV[Inventory Transaction<br/>inventory]
  INV --> SB[Stock Balance]
  GR --> INVC[Supplier Invoice<br/>procurement]
  INVC -->|approved| PAY[Supplier Payment<br/>procurement → finance]
  PAY --> EXP[expense_inventory_purchase<br/>finance]
```

- UC liên quan: `UC-PROC-001` (PO), `UC-PROC-002` (GR), `UC-PROC-003` (Invoice), `UC-FIN-001` (Payment).
- Three-way match: PO ↔ GR ↔ Invoice trước khi duyệt thanh toán.

## 2. Order-to-Cash (O2C) — POS

```mermaid
flowchart LR
  OPEN[Mở phiên POS] --> ORD[Tạo đơn POS]
  ORD -->|lines| PROMO[Áp khuyến mãi]
  ORD -->|post| INV_TX[Inventory Tx<br/>trừ tồn]
  ORD -->|paid| PAYMENT[Payment capture]
  PAYMENT --> REV[Doanh thu<br/>finance revenue]
  ORD -->|end of shift| CLOSE[Đóng phiên<br/>+ reconcile]
```

- UC: `UC-POS-001..006`.
- `sale_item_transaction` ghi nối đơn → kho (mỗi sale_item sinh inventory_transaction).

## 3. Workforce-to-Payroll

```mermaid
flowchart LR
  SHIFT[Phân ca<br/>hr] --> ATTD[Chấm công<br/>hr]
  ATTD -->|approved| TS[payroll_timesheet]
  TS --> PERIOD[payroll_period<br/>payroll]
  PERIOD --> SLIP[payroll slip]
  SLIP --> EXP[expense_payroll<br/>finance]
```

- UC: `UC-HR-002` (phân ca), `UC-HR-003` (phê duyệt), `UC-FIN-002` (chạy bảng lương).

## 4. Catalog Publish

```mermaid
flowchart LR
  PROD[Product/Recipe/Pricing] --> VER[publish_version<br/>draft]
  VER --> ITEMS[publish_item snapshot]
  VER -->|activate| ACTIVE[publish_version ACTIVE]
  ACTIVE --> POS_MENU[POS menu render]
  ACTIVE --> PUBLIC[Public QR menu]
```

- UC: `UC-CAT-004` (xuất bản menu).
- Chỉ 1 `publish_version` ACTIVE mỗi (outlet × channel × daypart).

## 5. Period Close — Finance

```mermaid
flowchart LR
  REV[sale_record revenue] --> PNL
  EXP_OP[expense_operating] --> PNL
  EXP_PAY[expense_payroll] --> PNL
  EXP_INV[expense_inventory_purchase] --> PNL
  PNL[P&L calc] --> CLOSE[fiscal period CLOSED]
  CLOSE -->|lock| LOCK[no retroactive edits]
```

- UC: `UC-FIN-003` (đóng kỳ), `UC-FIN-004` (P&L report).

## 6. Audit sidecar (mọi module)

Tất cả module ghi domain event → `audit-service` sink → `audit_log` / `catalog_audit_log`.

```mermaid
flowchart LR
  ACT[Action ở bất kỳ service] -->|event| BUS[event-schemas / sync RPC]
  BUS --> AUD[audit-service]
  AUD --> LOG[audit_log]
```

- UC: `UC-AUD-001..004`.
