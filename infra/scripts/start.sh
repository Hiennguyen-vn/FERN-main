#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/common.sh"

load_infra_env
load_manifest
ensure_runtime_dirs
require_cmd docker

print_banner "FERN Infrastructure - Starting dependencies"

compose up -d "${FERN_DEPENDENCY_SERVICES[@]}"

echo ""
echo "Waiting for dependency health..."
for service in "${FERN_DEPENDENCY_SERVICES[@]}"; do
  printf '  %-18s ' "$service"
  if wait_for_compose_health "$service" 120; then
    echo -e "${GREEN}healthy${RESET}"
  else
    echo -e "${RED}timeout${RESET}"
    exit 1
  fi
done

echo ""
echo "Ensuring Kafka topics exist..."
bash "${INFRA_DIR}/kafka/init-topics.sh"

echo ""
echo "Checking PostgreSQL replication..."
bash "${SCRIPT_DIR}/ensure-postgres-replication.sh" --wait 60 --repair

echo ""
echo "Dependencies ready:"
echo "  PostgreSQL primary : localhost:${POSTGRES_PORT:-5432}"
echo "  PostgreSQL replica : localhost:${POSTGRES_REPLICA_PORT:-5433}"
echo "  Redis              : localhost:${REDIS_PORT:-6379}"
echo "  Kafka              : localhost:${KAFKA_PORT:-9092}"
echo "  Prometheus         : http://localhost:${PROMETHEUS_PORT:-9090}"
echo "  Grafana            : http://localhost:${GRAFANA_PORT:-3000}"
