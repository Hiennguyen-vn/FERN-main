-- 014_superadmin_account.sql
-- Creates a dedicated superadmin account with full access to all outlets.
-- Password: Workflow#2026!
-- Safe to re-run (idempotent).

BEGIN;

INSERT INTO core.role (code, name, description)
VALUES ('superadmin', 'Superadmin', 'Full chain-wide authority and emergency override')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.app_user (id, username, password_hash, full_name, employee_code, email, status)
VALUES (
    9001,
    'canon.superadmin',
    'mMX5EVSuLZtnwzMkv/HY1w==:7qx0MpNYzor8hT8V5lGC7764svCEMiqRC8EVfBAS8UI=',
    'Canon Superadmin',
    'CANON-SUPER-9001',
    'canon.superadmin@example.com',
    'active'
)
ON CONFLICT (id) DO NOTHING
ON CONFLICT (username) DO NOTHING;

-- Fan-out to all active outlets (works for both id=9001 and any existing user with same username)
INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT u.id, 'superadmin', o.id
FROM core.app_user u
CROSS JOIN core.outlet o
WHERE u.username = 'canon.superadmin'
  AND o.deleted_at IS NULL
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

COMMIT;
