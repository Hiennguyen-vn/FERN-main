"""Resolve entity names → IDs via OpenSearch (BM25+KNN) + ClickHouse fallback."""
import logging

from app.clients.clickhouse import fetch_outlet_id_by_name_like
from app.clients.opensearch import hybrid_search_aliases
from app.graph.state import GraphState
from app.llm.openai_client import embed

logger = logging.getLogger(__name__)

AUTO_RESOLVE_THRESHOLD = 0.85


async def _resolve_one(term: str, canonical_type: str) -> dict | None:
    try:
        emb = await embed(term)
    except Exception as e:  # noqa: BLE001
        logger.warning("Embedding failed, BM25-only: %s", e)
        emb = None
    try:
        hits = hybrid_search_aliases(text=term, embedding=emb, canonical_type=canonical_type, size=3)
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenSearch failed: %s", e)
        hits = []
    if hits and hits[0]["_score"] >= AUTO_RESOLVE_THRESHOLD:
        return hits[0]
    return None


async def entity_resolver(state: GraphState) -> GraphState:
    auth = state["auth"]
    raw = state.get("raw_entities", {}) or {}
    resolved: dict[str, list[int]] = {"outlet_ids": [], "product_ids": [], "category_ids": []}

    # Outlets
    for name in raw.get("outlet_names", []):
        hit = await _resolve_one(name, "outlet")
        if hit and hit.get("canonical_id") is not None:
            resolved["outlet_ids"].append(int(hit["canonical_id"]))
        else:
            try:
                rows = fetch_outlet_id_by_name_like(name, limit=1)
            except Exception as e:  # noqa: BLE001
                logger.warning("ClickHouse outlet fallback failed: %s", e)
                rows = []
            if rows:
                resolved["outlet_ids"].append(int(rows[0]["outlet_id"]))

    # Filter outlet_ids to auth scope (CFO/ADMIN handled in rbac_injector)
    if "CFO" not in auth.roles and "ADMIN" not in auth.roles:
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
    return state
