#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"

if [ ! -f "$INFRA_DIR/.env" ]; then
  INTERNAL_SERVICE_TOKEN=$(openssl rand -hex 32 2>/dev/null || od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  sed \
    -e "s/__GENERATE_INTERNAL_SERVICE_TOKEN__/$INTERNAL_SERVICE_TOKEN/" \
    -e "s/__GENERATE_JWT_SECRET__/$JWT_SECRET/" \
    "$INFRA_DIR/.env.example" > "$INFRA_DIR/.env"
fi

set -a
. "$INFRA_DIR/.env"
set +a

cd "$INFRA_DIR"
docker compose up -d postgres

until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

docker compose run --rm -T db-tools psql -v ON_ERROR_STOP=1 -f /workspace/db/seeds/000_baseline_seed.sql
docker compose run --rm -T db-tools psql -v ON_ERROR_STOP=1 -f /workspace/db/seeds/012_product_images_seed.sql
