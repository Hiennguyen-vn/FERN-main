/* =========================================================
   V15 — Catalog Phase 4: Publish Center + Change History
   ========================================================= */

-- ── Publish Version ──────────────────────────────────────

CREATE TABLE core.publish_version (
  id BIGINT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'approved', 'scheduled', 'published', 'rolled_back', 'rejected')),
  created_by_user_id BIGINT,
  submitted_at TIMESTAMPTZ,
  submitted_by_user_id BIGINT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id BIGINT,
  review_note TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_by_user_id BIGINT,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by_user_id BIGINT,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_publish_version_status ON core.publish_version (status);
CREATE INDEX idx_publish_version_created_by ON core.publish_version (created_by_user_id);

-- ── Publish Item (individual change within a version) ────

CREATE TABLE core.publish_item (
  id BIGINT PRIMARY KEY,
  publish_version_id BIGINT NOT NULL REFERENCES core.publish_version(id),
  entity_type VARCHAR(30) NOT NULL
    CHECK (entity_type IN ('product', 'recipe', 'price', 'availability', 'menu_assignment', 'menu_exclusion')),
  entity_id BIGINT NOT NULL,
  change_type VARCHAR(20) NOT NULL
    CHECK (change_type IN ('create', 'update', 'delete')),
  scope_type VARCHAR(20),
  scope_id VARCHAR(50),
  summary TEXT NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_publish_item_version ON core.publish_item (publish_version_id);
CREATE INDEX idx_publish_item_entity ON core.publish_item (entity_type, entity_id);

-- ── Change History / Audit Log ───────────────────────────

CREATE TABLE core.catalog_audit_log (
  id BIGINT PRIMARY KEY,
  entity_type VARCHAR(30) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(20) NOT NULL
    CHECK (action IN ('create', 'update', 'delete', 'publish', 'rollback', 'status_change')),
  field_name VARCHAR(50),
  old_value TEXT,
  new_value TEXT,
  scope_type VARCHAR(20),
  scope_id VARCHAR(50),
  user_id BIGINT,
  username VARCHAR(100),
  publish_version_id BIGINT REFERENCES core.publish_version(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_catalog_audit_entity ON core.catalog_audit_log (entity_type, entity_id);
CREATE INDEX idx_catalog_audit_user ON core.catalog_audit_log (user_id);
CREATE INDEX idx_catalog_audit_created ON core.catalog_audit_log (created_at DESC);
CREATE INDEX idx_catalog_audit_action ON core.catalog_audit_log (action);
