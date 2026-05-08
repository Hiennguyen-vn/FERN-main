-- V78: AI Query Service — long-term agent memory.
--
-- Stores per-user "knowledge nuggets" that the agent learned from prior
-- successful sessions. The retriever node performs an ANN similarity search
-- against this table to bootstrap context for follow-up questions; the
-- summarizer node writes back after each successful answer (best-effort).
--
-- Design notes
-- - One row per (user_id, topic) so updates are idempotent.
-- - ``embedding`` is stored as a pgvector ``halfvec(1536)`` for OpenAI
--   ``text-embedding-3-small`` (1536 dims). Halfvec halves storage and
--   accelerates ANN queries with negligible recall loss.
-- - ``ts`` index on (user_id, last_seen_at DESC) for fast recency listing
--   when the embedding model isn't available (graceful degradation).
-- - RLS-friendly schema (``ai`` namespace, owned by service role).

CREATE SCHEMA IF NOT EXISTS ai;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ai.agent_knowledge_base (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT      NOT NULL,
    topic           TEXT        NOT NULL,
    summary_vi      TEXT        NOT NULL,
    intent          TEXT,
    template_key    TEXT,
    time_range_from DATE,
    time_range_to   DATE,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    embedding       vector(1536),
    embedding_model TEXT,
    hit_count       INTEGER     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_knowledge_base_user_topic_unique
        UNIQUE (user_id, topic)
);

COMMENT ON TABLE ai.agent_knowledge_base IS
    'AI Query Service: per-user knowledge nuggets summarised from prior sessions; '
    'retriever performs ANN similarity search at the start of each turn.';

CREATE INDEX IF NOT EXISTS ix_agent_kb_user_recent
    ON ai.agent_knowledge_base (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS ix_agent_kb_user_intent
    ON ai.agent_knowledge_base (user_id, intent)
    WHERE intent IS NOT NULL;

-- ANN index (cosine) — created with default HNSW parameters; tune ef_search
-- via session-level GUC at query time if recall needs adjusting.
CREATE INDEX IF NOT EXISTS ix_agent_kb_embedding
    ON ai.agent_knowledge_base
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
