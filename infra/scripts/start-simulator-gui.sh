#!/bin/bash
# =============================================================
# FERN Data Simulator — GUI Launcher
# =============================================================
# Launches the web-based GUI dashboard at http://localhost:4567
# Reads DB credentials from infra/.env automatically.
#
# Usage:
#   ./start-simulator-gui.sh              # default port 4567
#   ./start-simulator-gui.sh --port 8080  # custom port
#   ./start-simulator-gui.sh --rebuild    # force rebuild first
#   ./start-simulator-gui.sh --no-browser # don't auto-open browser
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
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Load credentials from infra/.env ---
if [ -f "$ENV_FILE" ]; then
    info "Loading credentials from ${CYAN}infra/.env${NC}"
    while IFS='=' read -r key value; do
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        export "$key=$value" 2>/dev/null || true
    done < "$ENV_FILE"
else
    warn ".env file not found at ${ENV_FILE} — using defaults"
fi

# --- Resolve DB connection ---
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-fern}"
DB_USER="${POSTGRES_USER:-fern}"
DB_PASS="${POSTGRES_PASSWORD:-fern}"
DB_URL="jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}"

# --- Parse arguments ---
REBUILD=false
PORT=4567
NO_BROWSER=false
for arg in "$@"; do
    case "$arg" in
        --rebuild)    REBUILD=true ;;
        --no-browser) NO_BROWSER=true ;;
        --port)       ;; # handled below
        *)
            # Check if previous arg was --port
            if [[ "${PREV_ARG:-}" == "--port" ]]; then
                PORT="$arg"
            fi
            ;;
    esac
    PREV_ARG="$arg"
done

# --- Check Docker DB is running ---
if command -v docker &>/dev/null; then
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "fern.*postgres\|postgres.*fern"; then
        warn "PostgreSQL container may not be running. Start it with:"
        echo -e "  ${CYAN}cd infra && docker compose up -d postgres${NC}"
        echo
    fi
fi

# --- Build if needed ---
if [ ! -f "$JAR_PATH" ] || [ "$REBUILD" = true ]; then
    if [ "$REBUILD" = true ]; then
        info "Rebuild requested — building fat JAR..."
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

# --- Launch ---
echo
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║    🌿 FERN Data Simulator — GUI Dashboard   ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo
info "DB URL    : ${DB_URL}"
info "DB User   : ${DB_USER}"
info "Dashboard : ${BOLD}http://localhost:${PORT}${NC}"
echo
info "Press ${BOLD}Ctrl+C${NC} to stop the server."
echo

GUI_ARGS=(gui --port "$PORT")
if [ "$NO_BROWSER" = true ]; then
    GUI_ARGS+=(--no-browser)
fi

exec java \
    -Xmx512m \
    -jar "$JAR_PATH" \
    --db-url "${DB_URL}" \
    --db-user "${DB_USER}" \
    --db-password "${DB_PASS}" \
    "${GUI_ARGS[@]}"
