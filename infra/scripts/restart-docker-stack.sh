#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SKIP_BUILD=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/restart-docker-stack.sh [--skip-build]

Rebuild and restart the full FERN Docker stack:
  dependencies (postgres, redis, kafka) + AI/search + all backend services.

Options:
  --skip-build  Skip docker compose build; only recreate/restart containers.
  -h, --help    Show this help text.

Requires infra/.env (COMPOSE_PROFILES=ai,search recommended for AI stack).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/common.sh"

load_infra_env
load_manifest
ensure_runtime_dirs
require_docker_daemon

# Avoid port conflicts if local jars are still running from an older workflow.
bash "${SCRIPT_DIR}/stop-services.sh" >/dev/null 2>&1 || true

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-ai,search}"

FERN_DOCKER_BUILD_SERVICES=(
  master-node
  gateway
  auth-service
  org-service
  hr-service
  product-service
  procurement-service
  sales-service
  inventory-service
  payroll-service
  finance-service
  audit-service
  report-service
  opensearch
  aia-gent
)

FERN_DOCKER_BACKEND_SERVICES=(
  master-node
  gateway
  gateway-lb
  auth-service
  org-service
  hr-service
  product-service
  procurement-service
  sales-service
  inventory-service
  payroll-service
  finance-service
  audit-service
  report-service
)

FERN_DOCKER_AI_SERVICES=(
  clickhouse
  opensearch
  aia-gent
)

FERN_DOCKER_HA_OBSERVABILITY_STOP=(
  kafka-2
  kafka-3
  redis-replica-1
  redis-replica-2
  redis-sentinel-1
  redis-sentinel-2
  redis-sentinel-3
  prometheus
  grafana
)

wait_for_stack_health() {
  local timeout="$1"
  shift
  local -a services=("$@")
  local service
  for service in "${services[@]}"; do
    printf '  %-22s ' "$service"
    if wait_for_compose_health "$service" "$timeout"; then
      echo -e "${GREEN}healthy${RESET}"
    else
      echo -e "${RED}timeout${RESET}"
      return 1
    fi
  done
}

print_banner "FERN Docker Stack — Rebuild & Restart"

echo "Stopping HA brokers and observability (save RAM)..."
compose stop "${FERN_DOCKER_HA_OBSERVABILITY_STOP[@]}" >/dev/null 2>&1 || true

if ! $SKIP_BUILD; then
  echo ""
  echo "Building Docker images..."
  compose --profile ai --profile search build "${FERN_DOCKER_BUILD_SERVICES[@]}"
else
  echo ""
  echo "Skipping image build (--skip-build)."
fi

echo ""
echo "Starting dependencies..."
bash "${SCRIPT_DIR}/start.sh"

echo ""
echo "Starting AI/search stack..."
compose --profile ai --profile search up -d --force-recreate "${FERN_DOCKER_AI_SERVICES[@]}"

echo ""
echo "Waiting for AI/search health..."
wait_for_stack_health 300 clickhouse opensearch aia-gent

echo ""
echo "Starting backend services..."
compose up -d --force-recreate "${FERN_DOCKER_BACKEND_SERVICES[@]}"

echo ""
echo "Waiting for core backend health..."
wait_for_stack_health 240 master-node gateway

echo ""
echo "Stack status:"
compose ps

gateway_port="${GATEWAY_PORT:-8080}"
ai_port="${AI_QUERY_SERVICE_PORT:-8093}"

echo ""
if curl -sf "http://127.0.0.1:${gateway_port}/health/live" >/dev/null; then
  echo -e "  Gateway health       ${GREEN}OK${RESET}  http://127.0.0.1:${gateway_port}/health/live"
else
  echo -e "  Gateway health       ${RED}FAIL${RESET} http://127.0.0.1:${gateway_port}/health/live"
fi

if curl -sf "http://127.0.0.1:${ai_port}/api/v1/ai-query/health" >/dev/null; then
  echo -e "  AIA-gent health      ${GREEN}OK${RESET}  http://127.0.0.1:${ai_port}/api/v1/ai-query/health"
else
  echo -e "  AIA-gent health      ${RED}FAIL${RESET} http://127.0.0.1:${ai_port}/api/v1/ai-query/health"
fi

echo ""
echo "Done. Full rebuild + restart complete."
