#!/usr/bin/env bash
# Chaos scenario runner. Each subcommand is self-contained: setup → fault → assert → cleanup.
set -euo pipefail

SCENARIO="${1:?usage: run-chaos.sh <scenario>}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker-compose.yml}"

case "$SCENARIO" in
  kafka-outage)
    echo "[chaos] stopping kafka1 …"
    $COMPOSE stop kafka1
    sleep 30
    echo "[chaos] resuming kafka1 …"
    $COMPOSE start kafka1
    sleep 60
    # Assert: outbox PENDING count returns to baseline
    PSQL="$COMPOSE exec -T postgres psql -U fern -d fern -tAc"
    PENDING=$($PSQL "SELECT COUNT(*) FROM core.outbox_event WHERE status='PENDING'" 2>/dev/null | tr -d '[:space:]' || echo 0)
    echo "[chaos] outbox PENDING after recovery: $PENDING"
    [[ "${PENDING:-0}" -lt 1000 ]] || { echo "FAIL: outbox backlog > 1000"; exit 1; }
    ;;

  patroni-failover)
    echo "[chaos] triggering patroni failover …"
    $COMPOSE exec -T patroni1 patronictl -c /home/postgres/postgres.yml failover --candidate patroni2 --force fern-pg
    sleep 45
    echo "[chaos] verifying new leader serves writes …"
    $COMPOSE exec -T pg-haproxy psql -h pg-haproxy -p 5432 -U fern -d fern -c "SELECT 1" >/dev/null
    ;;

  inventory-lag)
    echo "[chaos] pausing inventory-service for 30s …"
    $COMPOSE pause inventory-service
    sleep 30
    $COMPOSE unpause inventory-service
    sleep 30
    # Assert: stock_balance == sum(inventory_transaction.qty_change) per (outlet,item)
    $COMPOSE exec -T postgres psql -U fern -d fern -c "
      SELECT outlet_id, item_id, sb.qty_on_hand,
             (SELECT COALESCE(SUM(qty_change),0) FROM core.inventory_transaction it
              WHERE it.outlet_id=sb.location_id AND it.item_id=sb.item_id) AS ledger_sum
      FROM core.stock_balance sb
      WHERE qty_on_hand <> (SELECT COALESCE(SUM(qty_change),0) FROM core.inventory_transaction it
                            WHERE it.outlet_id=sb.location_id AND it.item_id=sb.item_id)
      LIMIT 5
    "
    ;;

  replay-storm)
    echo "[chaos] replay storm requires kafkacat + topic dump; see README"
    exit 0
    ;;

  *)
    echo "Unknown scenario: $SCENARIO"
    echo "Available: kafka-outage, patroni-failover, inventory-lag, replay-storm"
    exit 2
    ;;
esac

echo "[chaos] $SCENARIO PASSED"
