# STATE MACHINES — Sơ đồ trạng thái các thực thể chính

Mỗi sơ đồ phản ánh enum/trạng thái hiện có trong code & migration.

## 1. Purchase Order

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> APPROVED: approve()
  DRAFT --> CANCELLED: cancel()
  APPROVED --> POSTED: post() / GR matched
  APPROVED --> CANCELLED
  POSTED --> CLOSED: all GR received
  POSTED --> [*]
  CLOSED --> [*]
```

## 2. Goods Receipt

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> APPROVED: approve()
  DRAFT --> CANCELLED
  APPROVED --> POSTED: post() → inventory_transaction
  POSTED --> [*]
```

## 3. Supplier Invoice

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> APPROVED: three-way match (PO+GR+Invoice)
  DRAFT --> REJECTED
  APPROVED --> PAID: supplier_payment allocated
  APPROVED --> PARTIAL: partial payment
  PARTIAL --> PAID
  PAID --> [*]
```

## 4. Supplier Payment

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> POSTED: post()
  POSTED --> REVERSED: reverse()
  POSTED --> CANCELLED
  REVERSED --> [*]
  CANCELLED --> [*]
```

## 5. POS Session

```mermaid
stateDiagram-v2
  [*] --> OPEN: open(outlet)
  OPEN --> RECONCILING: begin close
  RECONCILING --> CLOSED: reconcile OK
  RECONCILING --> OPEN: discrepancy → reopen
  CLOSED --> [*]
```

## 6. Sale Record

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> POSTED: add items + payment full
  DRAFT --> CANCELLED
  POSTED --> REFUNDED: refund() (perm sale.refund)
  POSTED --> [*]
```

## 7. Stock Count Session

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> COUNTING: start counting
  COUNTING --> RECONCILING: submit counts
  RECONCILING --> POSTED: post → inventory_adjustment
  RECONCILING --> DRAFT: re-count
  POSTED --> [*]
```

## 8. Employment Contract

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> ACTIVE: sign & effective date
  ACTIVE --> AMENDED: new version
  AMENDED --> ACTIVE
  ACTIVE --> TERMINATED: end/resign/fire
  TERMINATED --> [*]
```

## 9. Payroll Period

```mermaid
stateDiagram-v2
  [*] --> OPEN
  OPEN --> PREP: collect timesheets
  PREP --> REVIEW: generate slips
  REVIEW --> APPROVED: approver sign-off
  APPROVED --> PAID: payout
  PAID --> CLOSED
  CLOSED --> [*]
```

## 10. Outlet Lifecycle

```mermaid
stateDiagram-v2
  [*] --> ACTIVE
  ACTIVE --> INACTIVE: temporarily disable
  INACTIVE --> ACTIVE: re-enable
  ACTIVE --> CLOSED: permanent close
  CLOSED --> ARCHIVED: retention period over
  ARCHIVED --> [*]
```

## 11. Publish Version (Menu)

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> ACTIVE: activate() (deactivate current)
  ACTIVE --> SUPERSEDED: newer version activated
  DRAFT --> DISCARDED
  SUPERSEDED --> [*]
  DISCARDED --> [*]
```
