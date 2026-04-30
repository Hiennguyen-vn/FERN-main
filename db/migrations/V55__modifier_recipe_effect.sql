-- V55: Modifier-aware inventory deduction.
-- Each modifier_option may attach a recipe effect that adjusts ingredient consumption.
-- effect_type semantics:
--   ADD          : add qty_delta of ingredient_id to the deduction set
--   SCALE_ITEM   : multiply existing recipe_item(ingredient_id) by multiplier
--   MULTIPLY     : multiply ALL ingredients of base recipe by multiplier (e.g., size up)
--   SUBSTITUTE   : replace ingredient_id with substitute_ingredient_id (qty unchanged)

CREATE TABLE core.modifier_recipe_effect (
  id BIGINT PRIMARY KEY,
  modifier_option_id BIGINT NOT NULL REFERENCES core.modifier_option(id) ON DELETE CASCADE,
  effect_type VARCHAR(20) NOT NULL CHECK (effect_type IN ('ADD','SCALE_ITEM','MULTIPLY','SUBSTITUTE')),
  ingredient_id BIGINT NULL REFERENCES core.item(id),
  substitute_ingredient_id BIGINT NULL REFERENCES core.item(id),
  qty_delta NUMERIC(18,4) NULL CHECK (qty_delta IS NULL OR qty_delta >= 0),
  multiplier NUMERIC(8,3) NULL CHECK (multiplier IS NULL OR multiplier >= 0),
  uom_code VARCHAR(30) NULL REFERENCES core.unit_of_measure(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_effect_shape CHECK (
    (effect_type = 'ADD'        AND ingredient_id IS NOT NULL AND qty_delta IS NOT NULL AND uom_code IS NOT NULL)
    OR (effect_type = 'SCALE_ITEM' AND ingredient_id IS NOT NULL AND multiplier IS NOT NULL)
    OR (effect_type = 'MULTIPLY'   AND multiplier IS NOT NULL)
    OR (effect_type = 'SUBSTITUTE' AND ingredient_id IS NOT NULL AND substitute_ingredient_id IS NOT NULL)
  )
);

CREATE INDEX idx_modifier_recipe_effect_option ON core.modifier_recipe_effect(modifier_option_id);
CREATE INDEX idx_modifier_recipe_effect_ingredient ON core.modifier_recipe_effect(ingredient_id)
  WHERE ingredient_id IS NOT NULL;

CREATE TRIGGER trg_modifier_recipe_effect_updated_at
BEFORE UPDATE ON core.modifier_recipe_effect
FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE core.modifier_recipe_effect IS
  'Defines how a modifier option modifies the base recipe at sale time.';
