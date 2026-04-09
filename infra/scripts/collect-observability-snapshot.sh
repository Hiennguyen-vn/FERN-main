#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

TAG=""

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/collect-observability-snapshot.sh [--tag NAME]

Notes:
  - Captures local observability artifacts for the running stack.
  - May start or restart postgres/postgres-replica if pg_stat_statements is not ready yet.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      TAG="${2:?missing tag}"
      shift 2
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
load_test_env
load_manifest
ensure_runtime_dirs
require_docker_daemon

echo "Ensuring pg_stat_statements is ready. This may start or restart postgres containers if needed."
ensure_pg_stat_statements_ready
compose up -d kafka >/dev/null
wait_for_compose_health kafka 120 >/dev/null

snapshot_name="${TAG:-snapshot-$(timestamp_utc)}"
output_dir="${INFRA_LOG_DIR}/observability/${snapshot_name}"
ensure_dir "$output_dir"

save_query() {
  local target="$1"
  local sql="$2"
  local file="$3"
  db_tools_psql "$target" -F $'\t' -Atqc "$sql" >"$file"
}

save_query primary \
  "SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';" \
  "${output_dir}/primary_extensions.tsv"

save_query primary \
  "SELECT calls, round(total_exec_time::numeric, 3), rows, shared_blks_hit, shared_blks_read, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;" \
  "${output_dir}/primary_pg_stat_statements.tsv"

save_query replica \
  "SELECT calls, round(total_exec_time::numeric, 3), rows, shared_blks_hit, shared_blks_read, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;" \
  "${output_dir}/replica_pg_stat_statements.tsv"

save_query primary \
  "SELECT relname, seq_scan, idx_scan, n_live_tup, n_dead_tup FROM pg_stat_user_tables ORDER BY relname;" \
  "${output_dir}/primary_table_stats.tsv"

save_query primary \
  "SELECT relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY relname, indexrelname;" \
  "${output_dir}/primary_index_stats.tsv"

save_query replica \
  "SELECT now() AS captured_at, pg_last_wal_receive_lsn() AS receive_lsn, pg_last_wal_replay_lsn() AS replay_lsn, now() - pg_last_xact_replay_timestamp() AS replay_delay;" \
  "${output_dir}/replica_lag.tsv"

control_plane_health_url="http://127.0.0.1:${MASTER_NODE_PORT:-8082}/api/v1/control/health/system"
if [[ "$(http_code "$control_plane_health_url")" == "200" ]]; then
  curl -sS "$control_plane_health_url" > "${output_dir}/control_plane_health.json" || true
fi

for record in "${FERN_LOCAL_SERVICE_ORDER[@]}"; do
  name="$(record_field "$record" 0)"
  metrics_url="$(service_url "$name")/actuator/prometheus"
  out_file="${output_dir}/${name}_prometheus.txt"
  metrics_status="$(http_code "$metrics_url")"
  if [[ "$metrics_status" == "200" ]]; then
    curl -sS "$metrics_url" >"$out_file" || true
  else
    printf 'UNAVAILABLE status=%s url=%s\n' "${metrics_status:-000}" "$metrics_url" >"$out_file"
  fi
done

compose exec -T kafka /usr/bin/kafka-topics --bootstrap-server kafka:29092 --list >"${output_dir}/kafka_topics.txt" 2>/dev/null || true
compose exec -T kafka /usr/bin/kafka-consumer-groups --bootstrap-server kafka:29092 --all-groups --describe >"${output_dir}/kafka_consumer_groups.txt" 2>/dev/null || true

print_banner "FERN Observability Snapshot"
echo "  output dir : ${output_dir}"
