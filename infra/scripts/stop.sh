#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/common.sh"

load_infra_env

print_banner "FERN Infrastructure - Stopping dependencies"
compose down --remove-orphans
echo "Dependency containers stopped."
