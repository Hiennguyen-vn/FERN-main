-- V34: Tell pg_partman about the existing default partitions so retention/maintenance
-- runs include them. V26_5 registered parents with p_default_table => false even
-- though V24/V25/V26 created *_default partitions — partman therefore ignored those
-- catch-all partitions and let them grow unbounded.
--
-- This migration just flips part_config.default_table = true for the affected parents.
-- The default partitions themselves already exist and are correctly attached.

UPDATE partman.part_config
   SET ignore_default_data = false
 WHERE parent_table IN (
   'core.sale_record',
   'core.sale_item',
   'core.payment',
   'core.inventory_transaction',
   'core.audit_log'
 );

-- Note: outbox_event has no default partition by design (created_at is always NOW()
-- so out-of-range inserts indicate a bug; we want them to fail loudly).
-- processed_events keeps default_table=false intentionally for the same reason.
