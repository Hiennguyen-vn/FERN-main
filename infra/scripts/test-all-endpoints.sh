#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

USE_GATEWAY=false
DEV_MODE=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/test-all-endpoints.sh [--gateway] [--dev]

Options:
  --gateway    Route smoke checks through the gateway instead of calling backend services directly.
  --dev        Enable explicit dev-mode startup expectations. Local signed JWTs remain a test convenience, not a runtime auth boundary.
  -h, --help   Show this help text.

Historical note:
  This script name is broader than its real scope. It validates gateway/control-plane routing,
  seeded frontend-critical gateway reads, synthetic route probes, and local startup mode checks.
  It is still not full per-service API coverage.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gateway)
      USE_GATEWAY=true
      shift
      ;;
    --dev)
      DEV_MODE=true
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
require_cmd curl
require_cmd jq
require_cmd openssl

TOTAL=0
PASS=0
FAIL=0
FAILURES=()
TRACE_PREFIX="${TEST_TRACE_PREFIX:-fern-infra-test}"
DEV_USER_ID="${TEST_DEV_USER_ID:-1001}"
DEV_USERNAME="${TEST_DEV_USERNAME:-fern-dev-admin}"
DEV_SESSION_ID="${TEST_DEV_SESSION_ID:-fern-dev-session}"
DEV_ROLES="${TEST_DEV_ROLES:-admin}"
DEV_PERMISSIONS="${TEST_DEV_PERMISSIONS:-*}"
DEV_OUTLET_IDS="${TEST_DEV_OUTLET_IDS:-}"
DEV_JWT_TTL_SECONDS="${TEST_DEV_JWT_TTL_SECONDS:-3600}"
STRICT_ADMIN_USERNAME="${TEST_STRICT_ADMIN_USERNAME:-workflow.admin}"
STRICT_ADMIN_PASSWORD="${TEST_STRICT_ADMIN_PASSWORD:-Workflow#2026!}"
FALLBACK_ADMIN_USERNAME="${TEST_FALLBACK_ADMIN_USERNAME:-admin}"
FALLBACK_ADMIN_PASSWORD="${TEST_FALLBACK_ADMIN_PASSWORD:-123123123}"
STRICT_MANAGER_USERNAME="${TEST_STRICT_MANAGER_USERNAME:-workflow.hcm.manager}"
STRICT_MANAGER_PASSWORD="${TEST_STRICT_MANAGER_PASSWORD:-Workflow#2026!}"
FALLBACK_MANAGER_USERNAME="${TEST_FALLBACK_MANAGER_USERNAME:-}"
FALLBACK_MANAGER_PASSWORD="${TEST_FALLBACK_MANAGER_PASSWORD:-}"
FRONTEND_ORIGIN="${TEST_FRONTEND_ORIGIN:-http://localhost:5173}"
FRONTEND_REPORT_OUTLET_ID="${TEST_FRONTEND_REPORT_OUTLET_ID:-2001}"
FRONTEND_REPORT_ITEM_ID="${TEST_FRONTEND_REPORT_ITEM_ID:-4000}"
FRONTEND_REPORT_START_DATE="${TEST_FRONTEND_REPORT_START_DATE:-2024-07-01}"
FRONTEND_REPORT_END_DATE="${TEST_FRONTEND_REPORT_END_DATE:-2024-07-01}"
FRONTEND_FORBIDDEN_OUTLET_ID="${TEST_FRONTEND_FORBIDDEN_OUTLET_ID:-2001}"

RESULT_HEADERS_FILE="$(mktemp -t fern_infra_headers.XXXXXX)"
RESULT_BODY_FILE="$(mktemp -t fern_infra_body.XXXXXX)"

cleanup() {
  local exit_code=$?
  rm -f "$RESULT_HEADERS_FILE" "$RESULT_BODY_FILE"
  echo ""
  echo "Summary:"
  echo "  Total : $TOTAL"
  echo "  Pass  : $PASS"
  echo "  Fail  : $FAIL"
  if (( FAIL > 0 )); then
    printf '  Failure: %s\n' "${FAILURES[@]}"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

record_pass() {
  TOTAL=$((TOTAL + 1))
  PASS=$((PASS + 1))
  echo -e "${GREEN}PASS${RESET} $1"
}

record_fail() {
  TOTAL=$((TOTAL + 1))
  FAIL=$((FAIL + 1))
  FAILURES+=("$1")
  echo -e "${RED}FAIL${RESET} $1"
}

assert_http() {
  local method="$1"
  local url="$2"
  local expected="$3"
  local description="$4"
  local body=""
  if (( $# >= 5 )); then
    body="$5"
    shift 5
  else
    shift 4
  fi
  local extra_args=("$@")
  local code
  local trace_id="${TRACE_PREFIX}-$(date +%s)-$RANDOM"
  local curl_args=(-sS -D "$RESULT_HEADERS_FILE" -o "$RESULT_BODY_FILE" -w '%{http_code}' -X "$method" "$url" -H "X-Trace-Id: ${trace_id}")
  if [[ -n "$body" ]]; then
    curl_args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  if [[ "${#extra_args[@]}" -gt 0 ]]; then
    curl_args+=("${extra_args[@]}")
  fi
  code="$(curl --connect-timeout 5 --max-time 15 "${curl_args[@]}" 2>/dev/null || true)"
  if [[ "$code" == "$expected" ]]; then
    record_pass "${description} -> ${code}"
    return 0
  fi
  record_fail "${description} -> expected ${expected}, got ${code} for ${method} ${url}"
  echo "--- Request Body ---"
  [[ -n "$body" ]] && echo "$body" || echo "(none)"
  echo "--- Response Headers ---"
  cat "$RESULT_HEADERS_FILE"
  echo "--- Response Body ---"
  cat "$RESULT_BODY_FILE"
  print_http_failure_context "$url" "$USE_GATEWAY"
  echo "-----------------------"
  return 1
}

assert_header_contains() {
  local header_name="$1"
  local expected_fragment="$2"
  local description="$3"
  local actual
  actual="$(grep -i "^${header_name}:" "$RESULT_HEADERS_FILE" | tail -n 1 || true)"
  if [[ "$actual" == *"$expected_fragment"* ]]; then
    record_pass "$description"
    return 0
  fi
  record_fail "${description} -> missing '${expected_fragment}' in ${header_name}"
  return 1
}

assert_json() {
  local expression="$1"
  local description="$2"
  if jq -e "$expression" "$RESULT_BODY_FILE" >/dev/null 2>&1; then
    record_pass "$description"
  else
    record_fail "$description"
    echo "--- Response Body ---"
    cat "$RESULT_BODY_FILE"
    echo "-----------------------"
  fi
}

json_value() {
  local expression="$1"
  jq -r "$expression" "$RESULT_BODY_FILE"
}

make_dev_token() {
  issue_local_jwt \
    "$DEV_USER_ID" \
    "$DEV_USERNAME" \
    "$DEV_SESSION_ID" \
    "$DEV_ROLES" \
    "$DEV_PERMISSIONS" \
    "$DEV_OUTLET_IDS" \
    "$DEV_JWT_TTL_SECONDS"
}

login_token() {
  local username="$1"
  local password="$2"
  local description="$3"
  local login_body
  login_body="$(jq -cn --arg username "$username" --arg password "$password" '{username:$username,password:$password}')"
  # Keep the smoke log visible while returning only the token body to callers.
  assert_http POST "${gateway_base}/api/v1/auth/login" 200 "$description" "$login_body" >&2
  json_value '.accessToken' | tr -d '\r\n'
}

LOGIN_TOKEN_RESULT=""
LOGIN_USERNAME_RESULT=""
LOGIN_LAST_STATUS=""
LOGIN_LAST_BODY=""
LOGIN_LAST_USERNAME=""

login_token_with_candidates() {
  local description="$1"
  local required="$2"
  shift 2

  LOGIN_TOKEN_RESULT=""
  LOGIN_USERNAME_RESULT=""
  LOGIN_LAST_STATUS=""
  LOGIN_LAST_BODY=""
  LOGIN_LAST_USERNAME=""

  while (( $# >= 2 )); do
    local username="$1"
    local password="$2"
    shift 2

    if [[ -z "$username" || -z "$password" ]]; then
      continue
    fi

    local login_body
    login_body="$(jq -cn --arg username "$username" --arg password "$password" '{username:$username,password:$password}')"
    local trace_id="${TRACE_PREFIX}-login-$(date +%s)-$RANDOM"
    local code
    code="$(curl -sS -D "$RESULT_HEADERS_FILE" -o "$RESULT_BODY_FILE" -w '%{http_code}' \
      --connect-timeout 5 --max-time 15 \
      -X POST "${gateway_base}/api/v1/auth/login" \
      -H "X-Trace-Id: ${trace_id}" \
      -H 'Content-Type: application/json' \
      -d "$login_body" 2>/dev/null || true)"

    if [[ "$code" == "200" ]]; then
      local token
      token="$(json_value '.accessToken' | tr -d '\r\n')"
      if [[ -n "$token" && "$token" != "null" ]]; then
        LOGIN_TOKEN_RESULT="$token"
        LOGIN_USERNAME_RESULT="$username"
        record_pass "${description} -> 200 (${username})"
        return 0
      fi
    fi

    LOGIN_LAST_STATUS="$code"
    LOGIN_LAST_BODY="$(cat "$RESULT_BODY_FILE")"
    LOGIN_LAST_USERNAME="$username"
  done

  if [[ "$required" == "true" ]]; then
    record_fail "${description} -> expected 200, got ${LOGIN_LAST_STATUS:-n/a} (last username: ${LOGIN_LAST_USERNAME:-n/a})"
    echo "--- Response Body ---"
    if [[ -n "$LOGIN_LAST_BODY" ]]; then
      echo "$LOGIN_LAST_BODY"
    else
      echo "(none)"
    fi
    echo "-----------------------"
  fi

  return 1
}

gateway_base="http://127.0.0.1:${GATEWAY_PORT:-8080}"
master_base="http://127.0.0.1:${MASTER_NODE_PORT:-8082}"

resolve_control_plane_url() {
  local path="$1"
  if [[ "$path" != /* ]]; then
    fail "Control-plane path must be relative: ${path}"
    exit 1
  fi
  if $USE_GATEWAY; then
    printf '%s%s' "$gateway_base" "$path"
  else
    printf '%s%s' "$master_base" "$path"
  fi
}

services_match_requested_mode() {
  local expect_dev="$1"
  local record
  for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
    local name
    name="$(record_field "$record" 0)"
    if ! service_is_running "$name"; then
      return 1
    fi
    if [[ "$expect_dev" == "true" ]]; then
      service_command_has_dev_flag "$name" || return 1
    else
      if service_command_has_dev_flag "$name"; then
        return 1
      fi
    fi
  done
  return 0
}

services_have_mode_mismatch() {
  local expect_dev="$1"
  local record
  for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
    local name
    name="$(record_field "$record" 0)"
    if ! service_is_running "$name"; then
      continue
    fi
    if [[ "$expect_dev" == "true" ]]; then
      if ! service_command_has_dev_flag "$name"; then
        return 0
      fi
    else
      if service_command_has_dev_flag "$name"; then
        return 0
      fi
    fi
  done
  return 1
}

all_local_services_healthy() {
  local record
  for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
    local name
    name="$(record_field "$record" 0)"
    if [[ "$(http_code "$(service_health_url "$name")")" != "200" ]]; then
      return 1
    fi
  done
  return 0
}

ensure_local_services_mode() {
  if services_match_requested_mode "$DEV_MODE"; then
    return 0
  fi
  if all_local_services_healthy && ! services_have_mode_mismatch "$DEV_MODE"; then
    return 0
  fi
  if services_have_mode_mismatch "$DEV_MODE"; then
    if $DEV_MODE; then
      bash "${SCRIPT_DIR}/restart-services.sh" --dev --skip-build
    else
      bash "${SCRIPT_DIR}/restart-services.sh" --skip-build
    fi
  else
    if $DEV_MODE; then
      bash "${SCRIPT_DIR}/start-services.sh" --dev --skip-build
    else
      bash "${SCRIPT_DIR}/start-services.sh" --skip-build
    fi
  fi
}

runtime_internal_token_mode() {
  local target_service="master-node"
  if $USE_GATEWAY; then
    target_service="gateway"
  fi

  if service_is_running "$target_service" && service_command_has_dev_flag "$target_service"; then
    printf 'dev'
    return 0
  fi

  printf 'strict'
}

echo "Checking environment health first..."
bash "${SCRIPT_DIR}/health-check.sh" --wait "${TEST_WAIT_SECONDS:-90}"
ensure_local_services_mode
bash "${SCRIPT_DIR}/health-check.sh" --wait "${TEST_WAIT_SECONDS:-90}"

if $USE_GATEWAY; then
  echo ""
  echo "Gateway mode enabled. All smoke probes will route through the gateway."
else
  echo ""
  echo "Direct mode enabled. Smoke probes will call services directly."
fi

if $DEV_MODE; then
  echo "Dev mode enabled for startup checks. Gateway-authenticated probes will still use a real seeded login session where runtime session validation applies."
else
  echo "Strict mode enabled for startup checks. Shared-secret JWT verification still exists in runtime; this suite simply does not rely on locally signed JWTs by default."
fi

echo ""
echo "Gateway, control-plane, and startup smoke probes:"

assert_http GET "${gateway_base}/health/live" 200 "Gateway liveness"
assert_http GET "${gateway_base}/api/v1/gateway/info" 200 "Gateway info"

register_payload="$(jq -cn \
  --argjson instanceId null \
  --arg serviceName "test-probe-service" \
  --arg version "test" \
  --arg runtime "integration-test" \
  --arg host "127.0.0.1" \
  --argjson port 9999 \
  --arg regionCode "VN" \
  '{instanceId:$instanceId,serviceName:$serviceName,version:$version,runtime:$runtime,host:$host,port:$port,regionCodes:[$regionCode],outletIds:[],capabilities:["probe"],metadata:{mode:"infra-test"}}')"

if $USE_GATEWAY; then
  control_base="${gateway_base}/api/v1/control"
else
  control_base="${master_base}/api/v1/control"
fi

control_plane_auth_args=()
if $USE_GATEWAY; then
  if ! $DEV_MODE; then
    assert_http GET "${control_base}/services" 401 "Control-plane list services unauthenticated through gateway"
  fi
fi

internal_mode="$(runtime_internal_token_mode)"
control_plane_auth_args=(
  -H "X-Internal-Service: infra-smoke"
  -H "X-Internal-Token: $(resolved_internal_service_token "$internal_mode")"
)

assert_http POST "${control_base}/services/register" 201 "Control-plane register" "$register_payload" "${control_plane_auth_args[@]}"
instance_id="$(jq -r '.instanceId' "$RESULT_BODY_FILE")"
heartbeat_path="$(jq -r '.heartbeatPath // empty' "$RESULT_BODY_FILE")"
if [[ -z "$instance_id" || "$instance_id" == "null" ]]; then
  record_fail "Control-plane register returned no instanceId"
  exit 1
fi
if [[ -z "$heartbeat_path" ]]; then
  record_fail "Control-plane register returned no heartbeatPath"
  echo "--- Response Body ---"
  cat "$RESULT_BODY_FILE"
  exit 1
fi
if $USE_GATEWAY; then
  assert_header_contains "X-Gateway-Upstream-Service" "master-node" "Gateway forwarded control-plane register"
fi

assert_http POST "$(resolve_control_plane_url "$heartbeat_path")" 200 "Control-plane heartbeat via returned path" '{}' "${control_plane_auth_args[@]}"
if $USE_GATEWAY; then
  assert_header_contains "X-Gateway-Upstream-Service" "master-node" "Gateway forwarded returned heartbeat path"
fi
assert_http GET "${control_base}/services" 200 "Control-plane list services" "" "${control_plane_auth_args[@]}"
assert_http GET "${control_base}/services/test-probe-service/instances" 200 "Control-plane list instances" "" "${control_plane_auth_args[@]}"
assert_http GET "${control_base}/config/test-probe-service" 200 "Control-plane get config" "" "${control_plane_auth_args[@]}"
assert_http GET "${control_base}/assignments/test-probe-service" 200 "Control-plane get assignments" "" "${control_plane_auth_args[@]}"
assert_http GET "${control_base}/health/system" 200 "Control-plane system health" "" "${control_plane_auth_args[@]}"
assert_http GET "${control_base}/health/services/test-probe-service" 200 "Control-plane service health" "" "${control_plane_auth_args[@]}"
assert_http POST "${control_base}/services/${instance_id}/deregister" 202 "Control-plane deregister" '{"reason":"test"}' "${control_plane_auth_args[@]}"

if $USE_GATEWAY; then
  echo ""
  echo "Synthetic routing probes:"
  route_probe="${TEST_GATEWAY_ROUTE_PROBE_PATH:-/route-probe}"
  if $DEV_MODE; then
    if ! login_token_with_candidates "Gateway route probe login" true \
      "$STRICT_ADMIN_USERNAME" "$STRICT_ADMIN_PASSWORD" \
      "$FALLBACK_ADMIN_USERNAME" "$FALLBACK_ADMIN_PASSWORD"; then
      exit 1
    fi
    routed_token="$LOGIN_TOKEN_RESULT"
    assert_http GET "${gateway_base}/api/v1/auth${route_probe}" 404 "Gateway route probe auth-service" "" -H "Authorization: Bearer ${routed_token}"
  else
    assert_http GET "${gateway_base}/api/v1/auth${route_probe}" 401 "Gateway route probe auth-service unauthenticated"
  fi
  if $DEV_MODE; then
    assert_header_contains "X-Gateway-Upstream-Service" "auth-service" "Gateway marked auth upstream"
  fi
  if $DEV_MODE; then
    assert_http GET "${gateway_base}/api/v1/products${route_probe}" 404 "Gateway route probe product-service" "" -H "Authorization: Bearer ${routed_token}"
  else
    assert_http GET "${gateway_base}/api/v1/products${route_probe}" 401 "Gateway route probe product-service unauthenticated"
  fi
  if $DEV_MODE; then
    assert_header_contains "X-Gateway-Upstream-Service" "product-service" "Gateway marked product upstream"
  fi
fi

if $USE_GATEWAY; then
  echo ""
  echo "Frontend-critical gateway smoke:"
  assert_http OPTIONS "${gateway_base}/api/v1/auth/login" 200 "Gateway CORS preflight for auth login" "" \
    -H "Origin: ${FRONTEND_ORIGIN}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Authorization,Content-Type,X-Correlation-ID"
  assert_header_contains "Access-Control-Allow-Origin" "${FRONTEND_ORIGIN}" "Gateway allows configured frontend origin"

  if ! login_token_with_candidates "Frontend login admin" true \
    "$STRICT_ADMIN_USERNAME" "$STRICT_ADMIN_PASSWORD" \
    "$FALLBACK_ADMIN_USERNAME" "$FALLBACK_ADMIN_PASSWORD"; then
    exit 1
  fi
  admin_token="$LOGIN_TOKEN_RESULT"
  admin_login_username="$LOGIN_USERNAME_RESULT"
  assert_json '.accessToken | type == "string" and length > 0' "Frontend login returned access token"
  assert_http GET "${gateway_base}/api/v1/auth/me" 200 "Frontend me" "" -H "Authorization: Bearer ${admin_token}"
  assert_json ".user.username == \"${admin_login_username}\"" "Frontend me returned login user"
  assert_http GET "${gateway_base}/api/v1/auth/me" 401 "Frontend me unauthenticated"

  assert_http GET "${gateway_base}/api/v1/org/outlets" 200 "Frontend org outlets read" "" -H "Authorization: Bearer ${admin_token}"
  assert_json 'type == "array" and length > 0' "Frontend org outlets returned data"

  assert_http GET "${gateway_base}/api/v1/product/products" 200 "Frontend product catalog read" "" -H "Authorization: Bearer ${admin_token}"
  assert_json '(type == "array" and length > 0) or (.items | type == "array" and length > 0)' "Frontend product catalog returned data"

  report_url="${gateway_base}/api/v1/reports/inventory-movements?outletId=${FRONTEND_REPORT_OUTLET_ID}&itemId=${FRONTEND_REPORT_ITEM_ID}&startDate=${FRONTEND_REPORT_START_DATE}&endDate=${FRONTEND_REPORT_END_DATE}"
  assert_http GET "${report_url}" 200 "Frontend report read" "" -H "Authorization: Bearer ${admin_token}"
  assert_json '(. | type == "array") or (.items | type == "array")' "Frontend report returned array payload"
  # Extract items from either plain array or paged response
  report_items='.'
  if jq -e '.items' "$RESULT_BODY_FILE" >/dev/null 2>&1; then
    report_items='.items'
  fi
  if jq -e "${report_items} | length > 0" "$RESULT_BODY_FILE" >/dev/null 2>&1; then
    assert_json "${report_items} | any(.[]; .outletId == ${FRONTEND_REPORT_OUTLET_ID} and .itemId == ${FRONTEND_REPORT_ITEM_ID})" \
      "Frontend report rows match requested outlet/item filters"
  else
    record_pass "Frontend report returned no rows for requested filters in current dataset"
  fi

  if login_token_with_candidates "Frontend login scoped manager" false \
    "$STRICT_MANAGER_USERNAME" "$STRICT_MANAGER_PASSWORD" \
    "$FALLBACK_MANAGER_USERNAME" "$FALLBACK_MANAGER_PASSWORD"; then
    manager_token="$LOGIN_TOKEN_RESULT"
    assert_json '.accessToken | type == "string" and length > 0' "Frontend scoped manager login returned access token"
    forbidden_report_url="${gateway_base}/api/v1/reports/inventory-movements?outletId=${FRONTEND_FORBIDDEN_OUTLET_ID}&itemId=${FRONTEND_REPORT_ITEM_ID}&startDate=${FRONTEND_REPORT_START_DATE}&endDate=${FRONTEND_REPORT_END_DATE}"
    assert_http GET "${forbidden_report_url}" 403 "Frontend report cross-outlet forbidden" "" -H "Authorization: Bearer ${manager_token}"
  else
    echo "SKIP Frontend report cross-outlet forbidden: no scoped manager credentials configured or available."
  fi
fi

echo ""
echo "Startup mode probes:"
for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
  name="$(record_field "$record" 0)"
  if ! service_is_running "$name"; then
    record_fail "${name} is not running under local jar control"
    continue
  fi
  if $DEV_MODE; then
    if service_command_has_dev_flag "$name"; then
      record_pass "${name} was started with --dev"
    else
      record_fail "${name} was expected to include --dev"
    fi
  else
    if service_command_has_dev_flag "$name"; then
      record_fail "${name} should not include --dev in strict mode"
    else
      record_pass "${name} is running without --dev"
    fi
  fi
done

if (( FAIL > 0 )); then
  exit 1
fi
