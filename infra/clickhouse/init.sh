#!/bin/sh
# Run ClickHouse schema on startup
set -e

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-9000}"
SCHEMA_FILE="/docker-entrypoint-initdb.d/schema.sql"

echo "Waiting for ClickHouse at ${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}..."
until clickhouse-client --host="${CLICKHOUSE_HOST}" --port="${CLICKHOUSE_PORT}" --query="SELECT 1" >/dev/null 2>&1; do
  sleep 2
done

echo "ClickHouse ready. Applying schema..."
clickhouse-client --host="${CLICKHOUSE_HOST}" --port="${CLICKHOUSE_PORT}" --multiquery < "${SCHEMA_FILE}"
echo "Schema applied."

# Apply ordered migrations from /docker-entrypoint-initdb.d/migrations/V*.sql
MIGRATIONS_DIR="/docker-entrypoint-initdb.d/migrations"
if [ -d "${MIGRATIONS_DIR}" ]; then
  for migration in "${MIGRATIONS_DIR}"/V*.sql; do
    [ -f "${migration}" ] || continue
    echo "Applying migration: $(basename "${migration}")"
    clickhouse-client --host="${CLICKHOUSE_HOST}" --port="${CLICKHOUSE_PORT}" --multiquery < "${migration}"
  done
  echo "All migrations applied."
fi
