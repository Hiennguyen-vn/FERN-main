-- 013_backfill_superadmin_outlets.sql
-- Backfill user_role rows for all superadmin/admin users to cover every active outlet.
-- Safe to re-run (idempotent). Run after simulator populates outlets.

BEGIN;

INSERT INTO core.user_role (user_id, role_code, outlet_id)
SELECT ur.user_id, ur.role_code, o.id
FROM core.outlet o
CROSS JOIN (
    SELECT DISTINCT user_id, role_code
    FROM core.user_role
    WHERE role_code = 'superadmin'
) ur
WHERE o.deleted_at IS NULL
ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING;

COMMIT;
