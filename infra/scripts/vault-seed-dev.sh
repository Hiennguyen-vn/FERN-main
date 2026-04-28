#!/usr/bin/env bash
# Seed local/dev Vault with FERN KV secrets, policies, and AppRole roles.
#
# Usage from repo root:
#   docker compose -f infra/docker-compose.yml --profile secrets up -d vault
#   ./infra/scripts/vault-seed-dev.sh
#
# Prereq: vault CLI installed, or use the compose Vault container.
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-${VAULT_DEV_TOKEN:-fern-dev-root}}"
CREATE_SECRET_IDS="${CREATE_SECRET_IDS:-true}"
VAULT_DATABASE_BACKEND="${VAULT_DATABASE_BACKEND:-database}"

export VAULT_ADDR VAULT_TOKEN

SERVICES=(
  gateway
  auth-service
  master-node
  org-service
  hr-service
  product-service
  procurement-service
  sales-service
  inventory-service
  payroll-service
  finance-service
  audit-service
  report-service
)

vault_cmd() {
  if command -v vault >/dev/null 2>&1; then
    vault "$@"
  else
    docker compose -f infra/docker-compose.yml exec \
      -e VAULT_ADDR=http://127.0.0.1:8200 \
      -e VAULT_TOKEN="${VAULT_TOKEN}" \
      vault vault "$@"
  fi
}

echo "Enabling kv-v2 at kv/ (idempotent)"
vault_cmd secrets enable -path=kv -version=2 kv 2>/dev/null || true

echo "Seeding shared Spring properties in kv/fern/shared"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 64)}"
INTERNAL_TOKEN="${INTERNAL_SERVICE_TOKEN:-$(openssl rand -hex 32)}"
vault_cmd kv put kv/fern/shared \
  "jwt.secret=${JWT_SECRET}" \
  "internal.service.token=${INTERNAL_TOKEN}" \
  "internal.service.allowlist=$(IFS=,; echo "${SERVICES[*]}")"

echo "Seeding legacy dev-only KV paths for manual inspection"
vault_cmd kv put kv/fern/shared/jwt secret="${JWT_SECRET}"
vault_cmd kv put kv/fern/shared/internal token="${INTERNAL_TOKEN}"
vault_cmd kv put kv/fern/postgres/app username="${POSTGRES_APP_USER:-fern_app}" password="${POSTGRES_APP_PASSWORD:-fern_app}"
vault_cmd kv put kv/fern/s3/credentials access_key="${S3_ACCESS_KEY:-minioadmin}" secret_key="${S3_SECRET_KEY:-minioadmin}"

echo "Enabling AppRole auth (idempotent)"
vault_cmd auth enable approle 2>/dev/null || true

for service in "${SERVICES[@]}"; do
  policy="fern-${service}"
  policy_file="infra/vault/policies/${policy}.hcl"
  if [[ ! -f "${policy_file}" ]]; then
    echo "Missing policy file: ${policy_file}" >&2
    exit 1
  fi

  echo "Writing policy and AppRole for ${service}"
  vault_cmd policy write "${policy}" "${policy_file}"
  vault_cmd write "auth/approle/role/${policy}" \
    token_policies="${policy}" \
    token_ttl="${VAULT_APPROLE_TOKEN_TTL:-1h}" \
    token_max_ttl="${VAULT_APPROLE_TOKEN_MAX_TTL:-4h}" \
    secret_id_ttl="${VAULT_APPROLE_SECRET_ID_TTL:-24h}" \
    secret_id_num_uses="${VAULT_APPROLE_SECRET_ID_NUM_USES:-0}" >/dev/null

  role_id="$(vault_cmd read -field=role_id "auth/approle/role/${policy}/role-id")"
  echo "  ${service} VAULT_ROLE_ID=${role_id}"
  if [[ "${CREATE_SECRET_IDS}" == "true" ]]; then
    secret_id="$(vault_cmd write -field=secret_id -f "auth/approle/role/${policy}/secret-id")"
    echo "  ${service} VAULT_SECRET_ID=${secret_id}"
  fi
done

cat <<EOF
Vault dev seed complete.

Runtime modes:
  Disabled fallback: VAULT_ENABLED=false and env POSTGRES_APP_USER/POSTGRES_APP_PASSWORD/JWT_SECRET/INTERNAL_SERVICE_TOKEN set.
  Dev token:         VAULT_ENABLED=true VAULT_AUTHENTICATION=TOKEN VAULT_TOKEN=${VAULT_TOKEN}
  AppRole:           VAULT_ENABLED=true VAULT_AUTHENTICATION=APPROLE VAULT_ROLE_ID=... VAULT_SECRET_ID=...

Dynamic DB creds are configured separately:
  ./infra/scripts/vault-enable-postgres-dynamic-creds.sh
  VAULT_DATABASE_ENABLED=true VAULT_DATABASE_BACKEND=${VAULT_DATABASE_BACKEND}
EOF
