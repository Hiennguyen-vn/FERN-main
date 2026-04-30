-- V59: DB hardening — statement timeouts per role + report role.
-- Goal: limit blast radius of slow queries; segregate reporting workload.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fern_report') THEN
    CREATE ROLE fern_report WITH LOGIN PASSWORD 'fern_report';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fern_report', current_database());
END
$$;

GRANT USAGE ON SCHEMA core TO fern_report;
GRANT SELECT ON ALL TABLES IN SCHEMA core TO fern_report;
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
