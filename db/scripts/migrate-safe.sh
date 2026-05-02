#!/usr/bin/env bash
# Migration safety wrapper — lint + dry-run on clone before applying to target.
# Usage:
#   migrate-safe.sh --lint           # CI: lint migrations only, no DB needed
#   migrate-safe.sh <env>            # dry-run on $PG_DRYRUN_URL
#   migrate-safe.sh <env> --apply    # dry-run + apply to $PG_PRIMARY_URL
set -euo pipefail

MODE="${1:-dev}"
APPLY="${2:-}"
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
MIGRATIONS_DIR="$ROOT_DIR/migrations"

echo "[1/3] Lint migrations in $MIGRATIONS_DIR …"
fail=0
# In CI lint mode, restrict to git-changed migrations to grandfather legacy migrations.
# Override with LINT_ALL=1 to scan everything.
if [[ "$MODE" == "--lint" && "${LINT_ALL:-0}" != "1" ]]; then
  changed=$(git diff --name-only --diff-filter=AM origin/main...HEAD -- "$MIGRATIONS_DIR" 2>/dev/null \
            || git diff --name-only --diff-filter=AM HEAD~1 -- "$MIGRATIONS_DIR" 2>/dev/null \
            || true)
  if [[ -z "$changed" ]]; then
    echo "  (no changed migrations vs origin/main; lint skipped)"
    echo "✓ lint-only mode passed (no DB required)"
    exit 0
  fi
  files=$(echo "$changed" | sed "s|^|$ROOT_DIR/../|")
else
  files=$(ls "$MIGRATIONS_DIR"/*.sql)
fi
for f in $files; do
  [[ -f "$f" ]] || continue
  base=$(basename "$f")
  if grep -qiE 'ALTER TABLE [^;]+ADD COLUMN [^;]+NOT NULL DEFAULT' "$f" \
      && ! grep -q '@allow-nn-default-rewrite' "$f"; then
    echo "FAIL $base — NOT NULL DEFAULT on ALTER TABLE (table-rewrite hazard); add @allow-nn-default-rewrite to override."
    fail=1
  fi
  if grep -qiE 'CREATE INDEX' "$f" \
      && ! grep -qi 'CREATE INDEX CONCURRENTLY\|CREATE UNIQUE INDEX CONCURRENTLY' "$f" \
      && ! grep -q '@allow-blocking-index' "$f"; then
    echo "WARN $base — CREATE INDEX without CONCURRENTLY (table lock); add @allow-blocking-index if intended."
  fi
done
[[ $fail -eq 0 ]] || exit 2

if [[ "$MODE" == "--lint" ]]; then
  echo "✓ lint-only mode passed (no DB required)"
  exit 0
fi

ENV="$MODE"
: "${PG_PRIMARY_URL:?PG_PRIMARY_URL must be set (target DB JDBC URL)}"
: "${PG_DRYRUN_URL:?PG_DRYRUN_URL must be set (clone DB JDBC URL)}"

echo "[2/3] Dry-run on clone …"
flyway -url="$PG_DRYRUN_URL" -locations="filesystem:$MIGRATIONS_DIR" \
       -outOfOrder=false -validateOnMigrate=true migrate

if [[ "$APPLY" != "--apply" ]]; then
  echo "[3/3] Dry-run passed. Re-run with --apply to migrate target."
  exit 0
fi

echo "[3/3] Applying to $ENV target …"
flyway -url="$PG_PRIMARY_URL" -locations="filesystem:$MIGRATIONS_DIR" \
       -outOfOrder=false -validateOnMigrate=true migrate
echo "✓ migration applied to $ENV"
