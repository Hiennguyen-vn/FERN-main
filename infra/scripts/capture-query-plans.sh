#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
if shopt -oq posix 2>/dev/null; then
  exec bash "$0" "$@"
fi

set -euo pipefail

TARGET="both"
SCOPE="all"
SEED_DATA=false
OUTPUT_DIR=""

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/capture-query-plans.sh [--target primary|replica|both] [--scope all|report|sales|procurement|inventory|finance|control-plane] [--seed] [--output-dir PATH]

Notes:
  --seed is destructive. It resets the local workflow database before collecting plans.
  Ensuring pg_stat_statements is ready may start or restart postgres containers.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?missing target}"
      shift 2
      ;;
    --scope)
      SCOPE="${2:?missing scope}"
      shift 2
      ;;
    --seed)
      SEED_DATA=true
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?missing output dir}"
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
ensure_runtime_dirs
require_docker_daemon

case "$TARGET" in
  primary|replica|both) ;;
  *)
    fail "Unsupported target: $TARGET"
    ;;
esac

case "$SCOPE" in
  all|report|sales|procurement|inventory|finance|control-plane) ;;
  *)
    fail "Unsupported scope: $SCOPE"
    ;;
esac

if $SEED_DATA; then
  bash "${SCRIPT_DIR}/seed-workflow-data.sh"
fi

echo "Ensuring pg_stat_statements is ready before capturing plans."
ensure_pg_stat_statements_ready

run_timestamp="$(timestamp_utc)"
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${INFRA_LOG_DIR}/query-plans/${run_timestamp}"
fi

filter_for_scope() {
  local file_name="$1"
  case "$SCOPE" in
    all)
      return 0
      ;;
    report)
      [[ "$file_name" == *report* ]]
      ;;
    sales)
      [[ "$file_name" == *sales* ]]
      ;;
    procurement)
      [[ "$file_name" == *procurement* ]]
      ;;
    inventory)
      [[ "$file_name" == *inventory* || "$file_name" == *low_stock* ]]
      ;;
    finance)
      [[ "$file_name" == *finance* ]]
      ;;
    control-plane)
      [[ "$file_name" == *control_plane* ]]
      ;;
  esac
}

capture_for_target() {
  local db_target="$1"
  local target_dir="${OUTPUT_DIR}/${db_target}"
  ensure_dir "$target_dir"

  local file
  while IFS= read -r file; do
    local name
    name="$(basename "$file")"
    if ! filter_for_scope "$name"; then
      continue
    fi
    local output_file="${target_dir}/${name%.sql}.plan.txt"
    local stderr_file="${target_dir}/${name%.sql}.stderr.txt"
    echo "Capturing ${db_target} plan: ${name}"
    if ! db_tools_psql "$db_target" -v ON_ERROR_STOP=1 -f "/workspace/db/query-plans/${name}" >"$output_file" 2>"$stderr_file"; then
      fail "Query plan capture failed for ${db_target}:${name}. See ${stderr_file}."
      return 1
    fi
    if [[ ! -s "$stderr_file" ]]; then
      rm -f "$stderr_file"
    fi
  done < <(find "${ROOT_DIR}/db/query-plans" -maxdepth 1 -type f -name '*.sql' | sort)
}

print_banner "FERN Query Plan Capture"
echo "  scope      : ${SCOPE}"
echo "  target     : ${TARGET}"
echo "  output dir : ${OUTPUT_DIR}"

if [[ "$TARGET" == "both" || "$TARGET" == "primary" ]]; then
  capture_for_target primary
fi

if [[ "$TARGET" == "both" || "$TARGET" == "replica" ]]; then
  capture_for_target replica
fi

echo ""
echo "Query plans saved under ${OUTPUT_DIR}"
