CREATE INDEX IF NOT EXISTS idx_inventory_transaction_txn_time_desc
  ON core.inventory_transaction(txn_time DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at_pk
  ON core.idempotency_keys(expires_at, service_name, idempotency_key);
