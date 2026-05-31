"""Resolve entity names → IDs via OpenSearch (BM25+KNN) + ClickHouse fallback."""
import logging
import re

from app.clients.clickhouse import fetch_outlet_id_by_code_exact, fetch_outlet_id_by_name_like
from app.clients.opensearch import hybrid_search_aliases
from app.config import get_settings
from app.graph.nodes.contextualizer import effective_question
from app.graph.state import GraphState
from app.llm.openai_client import embed
from app.rbac.policy import has_global_scope

logger = logging.getLogger(__name__)

AUTO_RESOLVE_THRESHOLD = 0.85
_OUTLET_CODE_RE = re.compile(r"\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}-OUT-\d{1,6}\b", re.IGNORECASE)
_NUMERIC_OUTLET_RE = re.compile(r"\b(?:outlet|cua\s+hang|cửa\s+hàng)\s+(\d{1,6})\b", re.IGNORECASE)


async def _resolve_one(term: str, canonical_type: str) -> dict | None:
    if not get_settings().opensearch_enabled:
        return None
    emb = None
    if get_settings().openai_embeddings_enabled:
        try:
            emb = await embed(term)
        except Exception as e:  # noqa: BLE001
            logger.warning("Embedding failed, BM25-only: %s", e)
    try:
        hits = hybrid_search_aliases(text=term, embedding=emb, canonical_type=canonical_type, size=3)
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenSearch failed: %s", e)
        hits = []
    if hits and hits[0]["_score"] >= AUTO_RESOLVE_THRESHOLD:
        return hits[0]
    return None


def _append_unique_int(values: list[int], value: int) -> None:
    if value not in values:
        values.append(value)


def _outlet_codes_from_state(state: GraphState) -> list[str]:
    current_text = str(state.get("normalized_question") or state.get("raw_question") or "")
    if state.get("contextualization_source") == "rule_short_filter_followup":
        texts: list[str] = [current_text]
    else:
        texts = [
            effective_question(state),
            current_text,
            str(state.get("raw_question") or ""),
        ]
    raw = state.get("raw_entities", {}) or {}
    if state.get("contextualization_source") != "rule_short_filter_followup":
        for item in raw.get("outlet_names", []) or []:
            texts.append(str(item))

    codes: list[str] = []
    for text in texts:
        for match in _OUTLET_CODE_RE.finditer(text or ""):
            code = match.group(0).upper()
            if code not in codes:
                codes.append(code)
    return codes


def _outlet_name_terms_from_state(state: GraphState) -> list[str]:
    """Use the current short filter as an override instead of inheriting prior outlet terms."""
    def _append_numeric_terms(text: str, values: list[str]) -> None:
        for match in _NUMERIC_OUTLET_RE.finditer(text or ""):
            term = f"outlet {match.group(1)}"
            if term not in values:
                values.append(term)

    if state.get("contextualization_source") == "rule_short_filter_followup":
        current = str(state.get("normalized_question") or state.get("raw_question") or "")
        terms = [m.group(0).strip() for m in re.finditer(r"\boutlet\s+[\w-]+", current, re.IGNORECASE)]
        _append_numeric_terms(current, terms)
        return terms
    raw = state.get("raw_entities", {}) or {}
    terms = [str(x).strip() for x in raw.get("outlet_names", []) or [] if str(x).strip()]
    for text in (
        effective_question(state),
        str(state.get("normalized_question") or ""),
        str(state.get("raw_question") or ""),
    ):
        _append_numeric_terms(text, terms)
    return terms


async def entity_resolver(state: GraphState) -> GraphState:
    auth = state["auth"]
    raw = state.get("raw_entities", {}) or {}
    preset = state.get("resolved_entities") or {}
    resolved: dict[str, list[int]] = {
        "outlet_ids": [int(x) for x in (preset.get("outlet_ids") or [])],
        "product_ids": [int(x) for x in (preset.get("product_ids") or [])],
        "category_ids": [int(x) for x in (preset.get("category_ids") or [])],
    }

    # Outlets
    exact_codes = _outlet_codes_from_state(state)
    for code in exact_codes:
        try:
            rows = fetch_outlet_id_by_code_exact(code, limit=1)
        except Exception as e:  # noqa: BLE001
            logger.warning("ClickHouse outlet exact-code lookup failed: %s", e)
            rows = []
        if rows:
            _append_unique_int(resolved["outlet_ids"], int(rows[0]["outlet_id"]))

    use_current_filter_only = state.get("contextualization_source") == "rule_short_filter_followup"
    if not exact_codes:
        for name in _outlet_name_terms_from_state(state):
            try:
                rows = fetch_outlet_id_by_name_like(name, limit=1)
            except Exception as e:  # noqa: BLE001
                logger.warning("ClickHouse outlet fallback failed: %s", e)
                rows = []
            if rows:
                _append_unique_int(resolved["outlet_ids"], int(rows[0]["outlet_id"]))
                continue
            hit = None if use_current_filter_only else await _resolve_one(name, "outlet")
            if hit and hit.get("canonical_id") is not None:
                _append_unique_int(resolved["outlet_ids"], int(hit["canonical_id"]))

    # Filter outlet_ids to auth scope; finance/admin global scope is expanded in RBAC injector.
    if not has_global_scope(auth.roles):
        resolved["outlet_ids"] = [x for x in resolved["outlet_ids"] if x in auth.outlet_ids]

    # Products
    for name in raw.get("product_names", []):
        hit = await _resolve_one(name, "product")
        if hit and hit.get("canonical_id") is not None:
            resolved["product_ids"].append(int(hit["canonical_id"]))

    # Categories
    for name in raw.get("categories", []):
        hit = await _resolve_one(name, "category")
        if hit and hit.get("canonical_id") is not None:
            resolved["category_ids"].append(int(hit["canonical_id"]))

    state["resolved_entities"] = resolved
    state.setdefault("trace", []).append(
        {
            "node": "entity_resolver",
            "outlet_count": len(resolved["outlet_ids"]),
            "product_count": len(resolved["product_ids"]),
            "category_count": len(resolved["category_ids"]),
        }
    )
    return state
