#!/bin/bash
# =============================================================
# FERN Data Simulator — Startup Script
# =============================================================
# Local-only CLI/TUI tool for chronological data simulation.
# Builds and runs a fat JAR from the Maven reactor.
# Reads DB credentials from infra/.env automatically.
#
# Usage:
#   ./start-data-simulator.sh [subcommand] [options]
#
# Examples:
#   ./start-data-simulator.sh preview --preset small
#   ./start-data-simulator.sh execute --preset small
#   ./start-data-simulator.sh execute --preset medium --dry-run
#   ./start-data-simulator.sh execute --config ./my-config.yaml
#   ./start-data-simulator.sh cleanup --namespace SIM-SMALL --execute
#   ./start-data-simulator.sh cleanup --namespace SIM-SMALL --preview
#   ./start-data-simulator.sh cleanup --all --preview
#   ./start-data-simulator.sh cleanup --all --execute
#   ./start-data-simulator.sh runs --limit 10
#   ./start-data-simulator.sh export-users --namespace SIM-SMALL
#   ./start-data-simulator.sh --help
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${SCRIPT_DIR}/.."
PROJECT_ROOT="${INFRA_DIR}/.."
MODULE_DIR="${PROJECT_ROOT}/tools/data-simulator-app"
JAR_PATH="${MODULE_DIR}/target/data-simulator-app-0.1.0-SNAPSHOT.jar"
ENV_FILE="${INFRA_DIR}/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Load credentials from infra/.env ---
if [ -f "$ENV_FILE" ]; then
    info "Loading credentials from ${CYAN}infra/.env${NC}"
    # Source .env safely (only export known vars, skip comments/blanks)
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        # Remove surrounding quotes if present
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        export "$key=$value" 2>/dev/null || true
    done < "$ENV_FILE"
else
    warn ".env file not found at ${ENV_FILE} — using defaults"
fi

# --- Resolve DB connection from .env variables ---
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-fern}"
DB_USER="${POSTGRES_USER:-fern}"
DB_PASS="${POSTGRES_PASSWORD:-fern}"
DB_URL="jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}"

# --- Build if JAR doesn't exist or --rebuild flag passed ---
REBUILD=false
ARGS=()
for arg in "$@"; do
    if [ "$arg" = "--rebuild" ]; then
        REBUILD=true
    else
        ARGS+=("$arg")
    fi
done

if [ ! -f "$JAR_PATH" ] || [ "$REBUILD" = true ]; then
    if [ "$REBUILD" = true ]; then
        info "Rebuild requested — building..."
    else
        info "Fat JAR not found — building..."
    fi
    (cd "$PROJECT_ROOT" && mvn -pl tools/data-simulator-app -am package -DskipTests -q)
    if [ ! -f "$JAR_PATH" ]; then
        error "Build failed: JAR not found at $JAR_PATH"
        exit 1
    fi
    info "Build complete."
fi

# --- Run ---
echo
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       FERN Data Simulator — Launcher         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo
info "DB URL  : ${DB_URL}"
info "DB User : ${DB_USER}"
info "Args    : ${ARGS[*]:-<none>}"
echo

exec java \
    -Xmx512m \
    -jar "$JAR_PATH" \
    --db-url "${DB_URL}" \
    --db-user "${DB_USER}" \
    --db-password "${DB_PASS}" \
    "${ARGS[@]}"
