#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

"$SCRIPT_DIR/reset.sh"

cd "$ROOT_DIR/infra"
docker compose run --rm -T db-tools psql -v ON_ERROR_STOP=1 -f /workspace/db/tests/run_all.sql
