SET search_path TO core, public;

/* =========================================================
   REPORTING INDEXES
   Optimized for outlet-scoped reporting queries.
   ========================================================= */

CREATE INDEX idx_sale_record_outlet_created_at
  ON core.sale_record(outlet_id, created_at);

CREATE INDEX idx_expense_record_outlet_date_source
  ON core.expense_record(outlet_id, business_date, source_type);

CREATE INDEX idx_inventory_transaction_outlet_item_date
  ON core.inventory_transaction(outlet_id, item_id, business_date);
