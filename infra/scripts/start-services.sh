#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

DEV_MODE=false
SKIP_BUILD=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/start-services.sh [--dev] [--skip-build]

Options:
  --dev        Explicitly enable dev-only startup behavior and forward --dev to every local service.
  --skip-build Skip the Maven package step and use the current runnable jars.
  -h, --help   Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      DEV_MODE=true
      shift
      ;;
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
load_service_env
load_test_env
load_manifest
ensure_runtime_dirs
require_cmd mvn
require_cmd java

print_banner "FERN Services - Ensuring dependencies are running"
if [[ "${FERN_SKIP_DEPENDENCY_START:-false}" == "true" ]]; then
  echo "Skipping dependency startup because FERN_SKIP_DEPENDENCY_START=true."
else
  bash "${SCRIPT_DIR}/start.sh"
fi

if ! $SKIP_BUILD; then
  echo ""
  print_banner "FERN Services - Building runnable jars"
  (
    cd "$ROOT_DIR"
    MODULE_LIST="$(IFS=,; printf '%s' "${FERN_MAVEN_BUILD_MODULES[*]}")"
    mvn -pl "$MODULE_LIST" -am -DskipTests package
  )
fi

echo ""
print_banner "FERN Services - Starting local services"

JAVA_ARGS=()
internal_token_mode="strict"
if $DEV_MODE; then
  JAVA_ARGS+=(--dev)
  internal_token_mode="dev"
  echo "Running in explicit dev mode. The --dev flag will be forwarded to every local service."
else
  echo "Running in strict mode. No dev-only runtime shortcuts will be enabled."
fi

resolved_internal_token="$(resolved_internal_service_token "$internal_token_mode")"

for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
  name="$(record_field "$record" 0)"
  env_name="$(record_field "$record" 3)"
  default_port="$(record_field "$record" 4)"
  port="${!env_name:-$default_port}"

  if service_is_running "$name"; then
    echo "  - ${name} is already running"
    continue
  fi

  if port_in_use "$port"; then
    fail "Port ${port} is already in use. Stop the conflicting process before starting ${name}."
    exit 1
  fi

  jar_path="$(service_jar_path "$name" || true)"
  if [[ -z "$jar_path" ]]; then
    fail "Jar not found for ${name}. Expected pattern: $(record_field "$record" 2)"
    exit 1
  fi

  pid_file="$(service_pid_file "$name")"
  log_file="$(service_log_file "$name")"

  echo "  - starting ${name} on port ${port}"
  if [[ "$name" == "gateway" ]]; then
    if $DEV_MODE; then
      nohup env \
        PORT="$port" \
        REDIS_HOST="${REDIS_HOST}" \
        REDIS_PORT="${REDIS_PORT}" \
        KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP}" \
        MASTER_NODE_URL="${MASTER_NODE_URL}" \
        AUTH_SERVICE_URL="${AUTH_SERVICE_URL}" \
        ORG_SERVICE_URL="${ORG_SERVICE_URL}" \
        HR_SERVICE_URL="${HR_SERVICE_URL}" \
        PRODUCT_SERVICE_URL="${PRODUCT_SERVICE_URL}" \
        PROCUREMENT_SERVICE_URL="${PROCUREMENT_SERVICE_URL}" \
        SALES_SERVICE_URL="${SALES_SERVICE_URL}" \
        INVENTORY_SERVICE_URL="${INVENTORY_SERVICE_URL}" \
        PAYROLL_SERVICE_URL="${PAYROLL_SERVICE_URL}" \
        FINANCE_SERVICE_URL="${FINANCE_SERVICE_URL}" \
        AUDIT_SERVICE_URL="${AUDIT_SERVICE_URL}" \
        REPORT_SERVICE_URL="${REPORT_SERVICE_URL}" \
        INTERNAL_SERVICE_TOKEN="${resolved_internal_token}" \
        INTERNAL_SERVICE_ALLOWLIST="${INTERNAL_SERVICE_ALLOWLIST:-}" \
        JWT_SECRET="${JWT_SECRET:-}" \
        JAVA_OPTS="${JAVA_OPTS:-}" \
        java ${JAVA_OPTS:-} -jar "$jar_path" --dev \
        >"$log_file" 2>&1 < /dev/null &
    else
      nohup env \
        PORT="$port" \
        REDIS_HOST="${REDIS_HOST}" \
        REDIS_PORT="${REDIS_PORT}" \
        KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP}" \
        MASTER_NODE_URL="${MASTER_NODE_URL}" \
        AUTH_SERVICE_URL="${AUTH_SERVICE_URL}" \
        ORG_SERVICE_URL="${ORG_SERVICE_URL}" \
        HR_SERVICE_URL="${HR_SERVICE_URL}" \
        PRODUCT_SERVICE_URL="${PRODUCT_SERVICE_URL}" \
        PROCUREMENT_SERVICE_URL="${PROCUREMENT_SERVICE_URL}" \
        SALES_SERVICE_URL="${SALES_SERVICE_URL}" \
        INVENTORY_SERVICE_URL="${INVENTORY_SERVICE_URL}" \
        PAYROLL_SERVICE_URL="${PAYROLL_SERVICE_URL}" \
        FINANCE_SERVICE_URL="${FINANCE_SERVICE_URL}" \
        AUDIT_SERVICE_URL="${AUDIT_SERVICE_URL}" \
        REPORT_SERVICE_URL="${REPORT_SERVICE_URL}" \
        INTERNAL_SERVICE_TOKEN="${resolved_internal_token}" \
        INTERNAL_SERVICE_ALLOWLIST="${INTERNAL_SERVICE_ALLOWLIST:-}" \
        JWT_SECRET="${JWT_SECRET:-}" \
        JAVA_OPTS="${JAVA_OPTS:-}" \
        java ${JAVA_OPTS:-} -jar "$jar_path" \
        >"$log_file" 2>&1 < /dev/null &
    fi
  else
    if $DEV_MODE; then
      nohup env \
        SERVER_PORT="$port" \
        DB_URL="${DB_URL}" \
        DB_REPLICA_URL="${DB_REPLICA_URL}" \
        POSTGRES_USER="${POSTGRES_USER}" \
        POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
        DB_POOL_SIZE="${DB_POOL_SIZE}" \
        REDIS_HOST="${REDIS_HOST}" \
        REDIS_PORT="${REDIS_PORT}" \
        REDIS_POOL_SIZE="${REDIS_POOL_SIZE}" \
        KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP}" \
        MASTER_NODE_URL="${MASTER_NODE_URL}" \
        INTERNAL_SERVICE_TOKEN="${resolved_internal_token}" \
        INTERNAL_SERVICE_ALLOWLIST="${INTERNAL_SERVICE_ALLOWLIST:-}" \
        JWT_SECRET="${JWT_SECRET:-}" \
        CONTROL_HEARTBEAT_LEASE_SECONDS="${CONTROL_HEARTBEAT_LEASE_SECONDS:-30}" \
        CONTROL_HEARTBEAT_INTERVAL_SECONDS="${CONTROL_HEARTBEAT_INTERVAL_SECONDS:-10}" \
        JAVA_OPTS="${JAVA_OPTS:-}" \
        java ${JAVA_OPTS:-} -jar "$jar_path" --dev \
        >"$log_file" 2>&1 < /dev/null &
    else
      nohup env \
        SERVER_PORT="$port" \
        DB_URL="${DB_URL}" \
        DB_REPLICA_URL="${DB_REPLICA_URL}" \
        POSTGRES_USER="${POSTGRES_USER}" \
        POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
        DB_POOL_SIZE="${DB_POOL_SIZE}" \
        REDIS_HOST="${REDIS_HOST}" \
        REDIS_PORT="${REDIS_PORT}" \
        REDIS_POOL_SIZE="${REDIS_POOL_SIZE}" \
        KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP}" \
        MASTER_NODE_URL="${MASTER_NODE_URL}" \
        INTERNAL_SERVICE_TOKEN="${resolved_internal_token}" \
        INTERNAL_SERVICE_ALLOWLIST="${INTERNAL_SERVICE_ALLOWLIST:-}" \
        JWT_SECRET="${JWT_SECRET:-}" \
        CONTROL_HEARTBEAT_LEASE_SECONDS="${CONTROL_HEARTBEAT_LEASE_SECONDS:-30}" \
        CONTROL_HEARTBEAT_INTERVAL_SECONDS="${CONTROL_HEARTBEAT_INTERVAL_SECONDS:-10}" \
        JAVA_OPTS="${JAVA_OPTS:-}" \
        java ${JAVA_OPTS:-} -jar "$jar_path" \
        >"$log_file" 2>&1 < /dev/null &
    fi
  fi

  pid=$!
  echo "$pid" > "$pid_file"
done

echo ""
health_timeout="${TEST_WAIT_SECONDS:-90}"
bash "${SCRIPT_DIR}/health-check.sh" --wait "$health_timeout"

service_failures=0
for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
  name="$(record_field "$record" 0)"
  if ! service_is_running "$name"; then
    fail "${name} did not stay running after startup. Check $(service_log_file "$name")."
    service_failures=$((service_failures + 1))
    continue
  fi

  health_url="$(service_health_url "$name")"
  if ! wait_for_http_ok "$health_url" "$health_timeout"; then
    fail "${name} did not report healthy on ${health_url}. Check $(service_log_file "$name")."
    service_failures=$((service_failures + 1))
  fi
done

if (( service_failures > 0 )); then
  exit 1
fi

echo ""
echo "Logs are written to ${INFRA_LOG_DIR}"
echo "PIDs are written to ${INFRA_PID_DIR}"
