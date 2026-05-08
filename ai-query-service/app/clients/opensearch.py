from typing import Any

from opensearchpy import OpenSearch

from app.config import get_settings


_client: OpenSearch | None = None


def get_os_client() -> OpenSearch:
    global _client
    if _client is None:
        s = get_settings()
        _client = OpenSearch(hosts=[s.opensearch_url], verify_certs=False, ssl_show_warn=False)
    return _client


def hybrid_search_aliases(
    *,
    text: str,
    embedding: list[float] | None = None,
    canonical_type: str | None = None,
    size: int = 5,
) -> list[dict[str, Any]]:
    s = get_settings()
    client = get_os_client()

    should: list[dict] = [
        {"match": {"alias_vi": {"query": text, "boost": 2.0}}},
    ]
    if embedding is not None:
        should.append({
            "knn": {"embedding": {"vector": embedding, "k": size, "boost": 1.0}}
        })

    query: dict[str, Any] = {"size": size, "query": {"bool": {"should": should}}}
    if canonical_type:
        query["query"]["bool"]["filter"] = [{"term": {"canonical_type": canonical_type}}]

    resp = client.search(index=s.opensearch_aliases_index, body=query)
    hits = resp.get("hits", {}).get("hits", [])
    return [{"_score": h["_score"], **h["_source"]} for h in hits]


def hybrid_search_templates(
    *,
    text: str,
    embedding: list[float] | None = None,
    intent: str | None = None,
    size: int = 3,
) -> list[dict[str, Any]]:
    s = get_settings()
    client = get_os_client()

    should: list[dict] = [
        {"match": {"description_vi": {"query": text, "boost": 2.0}}},
    ]
    if embedding is not None:
        should.append({
            "knn": {"embedding": {"vector": embedding, "k": size, "boost": 1.0}}
        })

    query: dict[str, Any] = {"size": size, "query": {"bool": {"should": should}}}
    if intent:
        query["query"]["bool"]["filter"] = [{"term": {"intent": intent}}]

    resp = client.search(index=s.opensearch_templates_index, body=query)
    hits = resp.get("hits", {}).get("hits", [])
    return [{"_score": h["_score"], **h["_source"]} for h in hits]


def hybrid_search_catalog_snapshots(
    *,
    text: str,
    embedding: list[float] | None = None,
    size: int = 3,
) -> list[dict[str, Any]]:
    """Hybrid BM25 + KNN over exported catalog summaries (`ai_catalog` index)."""
    s = get_settings()
    client = get_os_client()

    should: list[dict] = [
        {"match": {"summary_vi": {"query": text, "boost": 2.0}}},
    ]
    if embedding is not None:
        should.append({
            "knn": {"embedding": {"vector": embedding, "k": size, "boost": 1.0}}
        })

    query: dict[str, Any] = {"size": size, "query": {"bool": {"should": should}}}
    resp = client.search(index=s.opensearch_catalog_index, body=query)
    hits = resp.get("hits", {}).get("hits", [])
    return [{"_score": h["_score"], **h["_source"]} for h in hits]


def hybrid_search_metadata(
    *,
    text: str,
    embedding: list[float] | None = None,
    size: int = 5,
) -> list[dict[str, Any]]:
    """Hybrid BM25 + KNN over semantic metadata (`ai_metadata`)."""
    s = get_settings()
    client = get_os_client()

    should: list[dict] = [
        {"match": {"search_text": {"query": text, "boost": 2.0}}},
        {"match": {"aliases": {"query": text, "boost": 2.5}}},
    ]
    if embedding is not None:
        should.append({
            "knn": {"embedding": {"vector": embedding, "k": size, "boost": 1.0}}
        })

    query: dict[str, Any] = {"size": size, "query": {"bool": {"should": should}}}
    resp = client.search(index=s.opensearch_metadata_index, body=query)
    hits = resp.get("hits", {}).get("hits", [])
    return [{"_score": h["_score"], **h["_source"]} for h in hits]
