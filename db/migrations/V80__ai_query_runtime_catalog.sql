CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.ai_query_runtime_catalog (
    catalog_key TEXT NOT NULL,
    catalog_version BIGINT NOT NULL,
    payload_json JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT 'system',
    PRIMARY KEY (catalog_key, catalog_version)
);

CREATE INDEX IF NOT EXISTS idx_ai_query_runtime_catalog_active
    ON ai.ai_query_runtime_catalog (catalog_key, is_active, updated_at DESC);
