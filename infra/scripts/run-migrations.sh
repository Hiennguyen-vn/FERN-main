#!/usr/bin/env bash
# run-migrations.sh — Run Flyway DB migrations for FERN.
# Requires env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── 1. Check psql available ───────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  error "psql not found. Install postgresql-client before running migrations."
  exit 1
fi
info "psql found: $(psql --version)"

# ── 2. DB connection from environment ────────────────────────────────────────
DB_HOST="${DB_HOST:?DB_HOST env var is required}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:?DB_NAME env var is required}"
DB_USER="${DB_USER:?DB_USER env var is required}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD env var is required}"

export PGPASSWORD="$DB_PASSWORD"

info "Using DB: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Quick connectivity check
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c '\q' &>/dev/null; then
  error "Cannot connect to PostgreSQL at ${DB_HOST}:${DB_PORT}/${DB_NAME} as ${DB_USER}."
  exit 1
fi
info "Database connection OK."

# ── 3. pg_partman warning ─────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}════════════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW} WARNING: V23 requires the pg_partman extension.${NC}"
echo -e "${YELLOW}${NC}"
echo -e "${YELLOW} Run the following as a PostgreSQL superuser BEFORE continuing:${NC}"
echo -e "${YELLOW}${NC}"
echo -e "${YELLOW}   CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;${NC}"
echo -e "${YELLOW}${NC}"
echo -e "${YELLOW} See infra/scripts/dba-setup.sql for the full DBA pre-flight script.${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ── 4. Confirm pg_partman installed ──────────────────────────────────────────
read -r -p "Have you confirmed pg_partman is installed? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  warn "Aborted. Run dba-setup.sql first, then retry."
  exit 1
fi

# Double-check via psql
PARTMAN_INSTALLED=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_partman';")
if [[ "$PARTMAN_INSTALLED" -eq 0 ]]; then
  error "pg_partman extension is NOT installed in database '${DB_NAME}'."
  error "Run: CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;"
  exit 1
fi
info "pg_partman extension confirmed present."

# ── 5. Run Flyway migrations ──────────────────────────────────────────────────
cd "$REPO_ROOT"

FLYWAY_PROPS=(
  "-Dflyway.url=jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}"
  "-Dflyway.user=${DB_USER}"
  "-Dflyway.password=${DB_PASSWORD}"
)

if [[ -f "${REPO_ROOT}/db/pom.xml" ]]; then
  info "Found db/pom.xml — running: mvn -pl db flyway:migrate"
  mvn -pl db flyway:migrate "${FLYWAY_PROPS[@]}"
else
  # Fall back: sales-service carries the migration scripts
  info "No db/pom.xml found — running flyway:migrate via sales-service module."
  mvn -pl sales-service flyway:migrate "${FLYWAY_PROPS[@]}"
fi

# ── 6. Print migration status ─────────────────────────────────────────────────
echo ""
info "Migration complete. Fetching status..."
if [[ -f "${REPO_ROOT}/db/pom.xml" ]]; then
  mvn -pl db flyway:info "${FLYWAY_PROPS[@]}" 2>/dev/null || true
else
  mvn -pl sales-service flyway:info "${FLYWAY_PROPS[@]}" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}All migrations applied successfully.${NC}"
