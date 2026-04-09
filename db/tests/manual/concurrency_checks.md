# Manual Concurrency Checks

Use this file as a checklist when validating database behavior with two concurrent SQL sessions.

## Supplier Payment Allocation

Goal:

- ensure concurrent allocations cannot push one payment above `supplier_payment.amount`

Suggested flow:

1. Session A begins a transaction and inserts one allocation.
2. Session B begins a transaction and attempts another allocation against the same payment.
3. Commit both in different orders.
4. Confirm the second invalid state is rejected.

## Inventory Transaction Pressure

Goal:

- ensure concurrent inventory movements do not leave `stock_balance` inconsistent

Suggested flow:

1. Session A inserts `purchase_in`.
2. Session B inserts `sale_usage`.
3. Commit in alternating order.
4. Confirm `stock_balance.qty_on_hand` matches the net movement.

## Sale And Payment Race

Goal:

- ensure service code serializes updates when sale status and payment status change together

Suggested flow:

1. Session A updates `sale_record.status`.
2. Session B updates `payment.status`.
3. Verify the final state still matches the service lifecycle rules.
