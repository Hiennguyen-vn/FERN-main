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
load_service_env
load_manifest
ensure_runtime_dirs

print_banner "FERN Infrastructure Status"
echo ""
compose ps

echo ""
echo "Local jar services:"
for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
  name="$(record_field "$record" 0)"
  port="$(service_port "$name")"
  tracked_pid="$(read_pid "$name")"
  pid="$(service_detect_pid "$name" || true)"
  if pid_is_running "$pid"; then
    code="$(http_code "$(service_health_url "$name")")"
    if [[ -n "$tracked_pid" && "$tracked_pid" != "$pid" ]]; then
      printf '  %-20s pid=%-8s tracked=%-8s port=%-5s health=%s\n' "$name" "$pid" "$tracked_pid" "$port" "${code:-000}"
    else
      printf '  %-20s pid=%-8s port=%-5s health=%s\n' "$name" "$pid" "$port" "${code:-000}"
    fi
  else
    if [[ -n "$tracked_pid" ]]; then
      printf '  %-20s %s (stale pid file: %s)\n' "$name" "stopped" "$tracked_pid"
    else
      printf '  %-20s %s\n' "$name" "stopped"
    fi
  fi
done
