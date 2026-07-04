-- V86: remove allergen taxonomy and related mappings.

ALTER TABLE IF EXISTS core.kitchen_ticket_item
  DROP COLUMN IF EXISTS allergens;

DROP TABLE IF EXISTS core.customer_allergy;
DROP TABLE IF EXISTS core.product_allergen;
DROP TABLE IF EXISTS core.allergen;
