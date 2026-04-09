#!/usr/bin/env bash

COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$COMMON_SCRIPT_DIR")"
ROOT_DIR="$(dirname "$INFRA_DIR")"
INFRA_ENV_FILE="${INFRA_DIR}/.env"
SERVICE_ENV_DEFAULTS_FILE="${INFRA_DIR}/env/services.env.example"
SERVICE_ENV_FILE="${INFRA_DIR}/env/services.env"
TEST_ENV_DEFAULTS_FILE="${INFRA_DIR}/env/tests.env.example"
TEST_ENV_FILE="${INFRA_DIR}/env/tests.env"
INFRA_LOG_DIR="${INFRA_DIR}/logs"
INFRA_PID_DIR="${INFRA_DIR}/pids"
SERVICE_MANIFEST_FILE="${INFRA_DIR}/config/services.manifest.sh"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

print_banner() {
  local message="$1"
  echo -e "${BOLD}${CYAN}${message}${RESET}"
}

fail() {
  echo -e "${RED}$*${RESET}" >&2
  return 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

require_docker_daemon() {
  require_cmd docker
  docker_available || fail "Docker daemon is not available"
}

print_service_log_tail() {
  local name="$1"
  local lines="${2:-25}"
  local log_file
  log_file="$(service_log_file "$name")"
  echo "--- ${name} log tail (${lines}) ---"
  if [[ -f "$log_file" ]]; then
    tail -n "$lines" "$log_file" || true
  else
    echo "(log file not found: ${log_file})"
  fi
  echo "-----------------------------------"
}

api_service_name_for_path() {
  local path="$1"
  case "$path" in
    /api/v1/gateway/*|/health/*)
      printf 'gateway'
      ;;
    /api/v1/auth/*)
      printf 'auth-service'
      ;;
    /api/v1/master/*|/api/v1/control/*)
      printf 'master-node'
      ;;
    /api/v1/org/*)
      printf 'org-service'
      ;;
    /api/v1/hr/*)
      printf 'hr-service'
      ;;
    /api/v1/product/*|/api/v1/products/*)
      printf 'product-service'
      ;;
    /api/v1/procurement/*)
      printf 'procurement-service'
      ;;
    /api/v1/sales/*)
      printf 'sales-service'
      ;;
    /api/v1/crm/*)
      printf 'sales-service'
      ;;
    /api/v1/inventory/*)
      printf 'inventory-service'
      ;;
    /api/v1/payroll/*)
      printf 'payroll-service'
      ;;
    /api/v1/finance/*)
      printf 'finance-service'
      ;;
    /api/v1/audit/*)
      printf 'audit-service'
      ;;
    /api/v1/report/*|/api/v1/reports/*)
      printf 'report-service'
      ;;
    *)
      return 1
      ;;
  esac
}

print_http_failure_context() {
  local url="$1"
  local through_gateway="${2:-false}"
  local path="${url#*://}"
  path="/${path#*/}"
  local -a services=()
  if [[ "$through_gateway" == "true" ]]; then
    services+=(gateway)
  fi
  local target_service
  target_service="$(api_service_name_for_path "$path" || true)"
  if [[ -n "$target_service" ]]; then
    local service
    for service in "${services[@]}"; do
      if [[ "$service" == "$target_service" ]]; then
        target_service=""
        break
      fi
    done
  fi
  if [[ -n "$target_service" ]]; then
    services+=("$target_service")
  fi
  local service
  for service in "${services[@]}"; do
    print_service_log_tail "$service" 25
  done
}

base64url_encode() {
  if [[ $# -gt 0 ]]; then
    printf '%s' "$1" | openssl base64 -A | tr '+/' '-_' | tr -d '='
  else
    openssl base64 -A | tr '+/' '-_' | tr -d '='
  fi
}

jwt_sign_hs256() {
  local content="$1"
  local secret="$2"
  printf '%s' "$content" \
    | openssl dgst -binary -sha256 -hmac "$secret" \
    | openssl base64 -A \
    | tr '+/' '-_' \
    | tr -d '='
}

issue_local_jwt() {
  local user_id="${1:?user_id is required}"
  local username="${2:-fern-dev-user}"
  local session_id="${3:-fern-dev-session}"
  local roles_csv="${4:-admin}"
  local permissions_csv="${5:-*}"
  local outlet_ids_csv="${6:-}"
  local ttl_seconds="${7:-3600}"
  local secret="${JWT_SECRET:-}"
  if [[ -z "$secret" ]]; then
    fail "JWT_SECRET must be configured before issuing local JWTs"
    return 1
  fi
  local now
  now="$(date +%s)"
  local exp=$((now + ttl_seconds))
  local header
  local payload
  local encoded_header
  local encoded_payload
  local signed_content
  local signature

  header="$(jq -cn '{alg:"HS256",typ:"JWT"}')"
  payload="$(jq -cn \
    --arg sub "${user_id}" \
    --argjson uid "${user_id}" \
    --arg username "${username}" \
    --arg sid "${session_id}" \
    --arg rolesCsv "${roles_csv}" \
    --arg permissionsCsv "${permissions_csv}" \
    --arg outletIdsCsv "${outlet_ids_csv}" \
    --argjson iat "${now}" \
    --argjson exp "${exp}" \
    '{
      sub: $sub,
      uid: $uid,
      username: $username,
      sid: $sid,
      roles: ($rolesCsv | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0))),
      permissions: ($permissionsCsv | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0))),
      outletIds: ($outletIdsCsv | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length > 0)) | map(tonumber? // empty)),
      iat: $iat,
      exp: $exp
    }')"

  encoded_header="$(base64url_encode "$header")"
  encoded_payload="$(base64url_encode "$payload")"
  signed_content="${encoded_header}.${encoded_payload}"
  signature="$(jwt_sign_hs256 "$signed_content" "$secret")"
  printf '%s.%s' "$signed_content" "$signature"
}

ensure_infra_env() {
  if [[ ! -f "$INFRA_ENV_FILE" ]]; then
    local internal_token
    local jwt_secret
    internal_token="$(generate_hex_secret)"
    jwt_secret="$(generate_hex_secret)"
    sed \
      -e "s/__GENERATE_INTERNAL_SERVICE_TOKEN__/${internal_token}/" \
      -e "s/__GENERATE_JWT_SECRET__/${jwt_secret}/" \
      "${INFRA_DIR}/.env.example" > "$INFRA_ENV_FILE"
  fi
}

source_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
  fi
}

load_infra_env() {
  ensure_infra_env
  source_env_file "$INFRA_ENV_FILE"
}

load_service_env() {
  source_env_file "$SERVICE_ENV_DEFAULTS_FILE"
  source_env_file "$SERVICE_ENV_FILE"
}

load_test_env() {
  source_env_file "$TEST_ENV_DEFAULTS_FILE"
  source_env_file "$TEST_ENV_FILE"
}

ensure_runtime_dirs() {
  mkdir -p "$INFRA_LOG_DIR" "$INFRA_PID_DIR"
}

timestamp_utc() {
  date -u +"%Y%m%dT%H%M%SZ"
}

ensure_dir() {
  mkdir -p "$1"
}

compose() {
  (
    cd "$INFRA_DIR"
    docker compose --env-file "$INFRA_ENV_FILE" "$@"
  )
}

db_host_for_target() {
  case "${1:-primary}" in
    primary)
      printf 'postgres'
      ;;
    replica)
      printf 'postgres-replica'
      ;;
    *)
      fail "Unknown database target: $1"
      ;;
  esac
}

db_tools_psql() {
  local target="${1:-primary}"
  shift || true
  local host
  host="$(db_host_for_target "$target")" || return 1
  compose run --rm -T \
    -e PGHOST="$host" \
    -e PGPORT=5432 \
    -e PGDATABASE="${POSTGRES_DB:-fern}" \
    -e PGUSER="${POSTGRES_USER:-fern}" \
    -e PGPASSWORD="${POSTGRES_PASSWORD:-fern}" \
    db-tools psql "$@"
}

db_query_scalar() {
  local target="${1:-primary}"
  local sql="${2:?sql is required}"
  db_tools_psql "$target" -Atqc "$sql"
}

wait_for_db_query() {
  local target="${1:?target is required}"
  local sql="${2:?sql is required}"
  local timeout="${3:-30}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if db_tools_psql "$target" -Atqc "$sql" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_pg_stat_statements_ready() {
  if ! wait_for_compose_health postgres 1 >/dev/null 2>&1 \
      || ! wait_for_compose_health postgres-replica 1 >/dev/null 2>&1; then
    echo "Starting postgres/postgres-replica because pg_stat_statements capture requires them..."
    compose up -d postgres postgres-replica >/dev/null
  fi
  wait_for_compose_health postgres 120 >/dev/null
  wait_for_compose_health postgres-replica 120 >/dev/null

  local primary_libraries
  local replica_libraries
  primary_libraries="$(db_query_scalar primary "SHOW shared_preload_libraries;" 2>/dev/null | tr -d '[:space:]' || true)"
  replica_libraries="$(db_query_scalar replica "SHOW shared_preload_libraries;" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$primary_libraries" != *pg_stat_statements* || "$replica_libraries" != *pg_stat_statements* ]]; then
    echo "Restarting postgres/postgres-replica because pg_stat_statements is not preloaded yet..."
    compose restart postgres postgres-replica >/dev/null
    wait_for_compose_health postgres 120 >/dev/null
    wait_for_compose_health postgres-replica 120 >/dev/null
  fi

  db_tools_psql primary -v ON_ERROR_STOP=1 -qc "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" >/dev/null
  wait_for_db_query primary "SELECT 1 FROM pg_stat_statements LIMIT 1;" 20 || fail "pg_stat_statements is not ready on primary"
  wait_for_db_query replica "SELECT 1 FROM pg_stat_statements LIMIT 1;" 20 || fail "pg_stat_statements is not ready on replica"
}

load_manifest() {
  # shellcheck disable=SC1090
  . "$SERVICE_MANIFEST_FILE"
}

manifest_record() {
  local target="$1"
  local record
  for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
    if [[ "${record%%|*}" == "$target" ]]; then
      printf '%s\n' "$record"
      return 0
    fi
  done
  return 1
}

record_field() {
  local record="$1"
  local index="$2"
  local part
  local i=0
  local old_ifs="$IFS"
  IFS='|'
  for part in $record; do
    if [[ "$i" -eq "$index" ]]; then
      IFS="$old_ifs"
      printf '%s' "$part"
      return 0
    fi
    i=$((i + 1))
  done
  IFS="$old_ifs"
  return 1
}

service_port() {
  local record
  record="$(manifest_record "$1")" || return 1
  local env_name
  env_name="$(record_field "$record" 3)"
  local default_port
  default_port="$(record_field "$record" 4)"
  local value="${!env_name:-$default_port}"
  printf '%s' "$value"
}

service_kind() {
  local record
  record="$(manifest_record "$1")" || return 1
  record_field "$record" 5
}

service_url() {
  printf 'http://127.0.0.1:%s' "$(service_port "$1")"
}

service_health_path() {
  case "$(service_kind "$1")" in
    spring)
      printf '/actuator/health'
      ;;
    gateway|javalin)
      printf '/health/live'
      ;;
    *)
      printf '/health'
      ;;
  esac
}

service_health_url() {
  printf '%s%s' "$(service_url "$1")" "$(service_health_path "$1")"
}

service_pid_file() {
  printf '%s/%s.pid' "$INFRA_PID_DIR" "$1"
}

service_log_file() {
  printf '%s/%s.log' "$INFRA_LOG_DIR" "$1"
}

service_jar_path() {
  local record
  record="$(manifest_record "$1")" || return 1
  local pattern
  pattern="$(record_field "$record" 2)"
  local -a matches=()
  while IFS= read -r match; do
    matches+=("$match")
  done < <(compgen -G "${ROOT_DIR}/${pattern}" || true)
  if [[ "${#matches[@]}" -eq 0 ]]; then
    return 1
  fi
  printf '%s\n' "${matches[0]}"
}

service_process_pattern() {
  local record
  record="$(manifest_record "$1")" || return 1
  local pattern
  pattern="$(record_field "$record" 2)"
  printf '%s' "${ROOT_DIR}/${pattern%%\*}"
}

service_matching_pids() {
  local pattern
  pattern="$(service_process_pattern "$1")" || return 1
  pgrep -f -- "$pattern" 2>/dev/null || true
}

service_detect_pid() {
  local pid
  pid="$(read_pid "$1")"
  if pid_is_running "$pid"; then
    printf '%s' "$pid"
    return 0
  fi
  local matched
  matched="$(service_matching_pids "$1" | head -n 1)"
  if [[ -n "$matched" ]]; then
    printf '%s' "$matched"
    return 0
  fi
  return 1
}

read_pid() {
  local pid_file
  pid_file="$(service_pid_file "$1")"
  if [[ -f "$pid_file" ]]; then
    tr -d ' \t\r\n' < "$pid_file"
  fi
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

service_is_running() {
  local pid
  pid="$(service_detect_pid "$1" || true)"
  pid_is_running "$pid"
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 "$1" 2>/dev/null || true
}

wait_for_http_ok() {
  local url="$1"
  local timeout="$2"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if [[ "$(http_code "$url")" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_compose_health() {
  local service="$1"
  local timeout="$2"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    local container_id
    container_id="$(compose ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      local status
      status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == "healthy" || "$status" == "running" ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" | awk 'NR > 1 { found=1 } END { exit !found }'
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -E "[\.:]${port}[[:space:]].*LISTEN" >/dev/null 2>&1
    return $?
  fi
  fail "Missing dependency for port checks: install lsof, ss, or netstat"
  return 1
}

resolved_internal_service_token() {
  local mode="${1:?mode is required}"
  if [[ -n "${INTERNAL_SERVICE_TOKEN:-}" ]]; then
    printf '%s' "$INTERNAL_SERVICE_TOKEN"
    return 0
  fi
  case "$mode" in
    dev)
      if [[ -n "${DEV_INTERNAL_SERVICE_TOKEN:-}" ]]; then
        printf '%s' "$DEV_INTERNAL_SERVICE_TOKEN"
        return 0
      fi
      ;;
    strict)
      if [[ -n "${STRICT_INTERNAL_SERVICE_TOKEN:-}" ]]; then
        printf '%s' "$STRICT_INTERNAL_SERVICE_TOKEN"
        return 0
      fi
      ;;
    *)
      fail "Unknown internal token mode: ${mode}"
      return 1
      ;;
  esac
  fail "INTERNAL_SERVICE_TOKEN must be configured before starting services"
  return 1
}

generate_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

service_command_has_dev_flag() {
  local name="$1"
  local pid
  pid="$(service_detect_pid "$name" || true)"
  if ! pid_is_running "$pid"; then
    return 1
  fi
  ps -o command= -p "$pid" 2>/dev/null | grep -q -- ' --dev'
}

terminate_service() {
  local name="$1"
  local pid_file
  pid_file="$(service_pid_file "$name")"
  local pids
  pids="$(service_matching_pids "$name" || true)"
  local tracked_pid
  tracked_pid="$(read_pid "$name")"
  if pid_is_running "$tracked_pid" && ! grep -qx "$tracked_pid" <<<"$pids"; then
    pids="${pids}"$'\n'"${tracked_pid}"
  fi
  if [[ -n "${pids//[$'\t\r\n ']}" ]]; then
    local pid
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      kill "$pid" 2>/dev/null || true
    done <<<"$pids"
    local deadline=$((SECONDS + 15))
    while (( SECONDS < deadline )); do
      local any_running=false
      while IFS= read -r pid; do
        [[ -n "$pid" ]] || continue
        if pid_is_running "$pid"; then
          any_running=true
          break
        fi
      done <<<"$pids"
      $any_running || break
      sleep 1
    done
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      if pid_is_running "$pid"; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done <<<"$pids"
  fi
  rm -f "$pid_file"
}
