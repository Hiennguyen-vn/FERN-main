-- ONE-SHOT BACKFILL — DO NOT RUN REPEATEDLY
-- Purpose: Fix stale user_role rows for outlets created before OrgEventConsumer deployment.
--          Ensures superadmin and region-scoped users have correct rows for all active outlets.
-- Usage:   Run ONCE after deploying OrgEventConsumer to auth-service.
--          Re-running is safe (idempotent via ON CONFLICT DO NOTHING).
-- Date:    2026-04-21
-- Related: OrgEventConsumer (auth-service), OrgSyncRepository.fanOutNewOutlet
--
-- RULES (match OrgSyncRepository logic exactly):
--   1. Superadmin: fan-out to ALL active outlets where row is missing.
--   2. Region-scoped (admin, region_manager, finance, hr, product_manager):
--      Only fan-out users who ALREADY cover ALL active outlets in the region
--      (i.e. genuine region-wide users, not outlet-subset users).
--      "Coverage" is checked per role_code independently.
-- CONSTRAINT: Only INSERT, no DELETE. Backfill does not remove any data.
-- NOTE: Run in psql or a migration tool that shows RAISE NOTICE output.

BEGIN;

-- ============================================================
-- SECTION 0: DRY-RUN — count rows that would be added
-- ============================================================
DO $$
DECLARE
  v_superadmin_missing  INT;
  v_region_scoped_missing INT;
  v_region_scoped_codes TEXT[] := ARRAY['admin','region_manager','finance','hr','product_manager'];
BEGIN
  -- Superadmin: rows missing for (user, outlet) pairs
  SELECT COUNT(*) INTO v_superadmin_missing
  FROM (
    SELECT DISTINCT ur.user_id, o.id AS outlet_id
    FROM core.user_role ur
    CROSS JOIN core.outlet o
    WHERE ur.role_code = 'superadmin'
      AND o.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM core.user_role existing
        WHERE existing.user_id = ur.user_id
          AND existing.role_code = 'superadmin'
          AND existing.outlet_id = o.id
      )
  ) t;

  -- Region-scoped: rows missing for users covering full region
  SELECT COUNT(*) INTO v_region_scoped_missing
  FROM (
    SELECT DISTINCT ur.user_id, ur.role_code, o_missing.id AS outlet_id
    FROM core.user_role ur
    JOIN core.outlet o_source ON o_source.id = ur.outlet_id
    JOIN core.outlet o_missing ON o_missing.region_id = o_source.region_id
    WHERE ur.role_code = ANY(v_region_scoped_codes)
      AND o_source.deleted_at IS NULL
      AND o_missing.deleted_at IS NULL
      AND o_missing.id != ur.outlet_id
      -- User covers ALL outlets in this region for this role_code
      AND ur.user_id IN (
        SELECT sub.user_id
        FROM core.user_role sub
        JOIN core.outlet o2 ON o2.id = sub.outlet_id
        WHERE sub.role_code = ur.role_code
          AND o2.region_id = o_source.region_id
          AND o2.deleted_at IS NULL
        GROUP BY sub.user_id
        HAVING COUNT(DISTINCT sub.outlet_id) = (
          SELECT COUNT(*) FROM core.outlet
          WHERE region_id = o_source.region_id AND deleted_at IS NULL
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM core.user_role existing
        WHERE existing.user_id = ur.user_id
          AND existing.role_code = ur.role_code
          AND existing.outlet_id = o_missing.id
      )
  ) t;

  RAISE NOTICE '[DRY-RUN] Would add % superadmin rows, % region-scoped rows',
    v_superadmin_missing, v_region_scoped_missing;
END $$;

-- ============================================================
-- SECTION 1: DETECT INCONSISTENCY (log only, no auto-fix)
-- Rows where a region-scoped user has role on an outlet but
-- no role on any OTHER outlet in the same region — and the
-- region has >1 active outlet. These are "orphan scope" rows:
-- user may have been a region-wide admin before an outlet was
-- removed, or was directly assigned only to this one outlet.
-- Human review required before any cleanup.
-- ============================================================
DO $$
DECLARE
  v_suspicious_count INT;
  v_region_scoped_codes TEXT[] := ARRAY['admin','region_manager','finance','hr','product_manager'];
BEGIN
  SELECT COUNT(*) INTO v_suspicious_count
  FROM (
    SELECT ur.user_id, ur.role_code, ur.outlet_id, o.region_id AS current_region
    FROM core.user_role ur
    JOIN core.outlet o ON o.id = ur.outlet_id
    WHERE ur.role_code = ANY(v_region_scoped_codes)
      AND o.deleted_at IS NULL
      -- User has NO other row for same role_code in same region
      AND NOT EXISTS (
        SELECT 1 FROM core.user_role ur2
        JOIN core.outlet o2 ON o2.id = ur2.outlet_id
        WHERE ur2.user_id = ur.user_id
          AND ur2.role_code = ur.role_code
          AND o2.region_id = o.region_id
          AND o2.id != ur.outlet_id
          AND o2.deleted_at IS NULL
      )
      -- Region has more than 1 active outlet (single-outlet regions are not suspicious)
      AND (
        SELECT COUNT(*) FROM core.outlet o3
        WHERE o3.region_id = o.region_id AND o3.deleted_at IS NULL
      ) > 1
  ) t;

  IF v_suspicious_count > 0 THEN
    RAISE NOTICE '[DETECT] % suspicious orphan-scope rows found. Review manually before cleanup:', v_suspicious_count;
    RAISE NOTICE '[DETECT] Query to inspect: SELECT ur.user_id, ur.role_code, ur.outlet_id, o.region_id';
    RAISE NOTICE '[DETECT] FROM core.user_role ur JOIN core.outlet o ON o.id = ur.outlet_id';
    RAISE NOTICE '[DETECT] WHERE ur.role_code = ANY(ARRAY[''admin'',''region_manager'',''finance'',''hr'',''product_manager''])';
    RAISE NOTICE '[DETECT] AND o.deleted_at IS NULL';
    RAISE NOTICE '[DETECT] AND NOT EXISTS (SELECT 1 FROM core.user_role ur2 JOIN core.outlet o2 ON o2.id = ur2.outlet_id';
    RAISE NOTICE '[DETECT] WHERE ur2.user_id = ur.user_id AND ur2.role_code = ur.role_code';
    RAISE NOTICE '[DETECT] AND o2.region_id = o.region_id AND o2.id != ur.outlet_id AND o2.deleted_at IS NULL)';
    RAISE NOTICE '[DETECT] AND (SELECT COUNT(*) FROM core.outlet o3 WHERE o3.region_id = o.region_id AND o3.deleted_at IS NULL) > 1;';
  ELSE
    RAISE NOTICE '[DETECT] No suspicious orphan-scope rows found.';
  END IF;
END $$;

-- ============================================================
-- SECTION 2: INSERT superadmin rows for missing outlets
-- ============================================================
WITH inserted AS (
  INSERT INTO core.user_role (user_id, role_code, outlet_id)
  SELECT DISTINCT ur.user_id, ur.role_code, o.id AS outlet_id
  FROM core.user_role ur
  CROSS JOIN core.outlet o
  WHERE ur.role_code = 'superadmin'
    AND o.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM core.user_role existing
      WHERE existing.user_id = ur.user_id
        AND existing.role_code = 'superadmin'
        AND existing.outlet_id = o.id
    )
  ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
  RETURNING user_id, outlet_id
)
SELECT COUNT(*) AS superadmin_rows_inserted FROM inserted;

-- ============================================================
-- SECTION 3: INSERT region-scoped rows for missing outlets
-- Only for users who cover ALL active outlets in the region
-- (per role_code independently — matches OrgSyncRepository rule)
-- ============================================================
WITH inserted AS (
  INSERT INTO core.user_role (user_id, role_code, outlet_id)
  SELECT DISTINCT ur.user_id, ur.role_code, o_missing.id AS outlet_id
  FROM core.user_role ur
  JOIN core.outlet o_source ON o_source.id = ur.outlet_id
  JOIN core.outlet o_missing ON o_missing.region_id = o_source.region_id
  WHERE ur.role_code = ANY(ARRAY['admin','region_manager','finance','hr','product_manager'])
    AND o_source.deleted_at IS NULL
    AND o_missing.deleted_at IS NULL
    AND o_missing.id != ur.outlet_id
    -- Coverage check: user has role on ALL current outlets in region
    AND ur.user_id IN (
      SELECT sub.user_id
      FROM core.user_role sub
      JOIN core.outlet o2 ON o2.id = sub.outlet_id
      WHERE sub.role_code = ur.role_code
        AND o2.region_id = o_source.region_id
        AND o2.deleted_at IS NULL
      GROUP BY sub.user_id
      HAVING COUNT(DISTINCT sub.outlet_id) = (
        SELECT COUNT(*) FROM core.outlet
        WHERE region_id = o_source.region_id AND deleted_at IS NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM core.user_role existing
      WHERE existing.user_id = ur.user_id
        AND existing.role_code = ur.role_code
        AND existing.outlet_id = o_missing.id
    )
  ON CONFLICT (user_id, role_code, outlet_id) DO NOTHING
  RETURNING user_id, role_code, outlet_id
)
SELECT
  role_code,
  COUNT(*) AS rows_inserted
FROM inserted
GROUP BY role_code
ORDER BY role_code;

COMMIT;
