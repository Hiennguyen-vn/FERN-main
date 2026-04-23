-- dba-setup.sql
-- Run as superuser before applying V23__pg_partman_setup.sql
-- ────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Verify
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_partman', 'pg_stat_statements');

-- ── Logical replication (required for Debezium CDC) ───────────────────────────
ALTER SYSTEM SET wal_level = 'logical';
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;
SELECT pg_reload_conf();

-- ── Create replication slot for Debezium ─────────────────────────────────────
SELECT pg_create_logical_replication_slot('debezium_slot', 'pgoutput')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_replication_slots WHERE slot_name = 'debezium_slot'
);
