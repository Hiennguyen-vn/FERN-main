-- pg_partman auto-management for outbox_event and hot tables.
-- Tables are already partitioned (V19/V24/V25/V26); this registers them with partman
-- so future partitions are created automatically and old ones are dropped per retention.
-- p_premake=0 avoids creating partitions that would overlap existing ones.

-- ─── outbox_event ─────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.outbox_event',
  p_control        => 'created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
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
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
);

UPDATE partman.part_config SET
  retention                = '1825 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.sale_record';

-- ─── sale_item ────────────────────────────────────────────────────────────────

SELECT partman.create_parent(
  p_parent_table   => 'core.sale_item',
  p_control        => 'sale_created_at',
  p_type           => 'range',
  p_interval       => '1 month',
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
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
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
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
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
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
  p_premake        => 1,
  p_start_partition => '2027-01-01',
  p_default_table    => false
);

UPDATE partman.part_config SET
  retention                = '1095 days',
  retention_keep_table     = true,
  infinite_time_partitions = true,
  automatic_maintenance    = 'on'
WHERE parent_table = 'core.audit_log';
