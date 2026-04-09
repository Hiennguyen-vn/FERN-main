#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

BASE_URL="${BASE_URL:-http://127.0.0.1:8180}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-123123123}"
FALLBACK_USERNAME="${FALLBACK_USERNAME:-workflow.admin}"
FALLBACK_PASSWORD="${FALLBACK_PASSWORD:-Workflow#2026!}"

cleanup() {
  "${ROOT_DIR}/infra/scripts/stop-services.sh" >/tmp/fern-stop.log 2>&1 || true
}
trap cleanup EXIT

"${ROOT_DIR}/infra/scripts/start-services.sh" --skip-build >/tmp/fern-start.log 2>&1

login() {
  local username="$1"
  local password="$2"
  curl -sS --max-time 10 -X POST "${BASE_URL}/api/v1/auth/login" \
    -H "content-type: application/json" \
    -d "{\"username\":\"${username}\",\"password\":\"${password}\"}"
}

LOGIN_RESPONSE="$(login "${ADMIN_USERNAME}" "${ADMIN_PASSWORD}")"
ACCESS_TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" | jq -r '.accessToken // empty')"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  LOGIN_RESPONSE="$(login "${FALLBACK_USERNAME}" "${FALLBACK_PASSWORD}")"
  ACCESS_TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" | jq -r '.accessToken // empty')"
fi

if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "LOGIN_FAILED"
  echo "${LOGIN_RESPONSE}"
  exit 1
fi

ME_RESPONSE="$(curl -sS --max-time 10 "${BASE_URL}/api/v1/auth/me" -H "authorization: Bearer ${ACCESS_TOKEN}")"
USER_ID="$(printf '%s' "${ME_RESPONSE}" | jq -r '.user.id // .id // .userId // empty')"
if [[ -z "${USER_ID}" || "${USER_ID}" == "null" ]]; then
  echo "NO_USER_ID"
  echo "${ME_RESPONSE}"
  exit 1
fi

AUTH_OUTLET_IDS="$(printf '%s' "${ME_RESPONSE}" | jq -r '.outletIds[]?')"
OUTLETS_RESPONSE="$(curl -sS --max-time 10 "${BASE_URL}/api/v1/org/outlets" -H "authorization: Bearer ${ACCESS_TOKEN}")"
ORG_OUTLET_IDS="$(printf '%s' "${OUTLETS_RESPONSE}" | jq -r 'if type=="array" then .[].id else .items[].id end')"
OUTLET_CANDIDATES="$(printf '%s\n%s\n' "${AUTH_OUTLET_IDS}" "${ORG_OUTLET_IDS}" | awk 'NF && !seen[$0]++')"
if [[ -z "${OUTLET_CANDIDATES}" ]]; then
  echo "NO_OUTLET_ID"
  echo "${ME_RESPONSE}"
  exit 1
fi

ATTEMPT_COUNT=0
PRICE_MISS_COUNT=0
STOCK_BLOCK_COUNT=0
SUCCESS_ORDER_ID=""
SUCCESS_PRODUCT_ID=""
SUCCESS_OUTLET_ID=""
SUCCESS_CURRENCY_CODE=""
SUCCESS_SESSION_ID=""
OPEN_FAIL_COUNT=0

for outlet_id in ${OUTLET_CANDIDATES}; do
  PRICES_RESPONSE="$(curl -sS --max-time 10 "${BASE_URL}/api/v1/product/prices?outletId=${outlet_id}" -H "authorization: Bearer ${ACCESS_TOKEN}")"
  CURRENCY_CODE="$(printf '%s' "${PRICES_RESPONSE}" | jq -r 'if type=="array" then (.[0].currencyCode // empty) else (.items[0].currencyCode // empty) end')"
  PRODUCT_IDS="$(printf '%s' "${PRICES_RESPONSE}" | jq -r 'if type=="array" then .[].productId else .items[].productId end')"
  if [[ -z "${CURRENCY_CODE}" || -z "${PRODUCT_IDS}" ]]; then
    continue
  fi

  SESSION_CODE="AUTO-POS-${outlet_id}-$(date +%H%M%S)"
  OPEN_SESSION_PAYLOAD="$(
    jq -n \
      --arg code "${SESSION_CODE}" \
      --argjson outletId "${outlet_id}" \
      --arg currency "${CURRENCY_CODE}" \
      --argjson managerId "${USER_ID}" \
      --arg businessDate "$(date +%F)" \
      '{sessionCode:$code,outletId:$outletId,currencyCode:$currency,managerId:$managerId,businessDate:$businessDate}'
  )"
  OPEN_STATUS="$(
    curl -sS --max-time 10 -o /tmp/pos-open.json -w '%{http_code}' \
      -X POST "${BASE_URL}/api/v1/sales/pos-sessions" \
      -H "authorization: Bearer ${ACCESS_TOKEN}" \
      -H "content-type: application/json" \
      -d "${OPEN_SESSION_PAYLOAD}"
  )"
  SESSION_ID="$(jq -r '.id // empty' /tmp/pos-open.json)"
  if [[ "${OPEN_STATUS}" != "201" || -z "${SESSION_ID}" ]]; then
    OPEN_FAIL_COUNT=$((OPEN_FAIL_COUNT + 1))
    continue
  fi

  for product_id in ${PRODUCT_IDS}; do
    ATTEMPT_COUNT=$((ATTEMPT_COUNT + 1))
    ORDER_PAYLOAD="$(
      jq -n \
        --argjson outletId "${outlet_id}" \
        --argjson sessionId "${SESSION_ID}" \
        --arg currency "${CURRENCY_CODE}" \
        --argjson productId "${product_id}" \
        '{outletId:$outletId,posSessionId:$sessionId,currencyCode:$currency,orderType:"dine_in",items:[{productId:$productId,quantity:1}]}'
    )"
    ORDER_STATUS="$(
      curl -sS --max-time 10 -o /tmp/pos-order-try.json -w '%{http_code}' \
        -X POST "${BASE_URL}/api/v1/sales/orders" \
        -H "authorization: Bearer ${ACCESS_TOKEN}" \
        -H "content-type: application/json" \
        -d "${ORDER_PAYLOAD}"
    )"

    if [[ "${ORDER_STATUS}" == "201" ]]; then
      SUCCESS_ORDER_ID="$(jq -r '.id // empty' /tmp/pos-order-try.json)"
      SUCCESS_PRODUCT_ID="${product_id}"
      SUCCESS_OUTLET_ID="${outlet_id}"
      SUCCESS_CURRENCY_CODE="${CURRENCY_CODE}"
      SUCCESS_SESSION_ID="${SESSION_ID}"
      cp /tmp/pos-order-try.json /tmp/pos-order-success.json
      break 2
    fi

    MESSAGE="$(jq -r '.message // empty' /tmp/pos-order-try.json)"
    if echo "${MESSAGE}" | grep -q "No effective product price"; then
      PRICE_MISS_COUNT=$((PRICE_MISS_COUNT + 1))
    fi
    if [[ "${ORDER_STATUS}" == "409" ]] && echo "${MESSAGE}" | grep -qi "not have enough stock"; then
      STOCK_BLOCK_COUNT=$((STOCK_BLOCK_COUNT + 1))
      continue
    fi

    echo "UNEXPECTED_ORDER_FAILURE outletId=${outlet_id} productId=${product_id} status=${ORDER_STATUS}"
    cat /tmp/pos-order-try.json
    exit 1
  done
done

if [[ -z "${SUCCESS_ORDER_ID}" ]]; then
  echo "NO_SUCCESSFUL_ORDER"
  echo "ATTEMPT_COUNT=${ATTEMPT_COUNT}"
  echo "PRICE_MISS_COUNT=${PRICE_MISS_COUNT}"
  echo "STOCK_BLOCK_COUNT=${STOCK_BLOCK_COUNT}"
  echo "OPEN_FAIL_COUNT=${OPEN_FAIL_COUNT}"
  exit 1
fi

ORDER_TOTAL="$(jq -r '.totalAmount // "0"' /tmp/pos-order-success.json)"
MARK_PAYMENT_PAYLOAD="$(jq -n --arg amount "${ORDER_TOTAL}" '{paymentMethod:"cash",amount:($amount|tonumber)}')"
APPROVE_STATUS="$(
  curl -sS --max-time 10 -o /tmp/pos-approve.json -w '%{http_code}' \
    -X POST "${BASE_URL}/api/v1/sales/orders/${SUCCESS_ORDER_ID}/approve" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "content-type: application/json"
)"
CONFIRM_STATUS="$(
  curl -sS --max-time 10 -o /tmp/pos-confirm.json -w '%{http_code}' \
    -X POST "${BASE_URL}/api/v1/sales/orders/${SUCCESS_ORDER_ID}/confirm" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "content-type: application/json"
)"
PAYMENT_STATUS_CODE="$(
  curl -sS --max-time 10 -o /tmp/pos-payment.json -w '%{http_code}' \
    -X POST "${BASE_URL}/api/v1/sales/orders/${SUCCESS_ORDER_ID}/mark-payment-done" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "content-type: application/json" \
    -d "${MARK_PAYMENT_PAYLOAD}"
)"
PAYMENT_STATUS="$(jq -r '.paymentStatus // empty' /tmp/pos-payment.json)"

INVALID_ORDER_PAYLOAD="$(
  jq -n \
    --argjson outletId "${SUCCESS_OUTLET_ID}" \
    --argjson sessionId "${SUCCESS_SESSION_ID}" \
    --arg currency "${SUCCESS_CURRENCY_CODE}" \
    '{outletId:$outletId,posSessionId:$sessionId,currencyCode:$currency,orderType:"dine_in",items:[{productId:999999999999999,quantity:1}]}'
)"
INVALID_STATUS="$(
  curl -sS --max-time 10 -o /tmp/pos-invalid.json -w '%{http_code}' \
    -X POST "${BASE_URL}/api/v1/sales/orders" \
    -H "authorization: Bearer ${ACCESS_TOKEN}" \
    -H "content-type: application/json" \
    -d "${INVALID_ORDER_PAYLOAD}"
)"

printf 'LOGIN_OK\nOUTLET_ID=%s\nCURRENCY_CODE=%s\nSESSION_ID=%s\nATTEMPT_COUNT=%s\nPRICE_MISS_COUNT=%s\nSTOCK_BLOCK_COUNT=%s\nSUCCESS_PRODUCT_ID=%s\nSUCCESS_ORDER_ID=%s\nORDER_TOTAL=%s\nPAYMENT_STATUS_CODE=%s\nPAYMENT_STATUS=%s\nINVALID_STATUS=%s\n' \
  "${SUCCESS_OUTLET_ID}" "${SUCCESS_CURRENCY_CODE}" "${SUCCESS_SESSION_ID}" "${ATTEMPT_COUNT}" "${PRICE_MISS_COUNT}" "${STOCK_BLOCK_COUNT}" "${SUCCESS_PRODUCT_ID}" "${SUCCESS_ORDER_ID}" "${ORDER_TOTAL}" "${PAYMENT_STATUS_CODE}" "${PAYMENT_STATUS}" "${INVALID_STATUS}"
printf 'APPROVE_STATUS=%s\nCONFIRM_STATUS=%s\n' "${APPROVE_STATUS}" "${CONFIRM_STATUS}"

echo -n 'ORDER_SUCCESS_BODY='
cat /tmp/pos-order-success.json
echo
echo -n 'APPROVE_BODY='
cat /tmp/pos-approve.json
echo
echo -n 'CONFIRM_BODY='
cat /tmp/pos-confirm.json
echo
echo -n 'PAYMENT_BODY='
cat /tmp/pos-payment.json
echo
echo -n 'INVALID_ORDER_BODY='
cat /tmp/pos-invalid.json
echo
