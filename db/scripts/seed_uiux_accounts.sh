#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"

PREFIX="uiux"
PASSWORD="123123123"
PRIMARY_OUTLET_ID=""
SECONDARY_OUTLET_ID=""

usage() {
  cat <<'EOF'
Usage: ./db/scripts/seed_uiux_accounts.sh [options]

Creates or updates a reusable set of UI/UX test accounts against the current local database.
The script auto-selects the most data-rich active outlet unless you override it.

Options:
  --prefix PREFIX              Username prefix. Default: uiux
  --password PASSWORD          Shared plaintext password for all created accounts. Default: 123123123
  --outlet-id ID               Primary outlet id to scope non-admin accounts to.
  --secondary-outlet-id ID     Secondary outlet id for the manager account. Optional.
  -h, --help                   Show this help.

Created accounts:
  <prefix>.admin
  <prefix>.manager
  <prefix>.sales
  <prefix>.cashier
  <prefix>.procurement
  <prefix>.catalog
  <prefix>.inventory
  <prefix>.hr
  <prefix>.finance
  <prefix>.payroll
  <prefix>.audit

Notes:
  - Finance, payroll, and audit are admin-only in the current backend, so those personas
    use the admin role on the selected outlet.
  - Manager receives catalog write on the scoped outlets so the current catalog flows are usable.
  - Procurement purchase-order creation is role-gated to outlet_manager in the current backend,
    so the procurement persona also receives outlet_manager on the primary outlet.
  - HR scheduling currently accepts outlet_manager/admin in source, while the shipped HR screen
    also loads payroll/contracts endpoints that are admin-only. The HR persona keeps
    outlet_manager and also receives admin on the primary outlet.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      PREFIX=${2:?missing value for --prefix}
      shift 2
      ;;
    --password)
      PASSWORD=${2:?missing value for --password}
      shift 2
      ;;
    --outlet-id)
      PRIMARY_OUTLET_ID=${2:?missing value for --outlet-id}
      shift 2
      ;;
    --secondary-outlet-id)
      SECONDARY_OUTLET_ID=${2:?missing value for --secondary-outlet-id}
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

cd "$INFRA_DIR"
docker compose up -d postgres redis >/dev/null

until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

db_query() {
  docker compose run --rm -T db-tools psql -X -A -q -t -v ON_ERROR_STOP=1 "$POSTGRES_DB"
}

if [ -z "$PRIMARY_OUTLET_ID" ]; then
  PRIMARY_OUTLET_ID=$(
    db_query <<'SQL'
WITH work_shift_counts AS (
  SELECT s.outlet_id, COUNT(*) AS total
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  GROUP BY s.outlet_id
),
scores AS (
  SELECT
    o.id,
    o.region_id,
    COALESCE(ps.total, 0)
      + COALESCE(po.total, 0)
      + COALESCE(pp.total, 0)
      + COALESCE(ws.total, 0) AS score
  FROM core.outlet o
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.pos_session
    GROUP BY outlet_id
  ) ps ON ps.outlet_id = o.id
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.purchase_order
    GROUP BY outlet_id
  ) po ON po.outlet_id = o.id
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.product_price
    GROUP BY outlet_id
  ) pp ON pp.outlet_id = o.id
  LEFT JOIN work_shift_counts ws ON ws.outlet_id = o.id
  WHERE o.deleted_at IS NULL
)
SELECT id
FROM scores
ORDER BY score DESC, id
LIMIT 1;
SQL
  )
fi

if [ -z "$PRIMARY_OUTLET_ID" ]; then
  echo "No active outlet found. Cannot seed UIUX accounts." >&2
  exit 1
fi

if [ -z "$SECONDARY_OUTLET_ID" ]; then
  SECONDARY_OUTLET_ID=$(
    db_query <<SQL
WITH work_shift_counts AS (
  SELECT s.outlet_id, COUNT(*) AS total
  FROM core.work_shift ws
  JOIN core.shift s ON s.id = ws.shift_id
  GROUP BY s.outlet_id
),
scores AS (
  SELECT
    o.id,
    o.region_id,
    COALESCE(ps.total, 0)
      + COALESCE(po.total, 0)
      + COALESCE(pp.total, 0)
      + COALESCE(ws.total, 0) AS score
  FROM core.outlet o
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.pos_session
    GROUP BY outlet_id
  ) ps ON ps.outlet_id = o.id
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.purchase_order
    GROUP BY outlet_id
  ) po ON po.outlet_id = o.id
  LEFT JOIN (
    SELECT outlet_id, COUNT(*) AS total
    FROM core.product_price
    GROUP BY outlet_id
  ) pp ON pp.outlet_id = o.id
  LEFT JOIN work_shift_counts ws ON ws.outlet_id = o.id
  WHERE o.deleted_at IS NULL
),
primary_outlet AS (
  SELECT id, region_id
  FROM core.outlet
  WHERE id = ${PRIMARY_OUTLET_ID}
)
SELECT s.id
FROM scores s
JOIN primary_outlet p ON p.region_id = s.region_id
WHERE s.id <> p.id
ORDER BY s.score DESC, s.id
LIMIT 1;
SQL
  )
fi

PASSWORD_HASH=$(
  python3 - "$PASSWORD" <<'PY'
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

BASE_USER_ID=$(python3 - <<'PY'
import time
print(900000000000000 + int(time.time() * 1000))
PY
)

ADMIN_USERNAME="${PREFIX}.admin"
MANAGER_USERNAME="${PREFIX}.manager"
SALES_USERNAME="${PREFIX}.sales"
CASHIER_USERNAME="${PREFIX}.cashier"
PROCUREMENT_USERNAME="${PREFIX}.procurement"
CATALOG_USERNAME="${PREFIX}.catalog"
INVENTORY_USERNAME="${PREFIX}.inventory"
HR_USERNAME="${PREFIX}.hr"
FINANCE_USERNAME="${PREFIX}.finance"
PAYROLL_USERNAME="${PREFIX}.payroll"
AUDIT_USERNAME="${PREFIX}.audit"

docker compose run --rm -T db-tools psql \
  -v ON_ERROR_STOP=1 \
  -v "base_user_id=$BASE_USER_ID" \
  -v "password_hash=$PASSWORD_HASH" \
  -v "primary_outlet_id=$PRIMARY_OUTLET_ID" \
  -v "secondary_outlet_id=$SECONDARY_OUTLET_ID" \
  -v "admin_username=$ADMIN_USERNAME" \
  -v "manager_username=$MANAGER_USERNAME" \
  -v "sales_username=$SALES_USERNAME" \
  -v "cashier_username=$CASHIER_USERNAME" \
  -v "procurement_username=$PROCUREMENT_USERNAME" \
  -v "catalog_username=$CATALOG_USERNAME" \
  -v "inventory_username=$INVENTORY_USERNAME" \
  -v "hr_username=$HR_USERNAME" \
  -v "finance_username=$FINANCE_USERNAME" \
  -v "payroll_username=$PAYROLL_USERNAME" \
  -v "audit_username=$AUDIT_USERNAME" \
  "$POSTGRES_DB" <<'SQL'
INSERT INTO core.role (code, name, description)
VALUES
  ('inventory_clerk', 'Inventory Clerk', 'Inventory stock control operations')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO core.permission (code, name, description)
VALUES
  ('inventory.write', 'Inventory Write', 'Allows inventory mutations such as stock counts and waste records')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO core.role_permission (role_code, permission_code)
SELECT v.role_code, v.permission_code
FROM (
  VALUES
    ('admin', 'inventory.write'),
    ('outlet_manager', 'inventory.write'),
    ('inventory_clerk', 'inventory.write')
) AS v(role_code, permission_code)
JOIN core.role r ON r.code = v.role_code
JOIN core.permission p ON p.code = v.permission_code
ON CONFLICT (role_code, permission_code) DO NOTHING;

CREATE TEMP TABLE tmp_uiux_accounts (
  account_key TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  employee_code TEXT NOT NULL,
  email TEXT NOT NULL
);

INSERT INTO tmp_uiux_accounts (account_key, username, full_name, employee_code, email)
VALUES
  ('admin', :'admin_username', 'UIUX Admin', upper(replace(:'admin_username', '.', '-')), :'admin_username' || '@fern.local'),
  ('manager', :'manager_username', 'UIUX Outlet Manager', upper(replace(:'manager_username', '.', '-')), :'manager_username' || '@fern.local'),
  ('sales', :'sales_username', 'UIUX Sales Staff', upper(replace(:'sales_username', '.', '-')), :'sales_username' || '@fern.local'),
  ('cashier', :'cashier_username', 'UIUX Cashier', upper(replace(:'cashier_username', '.', '-')), :'cashier_username' || '@fern.local'),
  ('procurement', :'procurement_username', 'UIUX Procurement', upper(replace(:'procurement_username', '.', '-')), :'procurement_username' || '@fern.local'),
  ('catalog', :'catalog_username', 'UIUX Catalog', upper(replace(:'catalog_username', '.', '-')), :'catalog_username' || '@fern.local'),
  ('inventory', :'inventory_username', 'UIUX Inventory', upper(replace(:'inventory_username', '.', '-')), :'inventory_username' || '@fern.local'),
  ('hr', :'hr_username', 'UIUX HR', upper(replace(:'hr_username', '.', '-')), :'hr_username' || '@fern.local'),
  ('finance', :'finance_username', 'UIUX Finance Admin', upper(replace(:'finance_username', '.', '-')), :'finance_username' || '@fern.local'),
  ('payroll', :'payroll_username', 'UIUX Payroll Admin', upper(replace(:'payroll_username', '.', '-')), :'payroll_username' || '@fern.local'),
  ('audit', :'audit_username', 'UIUX Audit Admin', upper(replace(:'audit_username', '.', '-')), :'audit_username' || '@fern.local');

WITH desired AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY account_key) AS rn,
    *
  FROM tmp_uiux_accounts
),
resolved AS (
  SELECT
    d.account_key,
    COALESCE(u.id, :'base_user_id'::BIGINT + d.rn) AS user_id,
    d.username,
    d.full_name,
    d.employee_code,
    d.email
  FROM desired d
  LEFT JOIN core.app_user u ON u.username = d.username
)
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
  user_id,
  username,
  :'password_hash',
  full_name,
  employee_code,
  email,
  'active',
  NOW()
FROM resolved
ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    employee_code = EXCLUDED.employee_code,
    email = EXCLUDED.email,
    status = 'active',
    password_changed_at = NOW(),
    updated_at = NOW();

CREATE TEMP TABLE tmp_uiux_users AS
SELECT a.account_key, u.id AS user_id, a.username
FROM tmp_uiux_accounts a
JOIN core.app_user u ON u.username = a.username;

DELETE FROM core.user_role
WHERE user_id IN (SELECT user_id FROM tmp_uiux_users);

DELETE FROM core.user_permission
WHERE user_id IN (SELECT user_id FROM tmp_uiux_users);

INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT u.user_id, 'admin', o.id
FROM tmp_uiux_users u
JOIN core.outlet o ON o.deleted_at IS NULL
WHERE u.account_key = 'admin'
UNION ALL
SELECT user_id, 'outlet_manager', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
UNION ALL
SELECT user_id, 'outlet_manager', NULLIF(:'secondary_outlet_id', '')::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
  AND NULLIF(:'secondary_outlet_id', '') IS NOT NULL
UNION ALL
SELECT user_id, 'cashier', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'cashier'
UNION ALL
SELECT user_id, 'inventory_clerk', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'inventory'
UNION ALL
SELECT user_id, 'outlet_manager', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'procurement'
UNION ALL
SELECT user_id, 'outlet_manager', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'hr'
UNION ALL
SELECT user_id, 'admin', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'hr'
UNION ALL
SELECT user_id, 'admin', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key IN ('finance', 'payroll', 'audit');

INSERT INTO core.user_permission (user_id, permission_code, outlet_id)
SELECT user_id, 'sales.order.write', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'sales'
UNION ALL
SELECT user_id, 'sales.order.write', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
UNION ALL
SELECT user_id, 'sales.order.write', NULLIF(:'secondary_outlet_id', '')::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
  AND NULLIF(:'secondary_outlet_id', '') IS NOT NULL
UNION ALL
SELECT user_id, 'product.catalog.write', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
UNION ALL
SELECT user_id, 'product.catalog.write', NULLIF(:'secondary_outlet_id', '')::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'manager'
  AND NULLIF(:'secondary_outlet_id', '') IS NOT NULL
UNION ALL
SELECT user_id, 'procurement.po.write', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'procurement'
UNION ALL
SELECT user_id, 'purchase.approve', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'procurement'
UNION ALL
SELECT user_id, 'product.catalog.write', :'primary_outlet_id'::BIGINT
FROM tmp_uiux_users
WHERE account_key = 'catalog';

SELECT
  u.account_key,
  u.username,
  COALESCE(STRING_AGG(DISTINCT ur.role_code, ', ' ORDER BY ur.role_code), '-') AS roles,
  COALESCE(STRING_AGG(DISTINCT up.permission_code, ', ' ORDER BY up.permission_code), '-') AS direct_permissions,
  COALESCE(STRING_AGG(DISTINCT o.code, ', ' ORDER BY o.code), '-') AS outlets
FROM tmp_uiux_users u
LEFT JOIN core.user_role ur ON ur.user_id = u.user_id
LEFT JOIN core.user_permission up ON up.user_id = u.user_id
LEFT JOIN core.outlet o ON o.id = COALESCE(ur.outlet_id, up.outlet_id)
GROUP BY u.account_key, u.username
ORDER BY u.account_key;
SQL

docker compose exec -T redis sh -lc '
keys="$(redis-cli --scan --pattern "fern-auth-permissions:*")"
if [ -n "$keys" ]; then
  printf "%s\n" "$keys" | xargs redis-cli DEL >/dev/null
fi
' >/dev/null

PRIMARY_INFO=$(
  db_query <<SQL
SELECT o.id || '|' || o.code || '|' || o.name
FROM core.outlet o
WHERE o.id = ${PRIMARY_OUTLET_ID};
SQL
)

SECONDARY_INFO=""
if [ -n "$SECONDARY_OUTLET_ID" ]; then
  SECONDARY_INFO=$(
    db_query <<SQL
SELECT o.id || '|' || o.code || '|' || o.name
FROM core.outlet o
WHERE o.id = ${SECONDARY_OUTLET_ID};
SQL
  )
fi

echo ""
echo "UIUX accounts ready."
echo "  shared password : $PASSWORD"
echo "  primary outlet  : $PRIMARY_INFO"
if [ -n "$SECONDARY_INFO" ]; then
  echo "  secondary outlet: $SECONDARY_INFO"
fi
