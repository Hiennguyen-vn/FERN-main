-- pg_partman auto-management for outbox_event and hot tables.
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
-- Run by DBA/infra before applying this migration.
--
-- This migration registers the already-created partitioned tables with pg_partman
-- so future partitions are created automatically and old ones are dropped per retention.

-- ─── outbox_event ─────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.outbox_event',
  p_control        => 'created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '90 days',
  retention_keep_table     = false,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.outbox_event';

-- ─── sale_record ──────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.sale_record',
  p_control        => 'created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '1825 days',  -- 5 years per retention policy
  retention_keep_table     = true,         -- keep table after detach (archive to S3 manually)
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.sale_record';

-- ─── sale_item ────────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.sale_item',
  p_control        => 'sale_created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '1825 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.sale_item';

-- ─── payment ──────────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.payment',
  p_control        => 'sale_created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '1825 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.payment';

-- ─── inventory_transaction ────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.inventory_transaction',
  p_control        => 'txn_time',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '1825 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.inventory_transaction';

-- ─── audit_log ───────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.audit_log',
  p_control        => 'created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 12,
  p_start_partition => date_trunc('month', NOW())::text
);

UPDATE partman.part_config SET
  retention                = '1095 days',  -- 3 years hot, then S3 archive
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.audit_log';
