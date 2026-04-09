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

load_manifest
ensure_runtime_dirs

print_banner "FERN Services - Stopping local services"

for (( idx=${#FERN_LOCAL_SERVICE_ORDER[@]}-1; idx>=0; idx-- )); do
  record="${FERN_LOCAL_SERVICE_ORDER[$idx]}"
  name="$(record_field "$record" 0)"
  if service_is_running "$name"; then
    echo "  - stopping ${name}"
    terminate_service "$name"
  else
    rm -f "$(service_pid_file "$name")"
  fi
done

echo "Local services stopped."
