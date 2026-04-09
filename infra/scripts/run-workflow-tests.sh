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
SEED_DATA=true
SCENARIO="all"
COLLECT_OBSERVABILITY=true

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/run-workflow-tests.sh [--gateway] [--dev] [--scenario NAME] [--skip-seed] [--skip-observability]

Scenarios:
  all
  auth-access
  org-product
  procurement-chain
  sales-chain
  hr-payroll-chain
  report-replica

Notes:
  - This suite validates implemented cross-service workflows, not future-state behavior.
  - --dev changes startup expectations and defaults to locally signed test JWTs where useful.
    It does not mean strict mode rejects a valid shared-secret JWT at runtime.
  - --skip-seed requires the deterministic workflow fixtures to already exist.
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
    --scenario)
      SCENARIO="${2:?missing scenario}"
      shift 2
      ;;
    --skip-seed)
      SEED_DATA=false
      shift
      ;;
    --skip-observability)
      COLLECT_OBSERVABILITY=false
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
require_docker_daemon
require_cmd curl
require_cmd jq
require_cmd openssl
require_cmd awk

TOTAL=0
PASS=0
FAIL=0
FAILURES=()
RUN_ID="$(date +%s)"
TRACE_PREFIX="${TEST_TRACE_PREFIX:-fern-workflow}"
STRICT_ADMIN_USERNAME="${TEST_STRICT_ADMIN_USERNAME:-workflow.admin}"
STRICT_ADMIN_PASSWORD="${TEST_STRICT_ADMIN_PASSWORD:-Workflow#2026!}"
STRICT_MANAGER_USERNAME="${TEST_STRICT_MANAGER_USERNAME:-workflow.hcm.manager}"
STRICT_MANAGER_PASSWORD="${TEST_STRICT_MANAGER_PASSWORD:-Workflow#2026!}"

SEED_ADMIN_USER_ID="${TEST_WORKFLOW_ADMIN_USER_ID:-3010}"
SEED_MANAGER_USER_ID="${TEST_WORKFLOW_MANAGER_USER_ID:-3011}"
SEED_PRIMARY_OUTLET_ID="${TEST_WORKFLOW_PRIMARY_OUTLET_ID:-2000}"
SEED_SECONDARY_OUTLET_ID="${TEST_WORKFLOW_SECONDARY_OUTLET_ID:-2001}"
SEED_PRIMARY_ITEM_ID="${TEST_WORKFLOW_PRIMARY_ITEM_ID:-4000}"
SEED_PRIMARY_PRODUCT_ID="${TEST_WORKFLOW_PRIMARY_PRODUCT_ID:-5001}"
REPORT_SCENARIO_DATE="${TEST_REPORT_SCENARIO_DATE:-$(date -u +%F)}"

RESULT_HEADERS_FILE="$(mktemp -t fern_workflow_headers.XXXXXX)"
RESULT_BODY_FILE="$(mktemp -t fern_workflow_body.XXXXXX)"
PG_STAT_SNAPSHOT_FILE="$(mktemp -t fern_workflow_pgstats.XXXXXX)"
LAST_STATUS=""

gateway_base="http://127.0.0.1:${GATEWAY_PORT:-8080}"
auth_base="http://127.0.0.1:${AUTH_SERVICE_PORT:-8081}"
org_base="http://127.0.0.1:${ORG_SERVICE_PORT:-8083}"
hr_base="http://127.0.0.1:${HR_SERVICE_PORT:-8084}"
product_base="http://127.0.0.1:${PRODUCT_SERVICE_PORT:-8085}"
procurement_base="http://127.0.0.1:${PROCUREMENT_SERVICE_PORT:-8086}"
sales_base="http://127.0.0.1:${SALES_SERVICE_PORT:-8087}"
inventory_base="http://127.0.0.1:${INVENTORY_SERVICE_PORT:-8088}"
payroll_base="http://127.0.0.1:${PAYROLL_SERVICE_PORT:-8089}"
finance_base="http://127.0.0.1:${FINANCE_SERVICE_PORT:-8090}"
report_base="http://127.0.0.1:${REPORT_SERVICE_PORT:-8092}"
master_base="http://127.0.0.1:${MASTER_NODE_PORT:-8082}"

cleanup() {
  local exit_code=$?
  rm -f "$RESULT_HEADERS_FILE" "$RESULT_BODY_FILE" "$PG_STAT_SNAPSHOT_FILE"
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

domain_base_url() {
  local domain="$1"
  if $USE_GATEWAY; then
    printf '%s' "$gateway_base"
    return 0
  fi
  case "$domain" in
    auth) printf '%s' "$auth_base" ;;
    org) printf '%s' "$org_base" ;;
    hr) printf '%s' "$hr_base" ;;
    product) printf '%s' "$product_base" ;;
    procurement) printf '%s' "$procurement_base" ;;
    sales) printf '%s' "$sales_base" ;;
    inventory) printf '%s' "$inventory_base" ;;
    payroll) printf '%s' "$payroll_base" ;;
    finance) printf '%s' "$finance_base" ;;
    report) printf '%s' "$report_base" ;;
    master) printf '%s' "$master_base" ;;
    *)
      fail "Unknown domain: $domain"
      ;;
  esac
}

api_url() {
  local domain="$1"
  local path="$2"
  printf '%s%s' "$(domain_base_url "$domain")" "$path"
}

http_request() {
  local method="$1"
  local url="$2"
  local expected="$3"
  local description="$4"
  local body="${5:-}"
  local token="${6:-}"
  shift $(( $# > 6 ? 6 : $# ))
  local extra_args=("$@")
  local trace_id="${TRACE_PREFIX}-$(date +%s)-$RANDOM"
  local curl_args=(-sS -D "$RESULT_HEADERS_FILE" -o "$RESULT_BODY_FILE" -w '%{http_code}' -X "$method" "$url" -H "X-Trace-Id: ${trace_id}")
  if [[ -n "$token" ]]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi
  if [[ "${#extra_args[@]}" -gt 0 ]]; then
    curl_args+=("${extra_args[@]}")
  fi
  LAST_STATUS="$(curl --connect-timeout 5 --max-time 20 "${curl_args[@]}" 2>/dev/null || true)"
  if [[ "$LAST_STATUS" == "$expected" ]]; then
    record_pass "${description} -> ${LAST_STATUS}"
    return 0
  fi
  record_fail "${description} -> expected ${expected}, got ${LAST_STATUS} for ${method} ${url}"
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

http_probe() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local token="${4:-}"
  shift $(( $# > 4 ? 4 : $# ))
  local extra_args=("$@")
  local trace_id="${TRACE_PREFIX}-probe-$(date +%s)-$RANDOM"
  local curl_args=(-sS -D "$RESULT_HEADERS_FILE" -o "$RESULT_BODY_FILE" -w '%{http_code}' -X "$method" "$url" -H "X-Trace-Id: ${trace_id}")
  if [[ -n "$token" ]]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi
  if [[ "${#extra_args[@]}" -gt 0 ]]; then
    curl_args+=("${extra_args[@]}")
  fi
  LAST_STATUS="$(curl --connect-timeout 5 --max-time 20 "${curl_args[@]}" 2>/dev/null || true)"
  [[ "$LAST_STATUS" == "200" ]]
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

login_token() {
  local username="$1"
  local password="$2"
  local login_body
  login_body="$(jq -cn --arg username "$username" --arg password "$password" '{username:$username,password:$password}')"
  http_request POST "$(api_url auth /api/v1/auth/login)" 200 "Login ${username}" "$login_body" >&2
  json_value '.accessToken'
}

wait_for_db_nonzero() {
  local target="$1"
  local sql="$2"
  local timeout="$3"
  local description="$4"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    local value
    value="$(db_query_scalar "$target" "$sql" | tr -d '[:space:]' || true)"
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value > 0 )); then
      record_pass "$description"
      return 0
    fi
    sleep 1
  done
  record_fail "$description"
  echo "--- SQL ---"
  echo "$sql"
  echo "------------"
  return 1
}

wait_for_db_scalar() {
  local target="$1"
  local sql="$2"
  local timeout="$3"
  local description="$4"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    local value
    value="$(db_query_scalar "$target" "$sql" | tr -d '\r' || true)"
    if [[ -n "${value//[$'\t\n ']/}" ]]; then
      record_pass "$description" >&2
      printf '%s' "$value"
      return 0
    fi
    sleep 1
  done
  record_fail "$description" >&2
  echo "--- SQL ---" >&2
  echo "$sql" >&2
  echo "------------" >&2
  return 1
}

wait_for_json_condition() {
  local token="$1"
  local url="$2"
  local timeout="$3"
  local expression="$4"
  local description="$5"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if http_probe GET "$url" "" "$token"; then
      if jq -e "$expression" "$RESULT_BODY_FILE" >/dev/null 2>&1; then
        record_pass "$description"
        return 0
      fi
    fi
    sleep 1
  done
  record_fail "$description"
  echo "--- Response Body ---"
  cat "$RESULT_BODY_FILE"
  echo "---------------------"
  return 1
}

assert_decimal_less() {
  local left="$1"
  local right="$2"
  local description="$3"
  if awk "BEGIN { exit !($left < $right) }"; then
    record_pass "$description"
  else
    record_fail "$description -> expected ${left} < ${right}"
  fi
}

capture_observability() {
  local tag="$1"
  if ! $COLLECT_OBSERVABILITY; then
    return 0
  fi
  bash "${SCRIPT_DIR}/collect-observability-snapshot.sh" --tag "$tag" >/dev/null
  local snapshot_dir="${INFRA_LOG_DIR}/observability/${tag}"
  if [[ -s "${snapshot_dir}/primary_pg_stat_statements.tsv" ]]; then
    record_pass "Observability snapshot ${tag} captured primary query stats"
  else
    record_fail "Observability snapshot ${tag} missing primary query stats"
  fi
}

pg_stat_snapshot_get() {
  local key="$1"
  local value
  value="$(awk -F '\t' -v key="$key" '$1 == key { print $2 }' "$PG_STAT_SNAPSHOT_FILE" | tail -n 1)"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
  else
    printf '0\n'
  fi
}

pg_stat_snapshot_set() {
  local key="$1"
  local value="$2"
  awk -F '\t' -v key="$key" '$1 != key { print }' "$PG_STAT_SNAPSHOT_FILE" > "${PG_STAT_SNAPSHOT_FILE}.tmp"
  printf '%s\t%s\n' "$key" "$value" >> "${PG_STAT_SNAPSHOT_FILE}.tmp"
  mv "${PG_STAT_SNAPSHOT_FILE}.tmp" "$PG_STAT_SNAPSHOT_FILE"
}

assert_pg_stat_statements_recorded() {
  local target="$1"
  local table_fragment="$2"
  local description="$3"
  local key="${target}|${table_fragment}"
  local count_sql
  count_sql="SELECT COALESCE(SUM(calls), 0)::bigint FROM pg_stat_statements WHERE query ILIKE '%${table_fragment}%';"
  local value
  value="$(db_query_scalar "$target" "$count_sql" | tr -d '[:space:]' || true)"
  local baseline
  baseline="$(pg_stat_snapshot_get "$key")"
  if [[ "$value" =~ ^[0-9]+$ ]] && (( value > baseline )); then
    record_pass "$description"
  else
    record_fail "$description"
    echo "--- pg_stat_statements matching '%${table_fragment}%' on ${target} ---"
    db_tools_psql "$target" -F $'\t' -Atqc \
      "SELECT calls, round(total_exec_time::numeric, 3), query FROM pg_stat_statements WHERE query ILIKE '%${table_fragment}%' ORDER BY calls DESC, total_exec_time DESC LIMIT 10;" \
      || true
    echo "---------------------------------------------------------------"
  fi
}

snapshot_pg_stat_statements() {
  local target="$1"
  local table_fragment="$2"
  local key="${target}|${table_fragment}"
  local sql="SELECT COALESCE(SUM(calls), 0)::bigint FROM pg_stat_statements WHERE query ILIKE '%${table_fragment}%';"
  pg_stat_snapshot_set "$key" "$(db_query_scalar "$target" "$sql" | tr -d '[:space:]' || printf '0')"
}

admin_token() {
  if $DEV_MODE; then
    issue_local_jwt \
      "${TEST_DEV_USER_ID:-3010}" \
      "${TEST_DEV_USERNAME:-workflow.admin}" \
      "${TEST_DEV_SESSION_ID:-fern-dev-session}" \
      "${TEST_DEV_ROLES:-admin}" \
      "${TEST_DEV_PERMISSIONS:-*}" \
      "${TEST_DEV_OUTLET_IDS:-2000,2001,2002,2003,2004}" \
      "${TEST_DEV_JWT_TTL_SECONDS:-3600}"
  else
    login_token "$STRICT_ADMIN_USERNAME" "$STRICT_ADMIN_PASSWORD"
  fi
}

manager_token() {
  login_token "$STRICT_MANAGER_USERNAME" "$STRICT_MANAGER_PASSWORD"
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

require_seed_fixture() {
  local description="$1"
  local sql="$2"
  local value
  value="$(db_query_scalar primary "$sql" | tr -d '[:space:]' || true)"
  if [[ "$value" == "1" ]]; then
    return 0
  fi
  fail "Missing workflow fixture: ${description}"
  echo "  SQL: ${sql}" >&2
  return 1
}

ensure_workflow_seed_fixtures() {
  local missing=0
  require_seed_fixture "workflow admin user ${SEED_ADMIN_USER_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.app_user WHERE id = ${SEED_ADMIN_USER_ID}) THEN 1 ELSE 0 END;" || missing=1
  require_seed_fixture "workflow manager user ${SEED_MANAGER_USER_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.app_user WHERE id = ${SEED_MANAGER_USER_ID}) THEN 1 ELSE 0 END;" || missing=1
  require_seed_fixture "primary workflow outlet ${SEED_PRIMARY_OUTLET_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.outlet WHERE id = ${SEED_PRIMARY_OUTLET_ID}) THEN 1 ELSE 0 END;" || missing=1
  require_seed_fixture "secondary workflow outlet ${SEED_SECONDARY_OUTLET_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.outlet WHERE id = ${SEED_SECONDARY_OUTLET_ID}) THEN 1 ELSE 0 END;" || missing=1
  require_seed_fixture "primary workflow item ${SEED_PRIMARY_ITEM_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.item WHERE id = ${SEED_PRIMARY_ITEM_ID}) THEN 1 ELSE 0 END;" || missing=1
  require_seed_fixture "primary workflow product ${SEED_PRIMARY_PRODUCT_ID}" \
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM core.product WHERE id = ${SEED_PRIMARY_PRODUCT_ID}) THEN 1 ELSE 0 END;" || missing=1
  if (( missing > 0 )); then
    fail "Workflow fixtures are missing. Re-run ./infra/scripts/seed-workflow-data.sh or omit --skip-seed."
    exit 1
  fi
}

scenario_auth_access() {
  echo ""
  print_banner "Workflow: auth-access"

  local admin
  admin="$(admin_token)"

  if $DEV_MODE; then
    http_request GET "$(api_url auth /api/v1/auth/me)" 200 "Local signed JWT can call /auth/me" "" "$admin"
  fi

  http_request GET "$(api_url auth /api/v1/auth/me)" 200 "Admin /auth/me" "" "$admin"
  assert_json '.user.username == "workflow.admin"' "Admin /auth/me returned seeded workflow user"

  local baseline_role_body
  baseline_role_body='{"permissionCodes":["purchase.approve","sales.order.write"]}'
  http_request PUT "$(api_url auth /api/v1/auth/roles/outlet_manager/permissions)" 200 "Reset outlet_manager role permissions baseline" "$baseline_role_body" "$admin"

  local username="workflow.user.${RUN_ID}"
  local create_body
  create_body="$(jq -cn \
    --arg username "$username" \
    --arg password "$STRICT_ADMIN_PASSWORD" \
    --arg fullName "Workflow Outlet Manager ${RUN_ID}" \
    --arg employeeCode "WF-HCM-${RUN_ID}" \
    --arg email "${username}@example.com" \
    --argjson outletId "$SEED_PRIMARY_OUTLET_ID" \
    '{username:$username,password:$password,fullName:$fullName,employeeCode:$employeeCode,email:$email,outletAccess:[{outletId:$outletId,roles:["outlet_manager"],permissions:[]}]}' )"

  http_request POST "$(api_url auth /api/v1/auth/users)" 201 "Create workflow scoped user" "$create_body" "$admin"
  local created_user_id
  created_user_id="$(json_value '.id')"

  local scoped_user_token
  scoped_user_token="$(login_token "$username" "$STRICT_ADMIN_PASSWORD")"
  http_request GET "$(api_url auth /api/v1/auth/me)" 200 "Scoped user /auth/me before role update" "" "$scoped_user_token"
  assert_json "((.permissionsByOutlet[\"${SEED_PRIMARY_OUTLET_ID}\"] // []) | index(\"sale.refund\")) == null" "Scoped user starts without sale.refund"

  local role_body='{"permissionCodes":["purchase.approve","sale.refund","sales.order.write"]}'
  http_request PUT "$(api_url auth /api/v1/auth/roles/outlet_manager/permissions)" 200 "Update outlet_manager role permissions" "$role_body" "$admin"

  http_request GET "$(api_url auth /api/v1/auth/me)" 200 "Scoped user /auth/me after role update" "" "$scoped_user_token"
  assert_json "((.permissionsByOutlet[\"${SEED_PRIMARY_OUTLET_ID}\"] // []) | index(\"sale.refund\")) != null" "Scoped user sees updated role permission after eviction"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.app_user WHERE id = ${created_user_id};" 5 "Created workflow user persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.role_permission WHERE role_code = 'outlet_manager' AND permission_code = 'sale.refund';" 5 "Role permission persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'app_user' AND entity_id = '${created_user_id}';" 10 "Audit log captured created user"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'role' AND entity_id = 'outlet_manager';" 10 "Audit log captured role update"
  capture_observability "auth-access-${RUN_ID}"
}

scenario_org_product() {
  echo ""
  print_banner "Workflow: org-product"

  local admin
  admin="$(admin_token)"
  local outlet_code="VN-DN-WF-${RUN_ID}"
  local item_code="WF-BEAN-${RUN_ID}"
  local product_code="WF-DRINK-${RUN_ID}"

  snapshot_pg_stat_statements primary "product_price"

  local outlet_body
  outlet_body="$(jq -cn \
    --arg code "$outlet_code" \
    --arg name "Workflow Da Nang Outlet ${RUN_ID}" \
    '{regionId:1003,code:$code,name:$name,status:"active",address:"Da Nang Test Address",phone:"+84-236-555-0101",email:"workflow.outlet@example.com",openedAt:"2026-03-01"}')"
  http_request POST "$(api_url org /api/v1/org/outlets)" 201 "Create outlet for multi-region workflow" "$outlet_body" "$admin"
  local outlet_id
  outlet_id="$(json_value '.id')"

  local rate_body
  rate_body="$(jq -cn '{fromCurrencyCode:"USD",toCurrencyCode:"VND",rate:25750.00,effectiveFrom:"2026-03-01",effectiveTo:null}')"
  http_request PUT "$(api_url org /api/v1/org/exchange-rates)" 200 "Upsert workflow exchange rate" "$rate_body" "$admin"

  local item_body
  item_body="$(jq -cn --arg code "$item_code" '{code:$code,name:"Workflow Coffee Blend",categoryCode:"ingredient",baseUomCode:"g",minStockLevel:100,maxStockLevel:10000}')"
  http_request POST "$(api_url product /api/v1/product/items)" 201 "Create workflow item" "$item_body" "$admin"
  local item_id
  item_id="$(json_value '.id')"

  local product_body
  product_body="$(jq -cn --arg code "$product_code" '{code:$code,name:"Workflow Signature Drink",categoryCode:"beverage",imageUrl:null,description:"Scenario validation product"}')"
  http_request POST "$(api_url product /api/v1/product/products)" 201 "Create workflow product" "$product_body" "$admin"
  local product_id
  product_id="$(json_value '.id')"

  local recipe_body
  recipe_body="$(jq -cn --argjson itemId "$item_id" '{version:"wf-v1",yieldQty:1,yieldUomCode:"cup",status:"active",items:[{itemId:$itemId,uomCode:"g",qty:22.5}]}' )"
  http_request PUT "$(api_url product "/api/v1/product/recipes/${product_id}")" 200 "Upsert workflow recipe" "$recipe_body" "$admin"

  local price_body
  price_body="$(jq -cn --argjson productId "$product_id" --argjson outletId "$outlet_id" '{productId:$productId,outletId:$outletId,currencyCode:"VND",priceValue:72000.00,effectiveFrom:"2026-03-01",effectiveTo:null}')"
  http_request PUT "$(api_url product /api/v1/product/prices)" 200 "Upsert workflow outlet price" "$price_body" "$admin"

  http_request GET "$(api_url product "/api/v1/product/prices/${product_id}?outletId=${outlet_id}&on=2026-03-27")" 200 "Fetch workflow product price" "" "$admin"
  assert_json ".productId == ${product_id} and .outletId == ${outlet_id}" "Price lookup returned created workflow price"

  http_request GET "$(api_url product "/api/v1/product/recipes/${product_id}")" 200 "Fetch workflow recipe" "" "$admin"
  assert_json '.version == "wf-v1" and (.items | length == 1)' "Recipe lookup returned workflow recipe"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.outlet WHERE id = ${outlet_id} AND code = '${outlet_code}';" 5 "Workflow outlet persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.product WHERE id = ${product_id} AND code = '${product_code}';" 5 "Workflow product persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.product_price WHERE product_id = ${product_id} AND outlet_id = ${outlet_id};" 5 "Workflow price persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.recipe WHERE product_id = ${product_id} AND version = 'wf-v1';" 5 "Workflow recipe persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'outlet' AND entity_id = '${outlet_id}';" 10 "Audit log captured outlet creation"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'product_price' AND entity_id = '${product_id}';" 10 "Audit log captured price change"
  assert_pg_stat_statements_recorded primary "product_price" "pg_stat_statements captured product price activity"
  capture_observability "org-product-${RUN_ID}"
}

scenario_procurement_chain() {
  echo ""
  print_banner "Workflow: procurement-chain"

  local admin
  admin="$(admin_token)"
  local supplier_code="WF-SUP-${RUN_ID}"

  snapshot_pg_stat_statements primary "goods_receipt"

  local supplier_body
  supplier_body="$(jq -cn --arg supplierCode "$supplier_code" '{regionId:1000,supplierCode:$supplierCode,name:"Workflow Supplier",taxCode:"WF-TAX",address:"Workflow Supplier Address",phone:"+84-28-5555-0101",email:"workflow.supplier@example.com",contactPerson:"Workflow Buyer",status:"active"}')"
  http_request POST "$(api_url procurement /api/v1/procurement/suppliers)" 201 "Create workflow supplier" "$supplier_body" "$admin"
  local supplier_id
  supplier_id="$(json_value '.id')"

  local po_body
  po_body="$(jq -cn --argjson supplierId "$supplier_id" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --argjson itemId "$SEED_PRIMARY_ITEM_ID" '{supplierId:$supplierId,outletId:$outletId,currencyCode:"VND",orderDate:"2026-03-27",expectedDeliveryDate:"2026-03-28",note:"Workflow PO",items:[{itemId:$itemId,uomCode:"kg",expectedUnitPrice:260000.00,qtyOrdered:2.0000,note:"Workflow coffee bean order"}]}' )"
  http_request POST "$(api_url procurement /api/v1/procurement/purchase-orders)" 201 "Create workflow purchase order" "$po_body" "$admin"
  local po_id
  po_id="$(json_value '.id')"

  http_request POST "$(api_url procurement "/api/v1/procurement/purchase-orders/${po_id}/approve")" 200 "Approve workflow purchase order" "" "$admin"

  local gr_body
  gr_body="$(jq -cn --argjson poId "$po_id" --argjson itemId "$SEED_PRIMARY_ITEM_ID" '{poId:$poId,currencyCode:"VND",businessDate:"2026-03-27",totalPrice:520000.00,supplierLotNumber:"WF-LOT-001",note:"Workflow goods receipt",items:[{itemId:$itemId,uomCode:"kg",qtyReceived:2.0000,unitCost:260000.00,manufactureDate:"2026-03-20",expiryDate:"2026-12-31",note:"Workflow receipt line"}]}' )"
  http_request POST "$(api_url procurement /api/v1/procurement/goods-receipts)" 201 "Create workflow goods receipt" "$gr_body" "$admin"
  local receipt_id
  receipt_id="$(json_value '.id')"
  local receipt_item_id
  receipt_item_id="$(jq -r '.items[0].id' "$RESULT_BODY_FILE")"

  http_request POST "$(api_url procurement "/api/v1/procurement/goods-receipts/${receipt_id}/approve")" 200 "Approve workflow goods receipt" "" "$admin"
  http_request POST "$(api_url procurement "/api/v1/procurement/goods-receipts/${receipt_id}/post")" 200 "Post workflow goods receipt" "" "$admin"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.goods_receipt_transaction WHERE goods_receipt_item_id = ${receipt_item_id};" 20 "Inventory linked goods receipt to transaction"

  local invoice_body
  invoice_body="$(jq -cn --argjson supplierId "$supplier_id" --argjson receiptId "$receipt_id" --argjson receiptItemId "$receipt_item_id" '{invoiceNumber:"WF-INV-20260327",supplierId:$supplierId,currencyCode:"VND",invoiceDate:"2026-03-27",dueDate:"2026-04-03",subtotal:520000.00,taxAmount:0.00,totalAmount:520000.00,note:"Workflow invoice",linkedReceiptIds:[$receiptId],items:[{lineType:"stock",goodsReceiptItemId:$receiptItemId,description:"Workflow stock line",qtyInvoiced:2.0000,unitPrice:260000.00,taxPercent:0.00,taxAmount:0.00,lineTotal:520000.00,note:"Workflow invoice line"}]}' )"
  http_request POST "$(api_url procurement /api/v1/procurement/invoices)" 201 "Create workflow supplier invoice" "$invoice_body" "$admin"
  local invoice_id
  invoice_id="$(json_value '.id')"

  http_request POST "$(api_url procurement "/api/v1/procurement/invoices/${invoice_id}/approve")" 200 "Approve workflow supplier invoice" "" "$admin"

  local payment_body
  payment_body="$(jq -cn --argjson supplierId "$supplier_id" --argjson invoiceId "$invoice_id" '{supplierId:$supplierId,currencyCode:"VND",paymentMethod:"bank_transfer",amount:520000.00,paymentTime:"2026-03-27T10:00:00Z",transactionRef:"WF-PAY-20260327",note:"Workflow payment",allocations:[{invoiceId:$invoiceId,allocatedAmount:520000.00,note:"Workflow allocation"}]}' )"
  http_request POST "$(api_url procurement /api/v1/procurement/payments)" 201 "Create workflow supplier payment" "$payment_body" "$admin"
  local payment_id
  payment_id="$(json_value '.id')"
  http_request POST "$(api_url procurement "/api/v1/procurement/payments/${payment_id}/post")" 200 "Post workflow supplier payment" "" "$admin"

  local expense_record_id
  expense_record_id="$(wait_for_db_scalar primary "SELECT er.id FROM core.expense_inventory_purchase eip JOIN core.expense_record er ON er.id = eip.expense_record_id WHERE eip.goods_receipt_id = ${receipt_id} ORDER BY er.created_at DESC LIMIT 1;" 20 "Finance expense created from approved invoice")"
  expense_record_id="$(printf '%s' "$expense_record_id" | tr -d '[:space:]')"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.supplier_payment_allocation WHERE invoice_id = ${invoice_id};" 5 "Supplier payment allocation persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'goods_receipt' AND entity_id = '${receipt_id}';" 20 "Audit log captured goods receipt post"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'supplier_invoice' AND entity_id = '${invoice_id}';" 20 "Audit log captured invoice approval"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'expense_record' AND entity_id = '${expense_record_id}';" 20 "Audit log captured finance expense creation"
  assert_pg_stat_statements_recorded primary "goods_receipt" "pg_stat_statements captured procurement workflow"
  capture_observability "procurement-chain-${RUN_ID}"
}

scenario_sales_chain() {
  echo ""
  print_banner "Workflow: sales-chain"

  local admin
  admin="$(admin_token)"
  local session_code="WF-POS-${RUN_ID}"
  local stock_before
  stock_before="$(db_query_scalar primary "SELECT qty_on_hand FROM core.stock_balance WHERE location_id = ${SEED_PRIMARY_OUTLET_ID} AND item_id = ${SEED_PRIMARY_ITEM_ID};" | tr -d '[:space:]')"

  snapshot_pg_stat_statements primary "sale_record"

  local session_body
  session_body="$(jq -cn --arg sessionCode "$session_code" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --argjson managerId "$SEED_ADMIN_USER_ID" '{sessionCode:$sessionCode,outletId:$outletId,currencyCode:"VND",managerId:$managerId,businessDate:"2026-03-27",note:"Workflow POS session"}')"
  http_request POST "$(api_url sales /api/v1/sales/pos-sessions)" 201 "Open workflow POS session" "$session_body" "$admin"
  local session_id
  session_id="$(json_value '.id')"

  local sale_body
  sale_body="$(jq -cn --argjson sessionId "$session_id" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --argjson productId "$SEED_PRIMARY_PRODUCT_ID" '{outletId:$outletId,posSessionId:$sessionId,currencyCode:"VND",orderType:"takeaway",note:"Workflow sale",items:[{productId:$productId,quantity:1.0000,discountAmount:0.00,taxAmount:0.00,note:"Workflow line",promotionIds:[]}]}' )"
  http_request POST "$(api_url sales /api/v1/sales/orders)" 201 "Create workflow sale order" "$sale_body" "$admin"
  local sale_id
  sale_id="$(json_value '.id')"
  local sale_total_amount
  sale_total_amount="$(json_value '.totalAmount')"
  assert_json ".id == \"${sale_id}\" and .status == \"order_created\" and .paymentStatus == \"unpaid\"" "Workflow sale created in order_created"

  http_request POST "$(api_url sales "/api/v1/sales/orders/${sale_id}/approve")" 200 "Approve workflow sale order" "" "$admin"
  assert_json ".id == \"${sale_id}\" and .status == \"order_approved\" and .paymentStatus == \"unpaid\"" "Workflow sale moved to order_approved"

  local payment_body
  payment_body="$(jq -cn --argjson amount "$sale_total_amount" '{paymentMethod:"cash",amount:$amount,paymentTime:"2026-03-27T11:00:00Z",transactionRef:"WF-SALE-PAY",note:"Workflow payment"}')"
  http_request POST "$(api_url sales "/api/v1/sales/orders/${sale_id}/mark-payment-done")" 200 "Mark workflow sale payment done" "$payment_body" "$admin"

  http_request GET "$(api_url sales "/api/v1/sales/orders/${sale_id}")" 200 "Fetch workflow sale" "" "$admin"
  assert_json ".id == \"${sale_id}\" and .status == \"payment_done\" and .paymentStatus == \"paid\" and .payment.status == \"success\"" "Workflow sale returned final payment_done state"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.sale_item_transaction WHERE sale_id = ${sale_id};" 20 "Inventory linked sale to depletion transactions"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'sale_record' AND entity_id = '${sale_id}';" 20 "Audit log captured sale completion"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'payment' AND entity_id = '${sale_id}';" 20 "Audit log captured payment capture"

  local stock_after
  stock_after="$(db_query_scalar primary "SELECT qty_on_hand FROM core.stock_balance WHERE location_id = ${SEED_PRIMARY_OUTLET_ID} AND item_id = ${SEED_PRIMARY_ITEM_ID};" | tr -d '[:space:]')"
  assert_decimal_less "$stock_after" "$stock_before" "Stock balance decreased after workflow sale"

  assert_pg_stat_statements_recorded primary "sale_record" "pg_stat_statements captured sales workflow"
  capture_observability "sales-chain-${RUN_ID}"
}

scenario_hr_payroll_chain() {
  echo ""
  print_banner "Workflow: hr-payroll-chain"

  local admin
  admin="$(admin_token)"
  local shift_code="WF-SHIFT-${RUN_ID}"
  local day_offset=$((RUN_ID % 20))
  local period_start_day=$((day_offset + 1))
  local period_end_day=$((day_offset + 6))
  local pay_day=$((day_offset + 8))
  local period_start
  local period_end
  local pay_date
  local work_date
  period_start="$(printf '2026-04-%02d' "$period_start_day")"
  period_end="$(printf '2026-04-%02d' "$period_end_day")"
  pay_date="$(printf '2026-04-%02d' "$pay_day")"
  work_date="$period_end"

  snapshot_pg_stat_statements primary "payroll"

  local shift_body
  shift_body="$(jq -cn --arg code "$shift_code" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" '{outletId:$outletId,code:$code,name:"Workflow Shift",startTime:"08:00:00",endTime:"16:00:00",breakMinutes:30}')"
  http_request POST "$(api_url hr /api/v1/hr/shifts)" 201 "Create workflow shift" "$shift_body" "$admin"
  local shift_id
  shift_id="$(json_value '.id')"

  local work_shift_body
  work_shift_body="$(jq -cn --argjson shiftId "$shift_id" --argjson userId "$SEED_MANAGER_USER_ID" --arg workDate "$work_date" '{shiftId:$shiftId,userId:$userId,workDate:$workDate,scheduleStatus:"scheduled",attendanceStatus:"present",approvalStatus:"pending",note:"Workflow shift assignment"}')"
  http_request POST "$(api_url hr /api/v1/hr/work-shifts)" 201 "Create workflow work shift" "$work_shift_body" "$admin"
  local work_shift_id
  work_shift_id="$(json_value '.id')"

  local attendance_body
  attendance_body="$(jq -cn --arg workDate "$work_date" '{
    attendanceStatus:"present",
    actualStartTime:($workDate + "T01:00:00Z"),
    actualEndTime:($workDate + "T09:00:00Z"),
    note:"Workflow attendance"
  }')"
  http_request PUT "$(api_url hr "/api/v1/hr/work-shifts/${work_shift_id}/attendance")" 200 "Update workflow attendance" "$attendance_body" "$admin"
  http_request POST "$(api_url hr "/api/v1/hr/work-shifts/${work_shift_id}/approve")" 200 "Approve workflow work shift" "" "$admin"

  local contract_body
  contract_body="$(jq -cn --argjson userId "$SEED_MANAGER_USER_ID" '{userId:$userId,employmentType:"full_time",salaryType:"monthly",baseSalary:15000000.00,currencyCode:"VND",regionCode:"VN-HCM",taxCode:"WF-TAX",bankAccount:"123456789",hireDate:"2026-03-01",startDate:"2026-03-01",endDate:null,status:"active"}')"
  http_request POST "$(api_url hr /api/v1/hr/contracts)" 201 "Create workflow employee contract" "$contract_body" "$admin"
  local contract_id
  contract_id="$(json_value '.id')"

  local period_body
  period_body="$(jq -cn --arg startDate "$period_start" --arg endDate "$period_end" --arg payDate "$pay_date" '{
    regionId:1001,
    name:"Workflow Payroll Period",
    startDate:$startDate,
    endDate:$endDate,
    payDate:$payDate,
    note:"Workflow payroll period"
  }')"
  http_request POST "$(api_url payroll /api/v1/payroll/periods)" 201 "Create workflow payroll period" "$period_body" "$admin"
  local period_id
  period_id="$(json_value '.id')"

  local timesheet_body
  timesheet_body="$(jq -cn --argjson periodId "$period_id" --argjson userId "$SEED_MANAGER_USER_ID" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" '{payrollPeriodId:$periodId,userId:$userId,outletId:$outletId,workDays:6.00,workHours:48.00,overtimeHours:4.00,overtimeRate:1.50,lateCount:1,absentDays:0.00}')"
  http_request POST "$(api_url payroll /api/v1/payroll/timesheets)" 201 "Create workflow payroll timesheet" "$timesheet_body" "$admin"
  local timesheet_id
  timesheet_id="$(json_value '.id')"

  local payroll_body
  payroll_body="$(jq -cn --argjson timesheetId "$timesheet_id" '{payrollTimesheetId:$timesheetId,currencyCode:"VND",baseSalaryAmount:15000000.00,netSalary:14000000.00,note:"Workflow payroll"}')"
  http_request POST "$(api_url payroll /api/v1/payroll)" 201 "Generate workflow payroll" "$payroll_body" "$admin"
  local payroll_id
  payroll_id="$(json_value '.id')"

  http_request POST "$(api_url payroll "/api/v1/payroll/${payroll_id}/approve")" 200 "Approve workflow payroll" "" "$admin"

  local expense_record_id
  expense_record_id="$(wait_for_db_scalar primary "SELECT er.id FROM core.expense_payroll ep JOIN core.expense_record er ON er.id = ep.expense_record_id WHERE ep.payroll_id = ${payroll_id} ORDER BY er.created_at DESC LIMIT 1;" 20 "Finance expense created from approved payroll")"
  expense_record_id="$(printf '%s' "$expense_record_id" | tr -d '[:space:]')"

  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.employee_contract WHERE id = ${contract_id};" 5 "Workflow contract persisted"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'payroll' AND entity_id = '${payroll_id}';" 20 "Audit log captured payroll approval"
  wait_for_db_nonzero primary "SELECT COUNT(*) FROM core.audit_log WHERE entity_name = 'expense_record' AND entity_id = '${expense_record_id}';" 20 "Audit log captured payroll expense creation"
  assert_pg_stat_statements_recorded primary "payroll" "pg_stat_statements captured payroll workflow"
  capture_observability "hr-payroll-chain-${RUN_ID}"
}

scenario_report_replica() {
  echo ""
  print_banner "Workflow: report-replica"

  local admin
  admin="$(admin_token)"
  local manager
  manager="$(manager_token)"
  local session_code="WF-REPORT-POS-${RUN_ID}"

  local sales_report_url
  local inventory_report_url
  local expense_report_url
  sales_report_url="$(api_url report "/api/v1/reports/sales?outletId=${SEED_PRIMARY_OUTLET_ID}&startDate=${REPORT_SCENARIO_DATE}&endDate=${REPORT_SCENARIO_DATE}")"
  inventory_report_url="$(api_url report "/api/v1/reports/inventory-movements?outletId=${SEED_PRIMARY_OUTLET_ID}&itemId=${SEED_PRIMARY_ITEM_ID}&startDate=${REPORT_SCENARIO_DATE}&endDate=${REPORT_SCENARIO_DATE}")"
  expense_report_url="$(api_url report "/api/v1/reports/expenses?outletId=${SEED_PRIMARY_OUTLET_ID}&startDate=${REPORT_SCENARIO_DATE}&endDate=${REPORT_SCENARIO_DATE}")"

  http_request GET "$sales_report_url" 200 "Baseline replica sales report" "" "$manager"
  local baseline_sales_count
  local baseline_sales_total
  baseline_sales_count="$(jq -r --arg businessDate "$REPORT_SCENARIO_DATE" '[.[] | select(.businessDate == $businessDate) | .saleCount] | add // 0' "$RESULT_BODY_FILE")"
  baseline_sales_total="$(jq -r --arg businessDate "$REPORT_SCENARIO_DATE" '[.[] | select(.businessDate == $businessDate) | (.totalAmount | tonumber)] | add // 0' "$RESULT_BODY_FILE")"

  http_request GET "$inventory_report_url" 200 "Baseline replica inventory report" "" "$manager"
  local baseline_inventory_usage
  baseline_inventory_usage="$(jq -r --arg businessDate "$REPORT_SCENARIO_DATE" --argjson itemId "$SEED_PRIMARY_ITEM_ID" '[.[] | select(.businessDate == $businessDate and .itemId == $itemId and .txnType == "sale_usage") | (.netQuantityChange | tonumber)] | add // 0' "$RESULT_BODY_FILE")"

  http_request GET "$expense_report_url" 200 "Baseline replica expense report" "" "$manager"
  local baseline_expense_count
  local baseline_expense_total
  baseline_expense_count="$(jq -r --arg businessDate "$REPORT_SCENARIO_DATE" '[.[] | select(.businessDate == $businessDate and .sourceType == "operating_expense") | .expenseCount] | add // 0' "$RESULT_BODY_FILE")"
  baseline_expense_total="$(jq -r --arg businessDate "$REPORT_SCENARIO_DATE" '[.[] | select(.businessDate == $businessDate and .sourceType == "operating_expense") | (.totalAmount | tonumber)] | add // 0' "$RESULT_BODY_FILE")"

  snapshot_pg_stat_statements replica "sale_record"

  local expense_body
  expense_body="$(jq -cn --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --arg businessDate "$REPORT_SCENARIO_DATE" '{outletId:$outletId,businessDate:$businessDate,currencyCode:"VND",amount:125000.00,description:"Workflow operating expense",note:"Workflow report seed"}')"
  http_request POST "$(api_url finance /api/v1/finance/expenses/operating)" 201 "Create workflow operating expense" "$expense_body" "$admin"

  local session_body
  session_body="$(jq -cn --arg sessionCode "$session_code" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --argjson managerId "$SEED_ADMIN_USER_ID" --arg businessDate "$REPORT_SCENARIO_DATE" '{sessionCode:$sessionCode,outletId:$outletId,currencyCode:"VND",managerId:$managerId,businessDate:$businessDate,note:"Workflow report session"}')"
  http_request POST "$(api_url sales /api/v1/sales/pos-sessions)" 201 "Open workflow report POS session" "$session_body" "$admin"
  local session_id
  session_id="$(json_value '.id')"

  local sale_body
  sale_body="$(jq -cn --argjson sessionId "$session_id" --argjson outletId "$SEED_PRIMARY_OUTLET_ID" --argjson productId "$SEED_PRIMARY_PRODUCT_ID" '{outletId:$outletId,posSessionId:$sessionId,currencyCode:"VND",orderType:"takeaway",note:"Workflow report sale",items:[{productId:$productId,quantity:1.0000,discountAmount:0.00,taxAmount:0.00,note:"Workflow report line",promotionIds:[]}]}' )"
  http_request POST "$(api_url sales /api/v1/sales/orders)" 201 "Create workflow report sale order" "$sale_body" "$admin"
  local report_sale_id
  report_sale_id="$(json_value '.id')"
  local report_sale_total_amount
  report_sale_total_amount="$(json_value '.totalAmount')"
  http_request POST "$(api_url sales "/api/v1/sales/orders/${report_sale_id}/approve")" 200 "Approve workflow report sale order" "" "$admin"
  local report_payment_body
  report_payment_body="$(jq -cn --arg reportDate "$REPORT_SCENARIO_DATE" --argjson amount "$report_sale_total_amount" '{paymentMethod:"cash",amount:$amount,paymentTime:($reportDate + "T12:00:00Z"),transactionRef:"WF-REPORT-SALE",note:"Workflow report payment"}')"
  http_request POST "$(api_url sales "/api/v1/sales/orders/${report_sale_id}/mark-payment-done")" 200 "Mark workflow report payment done" "$report_payment_body" "$admin"

  wait_for_json_condition "$manager" "$sales_report_url" 40 \
    "([.[] | select(.businessDate == \"${REPORT_SCENARIO_DATE}\") | .saleCount] | add // 0) > ${baseline_sales_count} and ([.[] | select(.businessDate == \"${REPORT_SCENARIO_DATE}\") | (.totalAmount | tonumber)] | add // 0) > ${baseline_sales_total}" \
    "Replica sales report includes this run's new sale"
  wait_for_json_condition "$manager" "$inventory_report_url" 40 \
    "([.[] | select(.businessDate == \"${REPORT_SCENARIO_DATE}\" and .itemId == ${SEED_PRIMARY_ITEM_ID} and .txnType == \"sale_usage\") | (.netQuantityChange | tonumber)] | add // 0) < ${baseline_inventory_usage}" \
    "Replica inventory report includes this run's sale depletion"
  wait_for_json_condition "$manager" "$expense_report_url" 40 \
    "([.[] | select(.businessDate == \"${REPORT_SCENARIO_DATE}\" and .sourceType == \"operating_expense\") | .expenseCount] | add // 0) > ${baseline_expense_count} and ([.[] | select(.businessDate == \"${REPORT_SCENARIO_DATE}\" and .sourceType == \"operating_expense\") | (.totalAmount | tonumber)] | add // 0) > ${baseline_expense_total}" \
    "Replica expense report includes this run's operating expense"

  http_request GET "$(api_url report "/api/v1/reports/sales?outletId=${SEED_SECONDARY_OUTLET_ID}&startDate=2024-01-01&endDate=2026-12-31")" 403 "Scoped manager denied cross-region sales report" "" "$manager"
  http_request GET "$(api_url report "/api/v1/reports/sales?outletId=${SEED_SECONDARY_OUTLET_ID}&startDate=2024-01-01&endDate=2026-12-31")" 200 "Admin can access cross-region sales report" "" "$admin"

  local lag_value
  lag_value="$(db_query_scalar replica "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())), 0);" | tr -d '[:space:]' || true)"
  if [[ -n "$lag_value" ]]; then
    record_pass "Replica lag query returned ${lag_value} seconds"
  else
    record_fail "Replica lag query did not return a value"
  fi

  assert_pg_stat_statements_recorded replica "sale_record" "Replica pg_stat_statements captured reporting query"
  capture_observability "report-replica-${RUN_ID}"
}

run_selected_scenarios() {
  case "$SCENARIO" in
    all)
      scenario_auth_access
      scenario_org_product
      scenario_procurement_chain
      scenario_sales_chain
      scenario_hr_payroll_chain
      scenario_report_replica
      ;;
    auth-access)
      scenario_auth_access
      ;;
    org-product)
      scenario_org_product
      ;;
    procurement-chain)
      scenario_procurement_chain
      ;;
    sales-chain)
      scenario_sales_chain
      ;;
    hr-payroll-chain)
      scenario_hr_payroll_chain
      ;;
    report-replica)
      scenario_report_replica
      ;;
    *)
      fail "Unknown scenario: $SCENARIO"
      ;;
  esac
}

print_banner "FERN Workflow Validation"
echo "  routing mode : $([[ "$USE_GATEWAY" == true ]] && echo gateway || echo direct)"
echo "  startup mode : $([[ "$DEV_MODE" == true ]] && echo dev || echo strict)"
echo "  token source : $([[ "$DEV_MODE" == true ]] && echo local-jwt-default || echo login-default)"
echo "  scenario     : ${SCENARIO}"

if $SEED_DATA; then
  bash "${SCRIPT_DIR}/seed-workflow-data.sh"
  if $DEV_MODE; then
    bash "${SCRIPT_DIR}/restart-services.sh" --dev --skip-build
  else
    bash "${SCRIPT_DIR}/restart-services.sh" --skip-build
  fi
else
  ensure_workflow_seed_fixtures
  ensure_local_services_mode
fi

ensure_pg_stat_statements_ready
bash "${SCRIPT_DIR}/health-check.sh" --wait "${TEST_WAIT_SECONDS:-90}"
run_selected_scenarios

if (( FAIL > 0 )); then
  exit 1
fi
