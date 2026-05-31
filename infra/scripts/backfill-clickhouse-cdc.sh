#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose.yml"

POSTGRES_HOST="${CLICKHOUSE_BACKFILL_POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${CLICKHOUSE_BACKFILL_POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-fern}"
POSTGRES_USER="${POSTGRES_USER:-fern}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-fern}"

run_clickhouse() {
  docker compose -f "${COMPOSE_FILE}" exec -T clickhouse clickhouse-client --multiquery
}

run_clickhouse_query() {
  docker compose -f "${COMPOSE_FILE}" exec -T clickhouse clickhouse-client --query "$1" </dev/null
}

cat <<EOF
Backfilling ClickHouse CDC from Postgres:
  source: ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
  targets: cdc.payment, cdc.inventory_transaction
EOF

run_clickhouse <<SQL
SET max_execution_time = 0;

ALTER TABLE cdc.payment
MODIFY COLUMN business_date Date MATERIALIZED
    toDate(
        if(
            toHour(ifNull(payment_time, created_at)) < 2,
            ifNull(payment_time, created_at) - INTERVAL 1 DAY,
            ifNull(payment_time, created_at)
        )
    );

TRUNCATE TABLE cdc.payment;
TRUNCATE TABLE cdc.inventory_transaction;

INSERT INTO cdc.payment
    (sale_id, outlet_id, payment_method, amount, state, payment_time, created_at, __op, __ts_ms, __lsn, __deleted)
SELECT
    sale_id,
    outlet_id,
    toString(payment_method),
    CAST(amount, 'Decimal(18, 2)'),
    toString(state),
    payment_time,
    ifNull(payment_time, ifNull(sale_created_at, created_at)) AS created_at,
    'r' AS __op,
    0 AS __ts_ms,
    CAST(NULL, 'Nullable(Int64)') AS __lsn,
    'false' AS __deleted
FROM postgresql('${POSTGRES_HOST}:${POSTGRES_PORT}', '${POSTGRES_DB}', 'payment', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}', 'core');

SELECT 'cdc.payment' AS dataset, min(business_date) AS min_date, max(business_date) AS max_date, count() AS rows
FROM cdc.payment
UNION ALL
SELECT 'cdc.inventory_transaction', min(business_date), max(business_date), count()
FROM cdc.inventory_transaction
UNION ALL
SELECT 'analytics.ai_payment_daily', min(business_date), max(business_date), count()
FROM analytics.ai_payment_daily
UNION ALL
SELECT 'analytics.ai_inventory_movement_daily', min(business_date), max(business_date), count()
FROM analytics.ai_inventory_movement_daily;
SQL

while IFS= read -r month_start; do
  [ -n "${month_start}" ] || continue
  echo "Backfilling cdc.inventory_transaction for ${month_start}"
  run_clickhouse_query "
    INSERT INTO cdc.inventory_transaction
        (id, outlet_id, item_id, qty_change, txn_type, txn_time, __op, __ts_ms, __lsn, __deleted)
    SELECT
        id,
        outlet_id,
        item_id,
        CAST(qty_change, 'Decimal(18, 4)'),
        toString(txn_type),
        txn_time,
        'r' AS __op,
        0 AS __ts_ms,
        CAST(NULL, 'Nullable(Int64)') AS __lsn,
        'false' AS __deleted
    FROM postgresql('${POSTGRES_HOST}:${POSTGRES_PORT}', '${POSTGRES_DB}', 'inventory_transaction', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}', 'core')
    WHERE business_date >= toDate('${month_start}')
      AND business_date < addMonths(toDate('${month_start}'), 1)
  "
done < <(
  run_clickhouse_query "
    SELECT DISTINCT toString(toStartOfMonth(business_date))
    FROM postgresql('${POSTGRES_HOST}:${POSTGRES_PORT}', '${POSTGRES_DB}', 'inventory_transaction', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}', 'core')
    ORDER BY 1
  "
)

run_clickhouse <<SQL
SELECT 'cdc.payment' AS dataset, min(business_date) AS min_date, max(business_date) AS max_date, count() AS rows
FROM cdc.payment
UNION ALL
SELECT 'cdc.inventory_transaction', min(business_date), max(business_date), count()
FROM cdc.inventory_transaction
UNION ALL
SELECT 'analytics.ai_payment_daily', min(business_date), max(business_date), count()
FROM analytics.ai_payment_daily;
SQL
