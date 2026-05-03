-- V59: DB hardening — statement timeouts per role + report role.
-- Goal: limit blast radius of slow queries; segregate reporting workload.
--
-- SECURITY NOTE: fern_report is created WITHOUT a password.
-- The password MUST be set by IaC / Vault after this migration runs:
--   vault write database/roles/fern_report ...
-- or via your DBA bootstrap script:
--   ALTER ROLE fern_report PASSWORD '<vault-generated-secret>';
-- Never commit credentials in migration files.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fern_report') THEN
    -- No PASSWORD clause — credential management delegated to IaC / Vault bootstrap.
    CREATE ROLE fern_report WITH LOGIN NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fern_report', current_database());
END
$$;

GRANT USAGE ON SCHEMA core TO fern_report;

-- Grant read access only to reporting-safe views and summary tables.
-- Do NOT grant SELECT ON ALL TABLES — core schema contains PII (customer,
-- payment_method, session, staff_pin) that the reporting role must not access.
-- Add specific grants below as reporting views/materialized views are created.
GRANT SELECT ON core.sale_record         TO fern_report;
GRANT SELECT ON core.sale_item           TO fern_report;
GRANT SELECT ON core.product             TO fern_report;
GRANT SELECT ON core.outlet              TO fern_report;
GRANT SELECT ON core.inventory_transaction TO fern_report;
GRANT SELECT ON core.stock_balance       TO fern_report;
GRANT SELECT ON core.payment             TO fern_report;
GRANT SELECT ON core.outbox_event        TO fern_report;

-- Ensure future reporting views added to core schema are also accessible.
-- (Only for objects created by fern_app; DBA must re-run for objects created by superuser.)
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO fern_report;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fern_app') THEN
    EXECUTE 'ALTER ROLE fern_app SET statement_timeout = ''30s''';
    EXECUTE 'ALTER ROLE fern_app SET idle_in_transaction_session_timeout = ''60s''';
    EXECUTE 'ALTER ROLE fern_app SET lock_timeout = ''5s''';
  END IF;
  EXECUTE 'ALTER ROLE fern_report SET statement_timeout = ''120s''';
  EXECUTE 'ALTER ROLE fern_report SET idle_in_transaction_session_timeout = ''30s''';
END
$$;
