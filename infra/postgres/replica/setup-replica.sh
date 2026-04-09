#!/usr/bin/env bash
set -euo pipefail

export PGDATA="${PGDATA:-/var/lib/postgresql/data/pgdata}"
POSTGRES_REPLICATION_SLOT="${POSTGRES_REPLICATION_SLOT:-fern_replica_slot}"
POSTGRES_REPLICA_FORCE_RESEED="${POSTGRES_REPLICA_FORCE_RESEED:-false}"
mkdir -p "${PGDATA}"
chown -R postgres:postgres "$(dirname "${PGDATA}")"

upsert_auto_conf() {
  local key="$1"
  local value="$2"
  local auto_conf="${PGDATA}/postgresql.auto.conf"
  touch "$auto_conf"
  sed -i'' -e "/^${key}[[:space:]]*=/d" "$auto_conf"
  printf "%s = %s\n" "$key" "$value" >> "$auto_conf"
}

ensure_primary_ready() {
  until pg_isready -h postgres -p 5432 -U "${POSTGRES_USER}" >/dev/null 2>&1; do
    sleep 2
  done
}

ensure_replication_slot() {
  export PGPASSWORD="${POSTGRES_PASSWORD}"
  psql \
    -h postgres \
    -p 5432 \
    -U "${POSTGRES_USER}" \
    -d postgres \
    -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '${POSTGRES_REPLICATION_SLOT}') THEN
    PERFORM pg_create_physical_replication_slot('${POSTGRES_REPLICATION_SLOT}');
  END IF;
END
\$\$;
SQL
}

seed_replica() {
  rm -rf "${PGDATA:?}"/*
  ensure_primary_ready
  ensure_replication_slot
  export PGPASSWORD="${POSTGRES_REPLICATION_PASSWORD}"
  pg_basebackup \
    -h postgres \
    -p 5432 \
    -U "${POSTGRES_REPLICATION_USER}" \
    -D "${PGDATA}" \
    -Fp \
    -Xs \
    --slot="${POSTGRES_REPLICATION_SLOT}" \
    -P \
    -R
  cp /etc/postgresql/pg_hba.conf "${PGDATA}/pg_hba.conf"
  chown -R postgres:postgres "${PGDATA}"
  chmod 0700 "${PGDATA}"
}

need_basebackup=false
if [[ "${POSTGRES_REPLICA_FORCE_RESEED}" == "true" ]]; then
  echo "Replica reseed forced by POSTGRES_REPLICA_FORCE_RESEED=true"
  need_basebackup=true
elif [[ ! -s "${PGDATA}/PG_VERSION" ]]; then
  echo "Replica data directory is empty; taking a fresh base backup"
  need_basebackup=true
elif [[ ! -f "${PGDATA}/standby.signal" ]]; then
  echo "Replica data directory is not configured as a standby; reseeding from primary"
  need_basebackup=true
elif ! grep -Eq "^primary_slot_name[[:space:]]*=" "${PGDATA}/postgresql.auto.conf" 2>/dev/null; then
  echo "Replica data predates slot-based replication; reseeding from primary"
  need_basebackup=true
fi

if [[ "${need_basebackup}" == "true" ]]; then
  seed_replica
fi

upsert_auto_conf "primary_slot_name" "'${POSTGRES_REPLICATION_SLOT}'"
upsert_auto_conf "hot_standby" "on"
upsert_auto_conf "shared_preload_libraries" "'pg_stat_statements'"
upsert_auto_conf "compute_query_id" "auto"
upsert_auto_conf "track_io_timing" "on"
upsert_auto_conf "pg_stat_statements.max" "10000"
upsert_auto_conf "pg_stat_statements.track" "all"
upsert_auto_conf "pg_stat_statements.save" "on"
chown postgres:postgres "${PGDATA}/postgresql.auto.conf"

exec docker-entrypoint.sh postgres
