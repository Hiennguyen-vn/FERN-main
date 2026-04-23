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
echo "Schema applied successfully."
