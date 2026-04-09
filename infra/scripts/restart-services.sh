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
      cat <<'EOF'
Usage: ./infra/scripts/restart-services.sh [--dev] [--skip-build]

Options:
  --dev        Restart services in explicit development mode and forward --dev to every local service.
  --skip-build Skip the Maven package step and reuse current runnable jars.
  -h, --help   Show this help text.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "${SCRIPT_DIR}/stop-services.sh"
if $DEV_MODE; then
  if $SKIP_BUILD; then
    bash "${SCRIPT_DIR}/start-services.sh" --dev --skip-build
  else
    bash "${SCRIPT_DIR}/start-services.sh" --dev
  fi
else
  if $SKIP_BUILD; then
    bash "${SCRIPT_DIR}/start-services.sh" --skip-build
  else
    bash "${SCRIPT_DIR}/start-services.sh"
  fi
fi
