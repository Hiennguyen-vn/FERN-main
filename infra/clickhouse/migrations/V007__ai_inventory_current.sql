-- Current on-hand balance. Unlike the daily movement view, this view always
-- returns one row per outlet/item even when the item had no movement today.
CREATE OR REPLACE VIEW analytics.ai_inventory_current AS
SELECT
    it.outlet_id AS outlet_id,
    any(o.code) AS outlet_code,
    any(o.name) AS outlet_name,
    it.item_id AS item_id,
    sum(it.qty_change) AS qty_on_hand,
    max(it.business_date) AS as_of_date
FROM cdc.inventory_transaction AS it FINAL
LEFT JOIN cdc.outlet AS o FINAL ON o.id = it.outlet_id
WHERE coalesce(it.__deleted, 'false') = 'false'
GROUP BY it.outlet_id, it.item_id;
