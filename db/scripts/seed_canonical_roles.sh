#!/usr/bin/env sh
set -eu

# Seed one test account per canonical business role from docs/authorization-business-rules.md.
# Shared password: Fern#2026
# Region-scoped roles fan out across all outlets in VN region.
# Outlet-scoped roles bind to VN-HCM-001.

PREFIX="canon"
PASSWORD="Fern#2026"
REGION_CODE="VN"
PRIMARY_OUTLET_CODE="VN-HCM-001"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"

PASSWORD_HASH=$(
  python3 - "$PASSWORD" <<'PY'
import base64, hashlib, os, sys
password = sys.argv[1].encode("utf-8")
salt = os.urandom(16)
digest = hashlib.pbkdf2_hmac("sha256", password, salt, 65536, dklen=32)
print(base64.b64encode(salt).decode("ascii") + ":" + base64.b64encode(digest).decode("ascii"))
PY
)

BASE_USER_ID=$(python3 -c 'import time; print(900000000000000 + int(time.time() * 1000))')

cd "$INFRA_DIR"

docker compose run --rm -T db-tools psql \
  -v ON_ERROR_STOP=1 \
  -v "base_user_id=$BASE_USER_ID" \
  -v "password_hash=$PASSWORD_HASH" \
  -v "prefix=$PREFIX" \
  -v "region_code=$REGION_CODE" \
  -v "primary_outlet_code=$PRIMARY_OUTLET_CODE" <<'SQL'
\set ON_ERROR_STOP on

-- Resolve scope targets
SELECT id AS primary_outlet_id FROM core.outlet WHERE code = :'primary_outlet_code' \gset
SELECT id AS region_id FROM core.region WHERE code = :'region_code' \gset

CREATE TEMP TABLE tmp_canonical_accounts (
  idx INT,
  account_key TEXT,
  username TEXT,
  full_name TEXT,
  employee_code TEXT,
  email TEXT
);

INSERT INTO tmp_canonical_accounts VALUES
  (1,  'superadmin',     :'prefix' || '.superadmin',     'Canon Superadmin',     'CANON-SUPERADMIN',     :'prefix' || '.superadmin@fern.local'),
  (2,  'admin',          :'prefix' || '.admin',          'Canon Admin',          'CANON-ADMIN',          :'prefix' || '.admin@fern.local'),
  (3,  'region_manager', :'prefix' || '.region',         'Canon Region Manager', 'CANON-REGION',         :'prefix' || '.region@fern.local'),
  (4,  'outlet_manager', :'prefix' || '.manager',        'Canon Outlet Manager', 'CANON-MANAGER',        :'prefix' || '.manager@fern.local'),
  (5,  'staff',          :'prefix' || '.staff',          'Canon Staff',          'CANON-STAFF',          :'prefix' || '.staff@fern.local'),
  (6,  'product_manager',:'prefix' || '.product',        'Canon Product Manager','CANON-PRODUCT',        :'prefix' || '.product@fern.local'),
  (7,  'procurement',    :'prefix' || '.procurement',    'Canon Procurement',    'CANON-PROCUREMENT',    :'prefix' || '.procurement@fern.local'),
  (8,  'finance',        :'prefix' || '.finance',        'Canon Finance',        'CANON-FINANCE',        :'prefix' || '.finance@fern.local'),
  (9,  'kitchen_staff',  :'prefix' || '.kitchen',        'Canon Kitchen Staff',  'CANON-KITCHEN',        :'prefix' || '.kitchen@fern.local'),
  (10, 'hr',             :'prefix' || '.hr',             'Canon HR',             'CANON-HR',             :'prefix' || '.hr@fern.local');

-- Upsert app_user
INSERT INTO core.app_user (id, username, password_hash, full_name, employee_code, email, status)
SELECT (:'base_user_id')::BIGINT + idx, username, :'password_hash', full_name, employee_code, email, 'active'
FROM tmp_canonical_accounts
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  full_name     = EXCLUDED.full_name,
  employee_code = EXCLUDED.employee_code,
  email         = EXCLUDED.email,
  status        = 'active',
  updated_at    = now();

-- Remember user ids
CREATE TEMP TABLE tmp_user_ids AS
SELECT t.account_key, u.id AS user_id
FROM tmp_canonical_accounts t JOIN core.app_user u ON u.username = t.username;

-- Clear prior role/permission assignments for these users so re-runs are idempotent
DELETE FROM core.user_role       WHERE user_id IN (SELECT user_id FROM tmp_user_ids);
DELETE FROM core.user_permission WHERE user_id IN (SELECT user_id FROM tmp_user_ids);

-- ── GLOBAL: superadmin on every outlet ────────────────────────────
INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT ui.user_id, 'superadmin', o.id
FROM tmp_user_ids ui CROSS JOIN core.outlet o
WHERE ui.account_key = 'superadmin'
ON CONFLICT DO NOTHING;

-- ── REGION: role fans out across all outlets in region ───────────
-- region_manager, product_manager, finance, hr
INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT ui.user_id,
       CASE ui.account_key
         WHEN 'region_manager'  THEN 'region_manager'
         WHEN 'product_manager' THEN 'product_manager'
         WHEN 'finance'         THEN 'finance'
         WHEN 'hr'              THEN 'hr'
       END,
       o.id
FROM tmp_user_ids ui
JOIN core.outlet o ON o.region_id = (:'region_id')::BIGINT
WHERE ui.account_key IN ('region_manager','product_manager','finance','hr')
ON CONFLICT DO NOTHING;

-- ── OUTLET: role bound to primary outlet ─────────────────────────
-- admin, outlet_manager, staff(staff_pos), procurement(procurement_officer), kitchen_staff
INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT ui.user_id,
       CASE ui.account_key
         WHEN 'admin'          THEN 'admin'
         WHEN 'outlet_manager' THEN 'outlet_manager'
         WHEN 'staff'          THEN 'staff_pos'
         WHEN 'procurement'    THEN 'procurement_officer'
         WHEN 'kitchen_staff'  THEN 'kitchen_staff'
       END,
       (:'primary_outlet_id')::BIGINT
FROM tmp_user_ids ui
WHERE ui.account_key IN ('admin','outlet_manager','staff','procurement','kitchen_staff')
ON CONFLICT DO NOTHING;

-- Bump user_access_version to bust auth caches
INSERT INTO core.user_access_version (user_id, access_version)
SELECT user_id, 1 FROM tmp_user_ids
ON CONFLICT (user_id) DO UPDATE SET access_version = core.user_access_version.access_version + 1, updated_at = now();

-- Report
SELECT t.account_key, u.username, string_agg(DISTINCT ur.role_code, ',' ORDER BY ur.role_code) AS roles,
       count(DISTINCT ur.outlet_id) AS outlet_count
FROM tmp_canonical_accounts t
JOIN core.app_user u ON u.username = t.username
LEFT JOIN core.user_role ur ON ur.user_id = u.id
GROUP BY t.idx, t.account_key, u.username
ORDER BY t.idx;
SQL

echo ""
echo "Canonical role accounts ready."
echo "  shared password : $PASSWORD"
echo "  region          : $REGION_CODE"
echo "  primary outlet  : $PRIMARY_OUTLET_CODE"
