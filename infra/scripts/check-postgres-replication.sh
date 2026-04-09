#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

WAIT_SECONDS=0
PROBE=false

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/check-postgres-replication.sh [--wait SECONDS] [--probe]

Options:
  --wait SECONDS  Poll until replication is healthy or the timeout elapses.
  --probe         Perform a real primary-write / replica-read verification.
  -h, --help      Show this help text.

Notes:
  - FERN uses one-way PostgreSQL physical streaming replication: primary -> replica.
  - The replica is read-only by design and does not sync back to the primary.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    --probe)
      PROBE=true
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

db_exec_psql() {
  local target="${1:?target is required}"
  local sql="${2:?sql is required}"
  local service
  service="$(db_host_for_target "$target")"
  compose exec -T \
    -e PGPASSWORD="${POSTGRES_PASSWORD:-fern}" \
    "$service" \
    psql -U "${POSTGRES_USER:-fern}" -d "${POSTGRES_DB:-fern}" -Atqc "$sql"
}

trim_output() {
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

read_value() {
  local target="${1:?target is required}"
  local sql="${2:?sql is required}"
  local raw
  raw="$(db_exec_psql "$target" "$sql")" || return 1
  trim_output "$raw"
}

print_status() {
  local primary_recovery="$1"
  local replica_recovery="$2"
  local sender_count="$3"
  local receiver_status="$4"
  local current_wal_lsn="$5"
  local receive_lsn="$6"
  local replay_lsn="$7"
  local replay_lag_bytes="$8"
  local replay_timestamp="$9"
  local replay_age_seconds="${10}"

  echo "PostgreSQL replication:"
  echo "  Model                 primary -> replica physical streaming"
  echo "  Primary recovery      ${primary_recovery}"
  echo "  Replica recovery      ${replica_recovery}"
  echo "  WAL senders           ${sender_count}"
  echo "  WAL receiver          ${receiver_status}"
  echo "  Primary current LSN   ${current_wal_lsn}"
  echo "  Replica receive LSN   ${receive_lsn}"
  echo "  Replica replay LSN    ${replay_lsn}"
  echo "  Replay lag bytes      ${replay_lag_bytes}"
  echo "  Last replay time      ${replay_timestamp}"
  echo "  Seconds since replay  ${replay_age_seconds}"
}

probe_replication() {
  local note="$1"

  db_exec_psql primary "
    CREATE TABLE IF NOT EXISTS core.replication_probe (
      id BIGSERIAL PRIMARY KEY,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO core.replication_probe(note) VALUES ('${note}');
  " >/dev/null

  local deadline=$((SECONDS + 40))
  while (( SECONDS < deadline )); do
    if [[ "$(db_exec_psql replica "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'core' AND table_name = 'replication_probe';" | tr -d '[:space:]')" == "1" ]]; then
      local count
      count="$(db_exec_psql replica "SELECT COUNT(*) FROM core.replication_probe WHERE note = '${note}';" | tr -d '[:space:]')"
      if [[ "$count" == "1" ]]; then
        echo "  Probe                 replicated note '${note}'"
        return 0
      fi
    fi
    sleep 1
  done

  echo "  Probe                 missing note '${note}' on replica" >&2
  return 1
}

check_once() {
  local primary_recovery
  local replica_recovery
  local sender_count
  local receiver_status
  local current_wal_lsn
  local receive_lsn
  local replay_lsn
  local replay_lag_bytes
  local replay_timestamp
  local replay_age_seconds

  primary_recovery="$(read_value primary "SELECT pg_is_in_recovery();")" || return 1
  replica_recovery="$(read_value replica "SELECT pg_is_in_recovery();")" || return 1
  sender_count="$(read_value primary "SELECT COUNT(*) FROM pg_stat_replication;")" || return 1
  receiver_status="$(read_value replica "SELECT COALESCE((SELECT status FROM pg_stat_wal_receiver LIMIT 1), 'stopped');")" || return 1
  current_wal_lsn="$(read_value primary "SELECT pg_current_wal_lsn()::text;")" || return 1
  receive_lsn="$(read_value replica "SELECT COALESCE(pg_last_wal_receive_lsn()::text, 'null');")" || return 1
  replay_lsn="$(read_value replica "SELECT COALESCE(pg_last_wal_replay_lsn()::text, 'null');")" || return 1
  if [[ ! "$replay_lsn" =~ ^[0-9A-F]+/[0-9A-F]+$ ]]; then
    replay_lag_bytes="null"
  else
    replay_lag_bytes="$(read_value primary "SELECT pg_wal_lsn_diff('${current_wal_lsn}', '${replay_lsn}')::bigint::text;")" || return 1
  fi
  replay_timestamp="$(read_value replica "SELECT COALESCE(pg_last_xact_replay_timestamp()::text, 'null');")" || return 1
  replay_age_seconds="$(read_value replica "SELECT COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp()))::text, 'null');")" || return 1

  print_status \
    "$primary_recovery" \
    "$replica_recovery" \
    "$sender_count" \
    "$receiver_status" \
    "$current_wal_lsn" \
    "$receive_lsn" \
    "$replay_lsn" \
    "$replay_lag_bytes" \
    "$replay_timestamp" \
    "$replay_age_seconds"

  if [[ "$primary_recovery" != "f" ]]; then
    echo "Primary is unexpectedly in recovery mode." >&2
    return 1
  fi
  if [[ "$replica_recovery" != "t" ]]; then
    echo "Replica is not in recovery mode; it is not acting as a standby." >&2
    return 1
  fi
  if [[ "$sender_count" -lt 1 ]]; then
    echo "Primary has no active WAL sender connection." >&2
    return 1
  fi
  if [[ "$receiver_status" != "streaming" ]]; then
    echo "Replica WAL receiver is not streaming." >&2
    return 1
  fi

  if $PROBE; then
    local note="probe-$(timestamp_utc)-$$"
    probe_replication "$note" || return 1
  fi

  return 0
}

if [[ "$WAIT_SECONDS" == "0" ]]; then
  check_once
  exit $?
fi

deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  if check_once; then
    exit 0
  fi
  sleep 2
  echo ""
done

echo "Timed out waiting for PostgreSQL replication to become healthy." >&2
exit 1
