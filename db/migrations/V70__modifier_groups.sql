-- V70: F&B modifier groups — augment existing schema with is_default flag.
-- Existing core.modifier_group / modifier_option / product_modifier_group / sale_item_modifier
-- tables (V11/V13/V20 era) already cover the bulk; we only add fields the F&B picker needs.

ALTER TABLE core.modifier_option
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_modifier_option_default
  ON core.modifier_option (modifier_group_id)
  WHERE is_default = true;

-- Helper view exposing the picker shape used by POS.
CREATE OR REPLACE VIEW core.v_modifier_group_full AS
SELECT
  mg.id,
  mg.code              AS group_code,
  mg.name              AS group_name,
  mg.selection_type,
  mg.min_selections    AS min_select,
  mg.max_selections    AS max_select,
  mg.is_active         AS active,
  COALESCE(json_agg(
    json_build_object(
      'id',           mo.id,
      'code',         mo.code,
      'label',        mo.name,
      'priceDelta',   mo.price_adjustment,
      'isDefault',    mo.is_default,
      'active',       mo.is_active,
      'sortOrder',    mo.display_order
    ) ORDER BY mo.display_order, mo.id
  ) FILTER (WHERE mo.id IS NOT NULL), '[]'::json) AS options
FROM core.modifier_group mg
LEFT JOIN core.modifier_option mo
  ON mo.modifier_group_id = mg.id AND mo.is_active = true
WHERE mg.is_active = true
GROUP BY mg.id;
