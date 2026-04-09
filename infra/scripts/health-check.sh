#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

WAIT_SECONDS=0
ALLOW_MISSING_LOCAL=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/health-check.sh [--wait SECONDS] [--allow-missing-local]

Options:
  --wait SECONDS         Poll until dependencies and local services reach the expected health state.
  --allow-missing-local  Treat missing local jar services as informational instead of failure.
  -h, --help             Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    --allow-missing-local)
      ALLOW_MISSING_LOCAL=true
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

if ! [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "--wait must be a non-negative integer" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/common.sh"

load_infra_env
load_service_env
load_manifest
ensure_runtime_dirs

check_once() {
  local failures=0

  echo "Dependency health:"
  for service in "${FERN_DEPENDENCY_SERVICES[@]}"; do
    printf '  %-18s ' "$service"
    if wait_for_compose_health "$service" 1; then
      echo -e "${GREEN}healthy${RESET}"
    else
      echo -e "${RED}unhealthy${RESET}"
      failures=$((failures + 1))
    fi
  done

  echo ""
  echo "Replication health:"
  if bash "${SCRIPT_DIR}/check-postgres-replication.sh"; then
    :
  else
    failures=$((failures + 1))
  fi

  echo ""
  echo "Local service health:"
  for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
    local name
    name="$(record_field "$record" 0)"
    local pid
    pid="$(service_detect_pid "$name" || true)"
    if ! pid_is_running "$pid"; then
      if $ALLOW_MISSING_LOCAL; then
        printf '  %-20s %s\n' "$name" "${YELLOW}not running${RESET}"
      else
        printf '  %-20s %s\n' "$name" "${RED}missing${RESET}"
        failures=$((failures + 1))
      fi
      continue
    fi

    local url
    url="$(service_health_url "$name")"
    local code
    code="$(http_code "$url")"
    if [[ "$code" == "200" ]]; then
      printf '  %-20s %s %s\n' "$name" "${GREEN}healthy${RESET}" "$url"
    else
      printf '  %-20s %s %s (%s)\n' "$name" "${RED}unhealthy${RESET}" "$url" "${code:-000}"
      failures=$((failures + 1))
    fi
  done

  return "$failures"
}

if [[ "$WAIT_SECONDS" == "0" ]]; then
  if check_once; then
    exit 0
  fi
  exit 1
fi

deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  if check_once; then
    exit 0
  fi
  sleep 1
  echo ""
done

echo -e "${RED}Timed out waiting for healthy local environment.${RESET}" >&2
exit 1
