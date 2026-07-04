-- V83: Add sync_version to kitchen_ticket for deterministic idempotency.
--
-- Previously KITCHEN_TICKET_UPDATED events used System.currentTimeMillis() as
-- suffix, which produces different event IDs on network retries and breaks
-- central_inbox idempotency (ON CONFLICT (event_id) DO NOTHING).
--
-- With sync_version, each UPDATE in the same transaction increments the
-- counter atomically; the event ID becomes KITCHEN_TICKET_UPDATED:<id>:<sync_version>,
-- which is stable across retries for the same logical state change.

ALTER TABLE core.kitchen_ticket
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN core.kitchen_ticket.sync_version IS
  'Monotonic version counter incremented on every status change. Used as sync outbox event id suffix to guarantee idempotency on retry.';
