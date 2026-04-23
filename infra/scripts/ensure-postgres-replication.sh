#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

WAIT_SECONDS=60
PROBE=true
REPAIR=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/ensure-postgres-replication.sh [--wait SECONDS] [--no-probe] [--repair]

Options:
  --wait SECONDS  Wait for streaming replication for up to this many seconds. Default: 60.
  --no-probe      Skip the real primary-write / replica-read probe.
  --repair        If replication is unhealthy, force-recreate and reseed the replica, then re-check.
  -h, --help      Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    --no-probe)
      PROBE=false
      shift
      ;;
    --repair)
      REPAIR=true
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
ensure_runtime_dirs

check_replication() {
  local wait_seconds="$1"
  local -a args=("--wait" "$wait_seconds")
  if $PROBE; then
    args+=("--probe")
  fi
  bash "${SCRIPT_DIR}/check-postgres-replication.sh" "${args[@]}"
}

repair_replica() {
  print_banner "Repairing PostgreSQL replica"
  (
    cd "$INFRA_DIR"
    POSTGRES_REPLICA_FORCE_RESEED=true docker compose --env-file "$INFRA_ENV_FILE" up -d --no-deps --force-recreate postgres-replica
  )
  printf '  %-18s ' "postgres-replica"
  if wait_for_compose_health postgres-replica 180; then
    echo -e "${GREEN}healthy${RESET}"
  else
    echo -e "${RED}timeout${RESET}"
    exit 1
  fi
}

if $REPAIR; then
  if check_replication 0; then
    exit 0
  fi
else
  if check_replication "$WAIT_SECONDS"; then
    exit 0
  fi
fi

if ! $REPAIR; then
  exit 1
fi

echo "Replication unhealthy; recreating and reseeding the replica..."
repair_replica
check_replication "$WAIT_SECONDS"
