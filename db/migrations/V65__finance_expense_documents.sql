CREATE TABLE IF NOT EXISTS core.expense_document (
  id BIGINT PRIMARY KEY,
  expense_record_id BIGINT NOT NULL
    REFERENCES core.expense_record(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  object_key TEXT NOT NULL,
  storage_url TEXT,
  created_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_expense_document_type
    CHECK (document_type IN ('expense_receipt_pdf'))
);

CREATE INDEX IF NOT EXISTS idx_expense_document_expense_record_id
  ON core.expense_document(expense_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_document_object_key
  ON core.expense_document(object_key);

ALTER TABLE core.expense_document ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_expense_document_expense_scope ON core.expense_document;
CREATE POLICY p_expense_document_expense_scope ON core.expense_document
  USING (
    EXISTS (
      SELECT 1
      FROM core.expense_record er
      WHERE er.id = expense_record_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM core.expense_record er
      WHERE er.id = expense_record_id
    )
  );

ALTER TABLE core.expense_document FORCE ROW LEVEL SECURITY;
