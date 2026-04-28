#!/usr/bin/env bash
# Configure Vault database secrets engine for short-lived Postgres credentials.
#
# Required env:
#   VAULT_POSTGRES_ADMIN_USERNAME
#   VAULT_POSTGRES_ADMIN_PASSWORD
#
# Optional env:
#   VAULT_ADDR=http://localhost:8200
#   VAULT_TOKEN=...
#   VAULT_DATABASE_BACKEND=database
#   VAULT_POSTGRES_CONNECTION_URL='postgresql://{{username}}:{{password}}@postgres:5432/fern?sslmode=disable'
#   VAULT_DB_DEFAULT_TTL=1h
#   VAULT_DB_MAX_TTL=4h
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-${VAULT_DEV_TOKEN:-fern-dev-root}}"
VAULT_DATABASE_BACKEND="${VAULT_DATABASE_BACKEND:-database}"
VAULT_DB_DEFAULT_TTL="${VAULT_DB_DEFAULT_TTL:-1h}"
VAULT_DB_MAX_TTL="${VAULT_DB_MAX_TTL:-4h}"
VAULT_POSTGRES_HOST="${VAULT_POSTGRES_HOST:-${POSTGRES_HOST:-localhost}}"
VAULT_POSTGRES_PORT="${VAULT_POSTGRES_PORT:-${POSTGRES_PORT:-5432}}"
VAULT_POSTGRES_DB="${VAULT_POSTGRES_DB:-${POSTGRES_DB:-fern}}"
VAULT_POSTGRES_SSLMODE="${VAULT_POSTGRES_SSLMODE:-disable}"
VAULT_POSTGRES_CONNECTION_URL="${VAULT_POSTGRES_CONNECTION_URL:-postgresql://{{username}}:{{password}}@${VAULT_POSTGRES_HOST}:${VAULT_POSTGRES_PORT}/${VAULT_POSTGRES_DB}?sslmode=${VAULT_POSTGRES_SSLMODE}}"

: "${VAULT_POSTGRES_ADMIN_USERNAME:?VAULT_POSTGRES_ADMIN_USERNAME is required}"
: "${VAULT_POSTGRES_ADMIN_PASSWORD:?VAULT_POSTGRES_ADMIN_PASSWORD is required}"

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

echo "Enabling database secrets engine at ${VAULT_DATABASE_BACKEND}/ (idempotent)"
vault_cmd secrets enable -path="${VAULT_DATABASE_BACKEND}" database 2>/dev/null || true

echo "Writing Postgres connection config"
vault_cmd write "${VAULT_DATABASE_BACKEND}/config/fern-postgres" \
  plugin_name=postgresql-database-plugin \
  allowed_roles="$(IFS=,; printf 'fern-%s' "${SERVICES[0]}"; for service in "${SERVICES[@]:1}"; do printf ',fern-%s' "${service}"; done)" \
  connection_url="${VAULT_POSTGRES_CONNECTION_URL}" \
  username="${VAULT_POSTGRES_ADMIN_USERNAME}" \
  password="${VAULT_POSTGRES_ADMIN_PASSWORD}" \
  password_authentication="scram-sha-256"

creation_sql='CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '"'"'{{password}}'"'"' VALID UNTIL '"'"'{{expiration}}'"'"' IN ROLE fern_app;'
revocation_sql='ALTER ROLE "{{name}}" NOLOGIN; DROP ROLE IF EXISTS "{{name}}";'

for service in "${SERVICES[@]}"; do
  role="fern-${service}"
  echo "Writing DB role ${role}"
  vault_cmd write "${VAULT_DATABASE_BACKEND}/roles/${role}" \
    db_name=fern-postgres \
    creation_statements="${creation_sql}" \
    revocation_statements="${revocation_sql}" \
    default_ttl="${VAULT_DB_DEFAULT_TTL}" \
    max_ttl="${VAULT_DB_MAX_TTL}" >/dev/null
done

cat <<EOF
Vault Postgres dynamic credentials are configured.

Manual verification:
  vault read ${VAULT_DATABASE_BACKEND}/creds/fern-sales-service

Service config:
  VAULT_DATABASE_ENABLED=true
  VAULT_DATABASE_BACKEND=${VAULT_DATABASE_BACKEND}
  VAULT_DATABASE_ROLE=fern-<service-name>

Spring Cloud Vault maps the generated username/password into:
  dependencies.postgres.username
  dependencies.postgres.password
EOF
