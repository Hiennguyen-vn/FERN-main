-- V32: Outlet-scoped composite indexes for chuỗi cafe (5–20 outlets per chain).
--
-- Rationale: every operational query is outlet-scoped (POS reads its own outlet,
-- managers read one outlet's day, reports aggregate per outlet). Existing
-- partitions are by time only; queries that filter outlet_id over a time window
-- need to scan every per-month partition unless the leading index column is
-- outlet_id. These composite indexes are local (per-partition) and let the
-- planner do partition pruning on time + outlet_id seek inside each partition.
--
-- Full repartition by HASH/LIST(outlet_id) is intentionally deferred until
-- per-chain data volume justifies the rebuild cost (see plan PHASE 2).
--
-- All CREATEs are IF NOT EXISTS to be replay-safe across environments.

-- sale_record: hot path for POS list, daily revenue, manager dashboard
CREATE INDEX IF NOT EXISTS idx_sale_record_outlet_created
  ON core.sale_record(outlet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_record_outlet_status_created
  ON core.sale_record(outlet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_record_outlet_payment_created
  ON core.sale_record(outlet_id, payment_status, created_at DESC);

-- sale_item: outlet_id is denormalized; composite gets per-outlet drill-down
CREATE INDEX IF NOT EXISTS idx_sale_item_outlet_created
  ON core.sale_item(outlet_id, sale_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_item_outlet_product_created
  ON core.sale_item(outlet_id, product_id, sale_created_at DESC);

-- payment: cash close + reconciliation queries scope by outlet + state
CREATE INDEX IF NOT EXISTS idx_payment_outlet_state_time
  ON core.payment(outlet_id, state, payment_time DESC);

CREATE INDEX IF NOT EXISTS idx_payment_outlet_method_time
  ON core.payment(outlet_id, payment_method, payment_time DESC);

-- inventory_transaction: stock balance recompute, waste reports, daily ledgers
CREATE INDEX IF NOT EXISTS idx_inventory_txn_outlet_time
  ON core.inventory_transaction(outlet_id, txn_time DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_outlet_type_time
  ON core.inventory_transaction(outlet_id, txn_type, txn_time DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_outlet_item_time
  ON core.inventory_transaction(outlet_id, item_id, txn_time DESC);

-- processed_events: outlet-level dedup lookup hot path
CREATE INDEX IF NOT EXISTS idx_processed_events_outlet_idem
  ON core.processed_events(outlet_id, idempotency_key, server_received_at DESC);

-- outbox_event: drain ordering already optimal; add per-outlet replay support
-- (aggregate_id is sale_id which is outlet-scoped via processed_events join,
--  so a covering index on event_key gives admin fast outlet replay)
CREATE INDEX IF NOT EXISTS idx_outbox_event_topic_status
  ON core.outbox_event(topic, status, created_at);
