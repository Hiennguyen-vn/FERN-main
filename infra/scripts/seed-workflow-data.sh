#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

BASELINE_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/seed-workflow-data.sh [--baseline-only]

Defaults:
  - resets the schema
  - reapplies migrations
  - seeds 001, 002, 003, and 010 workflow validation data

Warning:
  This is destructive to the local FERN database and intended for local workflow validation only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline-only)
      BASELINE_ONLY=true
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
load_manifest
ensure_runtime_dirs
require_docker_daemon

print_banner "FERN Workflow Seed"
echo "This will reset the local workflow database and reseed it from scratch."

"${ROOT_DIR}/db/scripts/reset.sh"

for seed in \
  "/workspace/db/seeds/001_reference_seed.sql" \
  "/workspace/db/seeds/002_sample_operational_seed.sql" \
  "/workspace/db/seeds/003_demo_seed.sql"
do
  echo "Applying $(basename "$seed")"
  db_tools_psql primary -v ON_ERROR_STOP=1 -f "$seed" >/dev/null
done

if ! $BASELINE_ONLY; then
  echo "Applying 010_workflow_validation_seed.sql"
  db_tools_psql primary -v ON_ERROR_STOP=1 -f /workspace/db/seeds/010_workflow_validation_seed.sql >/dev/null
fi

echo "Clearing auth permission cache keys"
compose exec -T redis sh -lc '
  keys="$(redis-cli --scan --pattern "fern-auth-permissions:*"; redis-cli --scan --pattern "fern-org-hierarchy:*")"
  if [ -n "$keys" ]; then
    printf "%s\n" "$keys" | xargs redis-cli DEL >/dev/null
  fi
' >/dev/null

if service_is_running "org-service"; then
  echo "Restarting org-service to clear in-memory hierarchy cache"
  org_dev_mode=false
  if service_command_has_dev_flag "org-service"; then
    org_dev_mode=true
  fi
  terminate_service "org-service"
  if $org_dev_mode; then
    bash "${SCRIPT_DIR}/start-services.sh" --dev --skip-build >/dev/null
  else
    bash "${SCRIPT_DIR}/start-services.sh" --skip-build >/dev/null
  fi
fi

echo ""
echo "Workflow data ready."
echo "  strict admin user    : workflow.admin"
echo "  strict manager user  : workflow.hcm.manager"
echo "  local test password  : Workflow#2026!"
