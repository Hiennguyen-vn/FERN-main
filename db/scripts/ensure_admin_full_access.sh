#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"

USERNAME="admin"
PASSWORD="123123132"
FULL_NAME=""
EMPLOYEE_CODE=""
EMAIL=""
USER_ID=""

usage() {
  cat <<'EOF'
Usage: ./db/scripts/ensure_admin_full_access.sh [options]

Creates or updates an admin-capable account in PostgreSQL and grants:
  - every current role at every non-deleted outlet
  - every current direct permission at every non-deleted outlet

Options:
  --username USERNAME         Login username. Default: admin.root
  --password PASSWORD         Plaintext password. Required when creating a new user.
  --full-name FULL_NAME       Full name. Used on create, optional on update.
  --employee-code CODE        Employee code. Optional; defaults on create to GLOBAL-ADMIN-{user_id}.
  --email EMAIL               Email address. Optional.
  --user-id ID                BIGINT user id for new-user creation. Optional.
  -h, --help                  Show this help.

Examples:
  ./db/scripts/ensure_admin_full_access.sh --username root.admin --password 'StrongPass#2026'
  ./db/scripts/ensure_admin_full_access.sh --username workflow.admin --password 'NewPass#2026'
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --username)
      USERNAME=${2:?missing value for --username}
      shift 2
      ;;
    --password)
      PASSWORD=${2:?missing value for --password}
      shift 2
      ;;
    --full-name)
      FULL_NAME=${2:?missing value for --full-name}
      shift 2
      ;;
    --employee-code)
      EMPLOYEE_CODE=${2:?missing value for --employee-code}
      shift 2
      ;;
    --email)
      EMAIL=${2:?missing value for --email}
      shift 2
      ;;
    --user-id)
      USER_ID=${2:?missing value for --user-id}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

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

if [ -z "$USER_ID" ]; then
  USER_ID=$(python3 - <<'PY'
import time
print(900000000000000 + int(time.time() * 1000))
PY
)
fi

PASSWORD_HASH=""
if [ -n "$PASSWORD" ]; then
  PASSWORD_HASH=$(python3 - "$PASSWORD" <<'PY'
import base64
import hashlib
import os
import sys

password = sys.argv[1].encode("utf-8")
salt = os.urandom(16)
digest = hashlib.pbkdf2_hmac("sha256", password, salt, 65536, dklen=32)
print(base64.b64encode(salt).decode("ascii") + ":" + base64.b64encode(digest).decode("ascii"))
PY
)
fi

cd "$INFRA_DIR"
docker compose up -d postgres

until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

docker compose run --rm -T db-tools psql \
  -v ON_ERROR_STOP=1 \
  -v "target_username=$USERNAME" \
  -v "target_password_hash=$PASSWORD_HASH" \
  -v "target_full_name=$FULL_NAME" \
  -v "target_employee_code=$EMPLOYEE_CODE" \
  -v "target_email=$EMAIL" \
  -v "target_user_id=$USER_ID" <<'SQL'
CREATE TEMP TABLE tmp_admin_params AS
SELECT
  :'target_username'::TEXT AS username,
  NULLIF(:'target_password_hash', '')::TEXT AS password_hash,
  NULLIF(:'target_full_name', '')::TEXT AS full_name,
  NULLIF(:'target_employee_code', '')::TEXT AS employee_code,
  NULLIF(:'target_email', '')::TEXT AS email,
  CAST(:'target_user_id' AS BIGINT) AS user_id;

CREATE TEMP TABLE tmp_target_admin AS
SELECT
  p.username,
  p.password_hash,
  p.full_name,
  p.employee_code,
  p.email,
  COALESCE(u.id, p.user_id) AS user_id,
  u.id AS existing_user_id
FROM tmp_admin_params p
LEFT JOIN core.app_user u
  ON u.username = p.username;

INSERT INTO core.app_user (
  id,
  username,
  password_hash,
  full_name,
  employee_code,
  email,
  status,
  password_changed_at
)
SELECT
  t.user_id,
  t.username,
  t.password_hash,
  COALESCE(t.full_name, 'Root Admin'),
  COALESCE(t.employee_code, 'GLOBAL-ADMIN-' || t.user_id::TEXT),
  t.email,
  'active'::core.user_status_enum,
  NOW()
FROM tmp_target_admin t
WHERE t.existing_user_id IS NULL;

UPDATE core.app_user u
SET
  full_name = COALESCE(t.full_name, u.full_name),
  employee_code = COALESCE(t.employee_code, u.employee_code),
  email = COALESCE(t.email, u.email),
  password_hash = COALESCE(t.password_hash, u.password_hash),
  password_changed_at = CASE
    WHEN t.password_hash IS NULL THEN u.password_changed_at
    ELSE NOW()
  END,
  status = 'active'::core.user_status_enum,
  deleted_at = NULL,
  updated_at = NOW()
FROM tmp_target_admin t
WHERE u.id = t.existing_user_id;

INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT
  t.user_id,
  r.code,
  o.id
FROM tmp_target_admin t
CROSS JOIN core.role r
CROSS JOIN core.outlet o
WHERE r.deleted_at IS NULL
  AND o.deleted_at IS NULL
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

INSERT INTO core.user_permission (user_id, permission_code, outlet_id)
SELECT
  t.user_id,
  p.code,
  o.id
FROM tmp_target_admin t
CROSS JOIN core.permission p
CROSS JOIN core.outlet o
WHERE p.deleted_at IS NULL
  AND o.deleted_at IS NULL
ON CONFLICT (user_id, permission_code, outlet_id) DO NOTHING;

SELECT
  u.id,
  u.username,
  u.full_name,
  u.employee_code,
  u.email,
  u.status,
  COUNT(DISTINCT ur.role_code || '@' || ur.outlet_id::TEXT) AS role_assignments,
  COUNT(DISTINCT up.permission_code || '@' || up.outlet_id::TEXT) AS direct_permission_assignments
FROM core.app_user u
LEFT JOIN core.user_role ur
  ON ur.user_id = u.id
LEFT JOIN core.user_permission up
  ON up.user_id = u.id
WHERE u.username = (SELECT username FROM tmp_admin_params)
GROUP BY u.id, u.username, u.full_name, u.employee_code, u.email, u.status;

DROP TABLE tmp_target_admin;
DROP TABLE tmp_admin_params;
SQL

if docker compose ps --services --filter status=running | grep -qx 'redis'; then
  docker compose exec -T redis sh -lc '
    keys="$(redis-cli --scan --pattern "fern-auth-permissions:*")"
    if [ -n "$keys" ]; then
      printf "%s\n" "$keys" | xargs redis-cli DEL >/dev/null
    fi
  ' >/dev/null || true
fi

echo ""
echo "Admin account synchronization complete."
echo "  username : $USERNAME"
if [ -n "$PASSWORD" ]; then
  echo "  password : $PASSWORD"
fi
