#!/usr/bin/env bash
# Seed dev Vault with FERN secrets. Idempotent — safe to re-run.
#
# Usage:
#   docker compose --profile secrets up -d vault
#   ./infra/scripts/vault-seed-dev.sh
#
# Prereq: vault CLI installed, or use `docker compose exec vault vault ...`.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-fern-dev-root}"

export VAULT_ADDR VAULT_TOKEN

# Pick CLI: native vault, or docker exec
if command -v vault >/dev/null 2>&1; then
  V="vault"
else
  V="docker compose exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN=${VAULT_TOKEN} vault vault"
fi

echo "→ enabling kv-v2 at kv/ (idempotent)"
$V secrets enable -path=kv -version=2 kv 2>/dev/null || true

echo "→ seeding kv/fern/shared/jwt"
JWT_SECRET="$(openssl rand -hex 64)"
$V kv put kv/fern/shared/jwt secret="${JWT_SECRET}"

echo "→ seeding kv/fern/shared/internal"
INTERNAL_TOKEN="$(openssl rand -hex 32)"
$V kv put kv/fern/shared/internal token="${INTERNAL_TOKEN}"

echo "→ seeding kv/fern/postgres/app"
$V kv put kv/fern/postgres/app user=fern_app password=fern_app

echo "→ seeding kv/fern/s3/credentials"
$V kv put kv/fern/s3/credentials access_key=minioadmin secret_key=minioadmin

echo "✓ Vault seeded. Verify:"
echo "  vault kv get kv/fern/shared/jwt"
