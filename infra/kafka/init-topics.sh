#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=/dev/null
. "${INFRA_DIR}/scripts/common.sh"

load_infra_env
load_manifest

bootstrap_server="kafka:29092"

for entry in "${FERN_KAFKA_TOPICS[@]}"; do
  IFS='|' read -r topic partitions <<<"$entry"
  if compose exec -T kafka /usr/bin/kafka-topics \
    --bootstrap-server "$bootstrap_server" \
    --create \
    --if-not-exists \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor 1 >/dev/null 2>&1; then
    printf '  + topic ready: %s\n' "$topic"
  else
    printf '  ! topic check failed: %s\n' "$topic"
  fi
done
