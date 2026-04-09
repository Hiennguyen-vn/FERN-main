#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

WITH_WORKFLOW_SEED=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/reset-workflow-data.sh [--with-workflow-seed]

Defaults:
  - resets the schema
  - reapplies migrations
  - seeds only the baseline reference/demo data (001, 002, 003)

Warning:
  This is destructive to the local FERN database and intended for local workflow validation only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-workflow-seed)
      WITH_WORKFLOW_SEED=true
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

if $WITH_WORKFLOW_SEED; then
  bash "${SCRIPT_DIR}/seed-workflow-data.sh"
else
  bash "${SCRIPT_DIR}/seed-workflow-data.sh" --baseline-only
fi
