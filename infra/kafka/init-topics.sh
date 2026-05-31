#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=/dev/null
. "${INFRA_DIR}/scripts/common.sh"

load_infra_env
load_manifest

bootstrap_server="kafka:29092,kafka-2:29092,kafka-3:29092"

# Pick first healthy broker for `compose exec` target — broker-1 may be down.
exec_target=""
running_brokers=0
for candidate in kafka kafka-2 kafka-3; do
  if compose ps --status running --services 2>/dev/null | grep -qx "$candidate"; then
    running_brokers=$((running_brokers + 1))
    if [[ -z "$exec_target" ]]; then
      exec_target="$candidate"
    fi
  fi
done
if [[ -z "$exec_target" ]]; then
  echo "ERROR: no kafka broker container running" >&2
  exit 1
fi

# Production-intended critical topics use RF=3, min.insync.replicas=2.
# In local compose we may only have 1 broker, so cap RF/minISR to avoid
# perpetual NotEnoughReplicasError for acks=all producers.
critical_rf=3
critical_min_isr=2
default_rf=2
default_min_isr=1
if (( running_brokers < critical_rf )); then
  critical_rf=$running_brokers
  critical_min_isr=1
fi
if (( running_brokers < default_rf )); then
  default_rf=$running_brokers
fi

# Match by prefix; rest default to RF=2 when enough brokers exist.
is_critical() {
  case "$1" in
    fern.finance.*|fern.procurement.*|fern.audit.*|fern.payroll.*|fern.sales.*|fern.outbox.*) return 0 ;;
    *) return 1 ;;
  esac
}

for entry in "${FERN_KAFKA_TOPICS[@]}"; do
  IFS='|' read -r topic partitions <<<"$entry"
  if is_critical "$topic"; then
    rf=$critical_rf
    min_isr=$critical_min_isr
  else
    rf=$default_rf
    min_isr=$default_min_isr
  fi
  if compose exec -T "$exec_target" /usr/bin/kafka-topics \
    --bootstrap-server "$bootstrap_server" \
    --create \
    --if-not-exists \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor "$rf" \
    --config "min.insync.replicas=${min_isr}" >/dev/null 2>&1; then
    printf '  + topic ready: %s (rf=%s min-isr=%s)\n' "$topic" "$rf" "$min_isr"
  else
    printf '  ! topic check failed: %s\n' "$topic"
  fi
done
