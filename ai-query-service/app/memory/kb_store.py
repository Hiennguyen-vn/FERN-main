"""Postgres + pgvector store for the agent knowledge base.

Failure-mode contract
---------------------
Every public function in this module **fails open**: if pgvector or psycopg
is missing, the connection cannot be opened, or the query raises, we log a
warning and return an empty list (read paths) or ``False`` (write paths).
The agent must keep working when the KB is offline — KB is an enrichment,
not a hard dependency.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class KnowledgeNugget:
    topic: str
    summary_vi: str
    intent: str | None = None
    template_key: str | None = None
    time_range_from: date | None = None
    time_range_to: date | None = None
    metadata: dict[str, Any] | None = None
    similarity: float | None = None
    last_seen_at: str | None = None
    hit_count: int | None = None


def _embedding_literal(vec: list[float]) -> str:
    """pgvector accepts ``'[1.0,2.0,3.0]'`` casted to ``vector``."""
    return "[" + ",".join(f"{float(x):.6f}" for x in vec) + "]"


def _connect(*, read_only: bool):
    s = get_settings()
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required for the agent knowledge base") from exc

    timeout_ms = max(1, int(s.postgres_statement_timeout_seconds)) * 1000
    options = f"-c statement_timeout={timeout_ms}"
    if read_only:
        options = "-c default_transaction_read_only=on " + options
    return psycopg.connect(
        host=s.postgres_host,
        port=s.postgres_port,
        dbname=s.postgres_db,
        user=s.postgres_user,
        password=s.postgres_password,
        autocommit=True,
        row_factory=dict_row,
        options=options,
        application_name="fern-ai-query-service-kb",
    )


def _kb_table() -> str:
    s = get_settings()
    table = (s.agent_kb_table or "ai.agent_knowledge_base").strip()
    # Allow only ``schema.table`` ASCII identifiers — guard against config typos
    # injecting SQL via the table name.
    parts = table.split(".")
    for p in parts:
        if not p.isidentifier():
            raise ValueError(f"agent_kb_table contains an invalid identifier: {table}")
    return table


def search_similar(
    *,
    user_id: int,
    query_embedding: list[float],
    top_k: int,
    min_similarity: float,
    intent_hint: str | None = None,
) -> list[KnowledgeNugget]:
    """ANN cosine search over the user's knowledge nuggets."""
    if user_id <= 0 or not query_embedding:
        return []
    try:
        table = _kb_table()
    except ValueError as e:
        logger.warning("kb search skipped: %s", e)
        return []

    sql = f"""
        SELECT
            topic,
            summary_vi,
            intent,
            template_key,
            time_range_from,
            time_range_to,
            metadata,
            hit_count,
            last_seen_at,
            1 - (embedding <=> %(embedding)s::vector) AS similarity
        FROM {table}
        WHERE user_id = %(user_id)s
          AND embedding IS NOT NULL
          AND (%(intent_hint)s::text IS NULL OR intent = %(intent_hint)s)
        ORDER BY embedding <=> %(embedding)s::vector ASC
        LIMIT %(limit)s
    """
    params = {
        "user_id": int(user_id),
        "embedding": _embedding_literal(query_embedding),
        "intent_hint": intent_hint,
        "limit": max(1, int(top_k)),
    }
    try:
        with _connect(read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    except Exception as e:  # noqa: BLE001
        logger.warning("kb search failed (fail-open): %s", e)
        return []

    out: list[KnowledgeNugget] = []
    for r in rows:
        sim = float(r.get("similarity") or 0.0)
        if sim < float(min_similarity):
            continue
        meta = r.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:  # noqa: BLE001
                meta = {}
        last_seen = r.get("last_seen_at")
        out.append(
            KnowledgeNugget(
                topic=str(r.get("topic") or ""),
                summary_vi=str(r.get("summary_vi") or ""),
                intent=r.get("intent"),
                template_key=r.get("template_key"),
                time_range_from=r.get("time_range_from"),
                time_range_to=r.get("time_range_to"),
                metadata=meta if isinstance(meta, dict) else {},
                similarity=sim,
                last_seen_at=last_seen.isoformat() if last_seen else None,
                hit_count=int(r.get("hit_count") or 0),
            )
        )
    return out


def upsert_nugget(
    *,
    user_id: int,
    topic: str,
    summary_vi: str,
    embedding: list[float] | None,
    embedding_model: str | None,
    intent: str | None = None,
    template_key: str | None = None,
    time_range: dict[str, str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    """Insert/update a single nugget keyed by (user_id, topic). Fail-open."""
    if user_id <= 0 or not topic or not summary_vi:
        return False
    try:
        table = _kb_table()
    except ValueError as e:
        logger.warning("kb upsert skipped: %s", e)
        return False

    s = get_settings()
    summary = summary_vi[: max(80, int(s.agent_kb_max_summary_chars))]

    tr = time_range or {}
    from_d = (tr.get("from_date") or "").strip() or None
    to_d = (tr.get("to_date") or "").strip() or None

    if embedding is not None and len(embedding) != int(s.agent_kb_embed_dim):
        logger.warning(
            "kb upsert: embedding dim mismatch (%d != %d)", len(embedding), s.agent_kb_embed_dim
        )
        embedding = None

    sql = f"""
        INSERT INTO {table} (
            user_id, topic, summary_vi, intent, template_key,
            time_range_from, time_range_to, metadata,
            embedding, embedding_model
        )
        VALUES (
            %(user_id)s, %(topic)s, %(summary_vi)s, %(intent)s, %(template_key)s,
            %(time_range_from)s, %(time_range_to)s, %(metadata)s::jsonb,
            CASE WHEN %(embedding)s::text IS NULL THEN NULL ELSE %(embedding)s::vector END,
            %(embedding_model)s
        )
        ON CONFLICT (user_id, topic) DO UPDATE SET
            summary_vi      = EXCLUDED.summary_vi,
            intent          = COALESCE(EXCLUDED.intent, {table}.intent),
            template_key    = COALESCE(EXCLUDED.template_key, {table}.template_key),
            time_range_from = COALESCE(EXCLUDED.time_range_from, {table}.time_range_from),
            time_range_to   = COALESCE(EXCLUDED.time_range_to, {table}.time_range_to),
            metadata        = {table}.metadata || EXCLUDED.metadata,
            embedding       = COALESCE(EXCLUDED.embedding, {table}.embedding),
            embedding_model = COALESCE(EXCLUDED.embedding_model, {table}.embedding_model),
            hit_count       = {table}.hit_count + 1,
            last_seen_at    = now()
    """
    params = {
        "user_id": int(user_id),
        "topic": topic[:300],
        "summary_vi": summary,
        "intent": intent,
        "template_key": template_key,
        "time_range_from": from_d,
        "time_range_to": to_d,
        "metadata": json.dumps(metadata or {}, ensure_ascii=False),
        "embedding": _embedding_literal(embedding) if embedding else None,
        "embedding_model": embedding_model,
    }

    try:
        with _connect(read_only=False) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
        # Best-effort cap on per-user nuggets (LRU by last_seen_at).
        try:
            _enforce_per_user_cap(user_id)
        except Exception as e:  # noqa: BLE001
            logger.debug("kb cap enforce skipped: %s", e)
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("kb upsert failed (fail-open): %s", e)
        return False


def _enforce_per_user_cap(user_id: int) -> None:
    s = get_settings()
    cap = max(50, int(s.agent_kb_max_per_user))
    table = _kb_table()
    sql = f"""
        DELETE FROM {table}
        WHERE id IN (
            SELECT id FROM {table}
            WHERE user_id = %(user_id)s
            ORDER BY last_seen_at DESC
            OFFSET %(cap)s
        )
    """
    with _connect(read_only=False) as conn, conn.cursor() as cur:
        cur.execute(sql, {"user_id": int(user_id), "cap": cap})


def list_recent(*, user_id: int, limit: int = 5) -> list[KnowledgeNugget]:
    """Recency listing — used as a fallback when embeddings are unavailable."""
    if user_id <= 0:
        return []
    try:
        table = _kb_table()
    except ValueError:
        return []
    sql = f"""
        SELECT topic, summary_vi, intent, template_key,
               time_range_from, time_range_to, metadata, hit_count, last_seen_at
        FROM {table}
        WHERE user_id = %(user_id)s
        ORDER BY last_seen_at DESC
        LIMIT %(limit)s
    """
    try:
        with _connect(read_only=True) as conn, conn.cursor() as cur:
            cur.execute(sql, {"user_id": int(user_id), "limit": max(1, int(limit))})
            rows = cur.fetchall()
    except Exception as e:  # noqa: BLE001
        logger.warning("kb list_recent failed: %s", e)
        return []
    out: list[KnowledgeNugget] = []
    for r in rows:
        meta = r.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:  # noqa: BLE001
                meta = {}
        last_seen = r.get("last_seen_at")
        out.append(
            KnowledgeNugget(
                topic=str(r.get("topic") or ""),
                summary_vi=str(r.get("summary_vi") or ""),
                intent=r.get("intent"),
                template_key=r.get("template_key"),
                time_range_from=r.get("time_range_from"),
                time_range_to=r.get("time_range_to"),
                metadata=meta if isinstance(meta, dict) else {},
                similarity=None,
                last_seen_at=last_seen.isoformat() if last_seen else None,
                hit_count=int(r.get("hit_count") or 0),
            )
        )
    return out


def to_dicts(nuggets: Iterable[KnowledgeNugget]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in nuggets:
        item: dict[str, Any] = {
            "topic": n.topic,
            "summary_vi": n.summary_vi,
        }
        if n.intent:
            item["intent"] = n.intent
        if n.template_key:
            item["template_key"] = n.template_key
        if n.time_range_from or n.time_range_to:
            item["time_range"] = {
                "from_date": n.time_range_from.isoformat() if n.time_range_from else None,
                "to_date": n.time_range_to.isoformat() if n.time_range_to else None,
            }
        if n.metadata:
            item["metadata"] = n.metadata
        if n.similarity is not None:
            item["similarity"] = round(n.similarity, 4)
        if n.last_seen_at:
            item["last_seen_at"] = n.last_seen_at
        if n.hit_count is not None:
            item["hit_count"] = n.hit_count
        out.append(item)
    return out
