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
load_test_env
load_manifest
ensure_runtime_dirs
require_cmd java
require_cmd mvn
require_cmd npm
require_cmd rsync

FRONTEND_TARGET_DIR="${FRONTEND_TARGET_DIR:-/var/www/fern}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://fern.io.vn}"

print_banner "FERN Production Deploy - Build backend"
(
  cd "$ROOT_DIR"
  MODULE_LIST="$(IFS=,; printf '%s' "${FERN_MAVEN_BUILD_MODULES[*]}")"
  mvn -B -pl "$MODULE_LIST" -am -DskipTests package
)

print_banner "FERN Production Deploy - Build frontend"
(
  cd "${ROOT_DIR}/frontend"
  npm ci
  npm run build
)

print_banner "FERN Production Deploy - Run database migrations"
bash "${SCRIPT_DIR}/run-migrations.sh"

print_banner "FERN Production Deploy - Publish frontend"
mkdir -p "$FRONTEND_TARGET_DIR"
rsync -a --delete "${ROOT_DIR}/frontend/dist/" "${FRONTEND_TARGET_DIR}/"

print_banner "FERN Production Deploy - Restart services"
bash "${SCRIPT_DIR}/restart-services.sh" --skip-build

print_banner "FERN Production Deploy - Verify public health"
curl -fsS "http://127.0.0.1:${GATEWAY_PORT:-8080}/health/live" >/dev/null
curl -fsSI "${PUBLIC_BASE_URL}/login" >/dev/null

echo "Deploy completed: ${PUBLIC_BASE_URL}"
