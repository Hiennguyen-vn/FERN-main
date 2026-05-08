"""Seed OpenSearch ai_aliases + ai_templates + ai_catalog from YAML and ClickHouse dim_outlet.

Usage:
    python scripts/export_catalog_snapshot.py   # refresh knowledge/catalog_snapshot.yaml (needs CH)
    python scripts/seed_knowledge_catalog.py

Outlets are loaded dynamically from fern.dim_outlet (not hard-coded in YAML).
"""
import asyncio
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import yaml
from opensearchpy import OpenSearch, helpers

from app.clients.clickhouse import get_ch_client
from app.config import get_settings
from app.llm.openai_client import embed
from app.query_policy import learned_scenario_rows
from app.query_policy.policy import METRIC_DEFINITIONS, VALUE_ALIASES, data_source_policy_rows, table_policy_rows
from app.templates.registry import TEMPLATES


KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge"


def stable_doc_id(namespace: str, *parts: object) -> str:
    """Build deterministic OpenSearch IDs so offline seed can be rerun safely."""
    payload = json.dumps([namespace, *parts], ensure_ascii=False, sort_keys=True, default=str)
    return f"{namespace}:{hashlib.sha1(payload.encode('utf-8')).hexdigest()}"


def strip_accents(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s)
    ascii_s = "".join(c for c in nfkd if not unicodedata.combining(c))
    return ascii_s.replace("đ", "d").replace("Đ", "D")


def generate_outlet_aliases(name: str) -> list[str]:
    """E.g. 'Outlet Quận 1 - Nguyễn Trãi' → ['outlet quan 1 - nguyen trai', 'q1', 'quan 1', ...]."""
    name_ascii = strip_accents(name).lower().strip()
    aliases = [name_ascii]
    if m := re.search(r"quan\s+(\d+)", name_ascii):
        n = m.group(1)
        aliases.extend([f"q{n}", f"quan {n}", f"outlet q{n}", f"chi nhanh q{n}", f"chi nhanh quan {n}"])
    if " - " in name_ascii:
        aliases.extend(p.strip() for p in name_ascii.split(" - "))
    for prefix in ("outlet ", "chi nhanh "):
        if name_ascii.startswith(prefix):
            aliases.append(name_ascii[len(prefix):])
    seen: set[str] = set()
    return [a for a in aliases if a and not (a in seen or seen.add(a))]


async def _embed_text(text: str) -> list[float] | None:
    if not get_settings().openai_embeddings_enabled:
        return None
    try:
        return await embed(text)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: embedding failed, seeding BM25-only doc: {e}")
        return None


def _with_embedding(source: dict, embedding: list[float] | None) -> dict:
    if embedding:
        source["embedding"] = embedding
    return source


async def seed_aliases(client: OpenSearch, index: str):
    yaml_data = yaml.safe_load((KNOWLEDGE_DIR / "aliases.yaml").read_text(encoding="utf-8")) or {}

    actions = []

    # Static categories + metrics
    for entity_type in ("categories", "metrics"):
        for entry in yaml_data.get(entity_type, []) or []:
            text = " ".join(entry["alias_vi"])
            emb = await _embed_text(text)
            source = {
                "alias_vi": text,
                "canonical_type": entry["canonical_type"],
                "canonical_id": entry.get("canonical_id"),
                "canonical_name": entry["canonical_name"],
            }
            actions.append({
                "_index": index,
                "_id": stable_doc_id(
                    "alias",
                    entry["canonical_type"],
                    entry.get("canonical_id"),
                    entry["canonical_name"],
                    text,
                ),
                "_source": _with_embedding(source, emb),
            })

    # Dynamic outlets from ClickHouse — use cdc.outlet (current CDC schema) instead of
    # the legacy fern.dim_outlet dimension table which may contain stale or missing rows.
    ch = get_ch_client()
    rows = ch.query(
        "SELECT id AS outlet_id, name FROM cdc.outlet FINAL WHERE __deleted != 'true'"
    ).result_rows
    for outlet_id, name in rows:
        aliases = generate_outlet_aliases(name)
        text = " ".join(aliases)
        emb = await _embed_text(text)
        source = {
            "alias_vi": text,
            "canonical_type": "outlet",
            "canonical_id": int(outlet_id),
            "canonical_name": name,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("alias", "outlet", int(outlet_id), name),
            "_source": _with_embedding(source, emb),
        })

    helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} aliases.")


async def seed_templates(client: OpenSearch, index: str):
    yaml_data = yaml.safe_load((KNOWLEDGE_DIR / "metrics.yaml").read_text(encoding="utf-8")) or {}
    actions = []
    for tpl in yaml_data.get("templates", []):
        key = tpl["key"]
        if key not in TEMPLATES:
            print(f"WARNING: template_key {key} not in registry, skipping")
            continue
        emb = await _embed_text(tpl["description_vi"])
        source = {
            "template_key": key,
            "description_vi": tpl["description_vi"],
            "intent": tpl["intent"],
            "required_params": tpl.get("required_params", []),
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("template", key),
            "_source": _with_embedding(source, emb),
        })
    helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} templates.")


async def seed_catalog_snapshots(client: OpenSearch, index: str):
    path = KNOWLEDGE_DIR / "catalog_snapshot.yaml"
    if not path.exists():
        print("catalog_snapshot.yaml missing — run scripts/export_catalog_snapshot.py or skip.")
        return

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    snaps = raw.get("snapshots") or []
    if not snaps:
        print("catalog_snapshot.yaml has empty snapshots — skip catalog index seed.")
        return

    actions = []
    for doc in snaps:
        ft = (doc.get("full_table") or "").strip()
        sv = (doc.get("summary_vi") or "").strip()
        if not ft or not sv:
            continue
        emb = await _embed_text(sv[:8000])
        source = {
            "full_table": ft,
            "summary_vi": sv[:32000],
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("catalog", ft),
            "_source": _with_embedding(source, emb),
        })

    if not actions:
        print("No valid catalog snapshot rows — skip.")
        return

    helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} catalog snapshots.")


async def seed_semantic_metadata(client: OpenSearch, index: str):
    actions = []

    for metric in METRIC_DEFINITIONS:
        aliases = list(metric.get("aliases") or [])
        text = " ".join([
            str(metric.get("canonical_name") or ""),
            " ".join(aliases),
            str(metric.get("definition_vi") or ""),
            str(metric.get("preferred_table") or ""),
        ]).strip()
        emb = await _embed_text(text[:8000])
        source = {
            "doc_type": "metric",
            "canonical_type": "metric",
            "canonical_name": metric.get("canonical_name"),
            "aliases": aliases,
            "definition_vi": metric.get("definition_vi"),
            "full_table": metric.get("preferred_table"),
            "search_text": text,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("metadata", "metric", metric.get("canonical_name"), metric.get("preferred_table")),
            "_source": _with_embedding(source, emb),
        })

    for alias in VALUE_ALIASES:
        aliases = list(alias.get("aliases") or [])
        text = " ".join([
            str(alias.get("canonical_type") or ""),
            str(alias.get("canonical_name") or ""),
            " ".join(aliases),
            str(alias.get("filter_expression") or ""),
            str(alias.get("caveat_vi") or ""),
        ]).strip()
        emb = await _embed_text(text[:8000])
        source = {
            "doc_type": "value_alias",
            "canonical_type": alias.get("canonical_type"),
            "canonical_name": alias.get("canonical_name"),
            "aliases": aliases,
            "definition_vi": alias.get("filter_expression"),
            "summary_vi": alias.get("caveat_vi"),
            "search_text": text,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id(
                "metadata",
                "value_alias",
                alias.get("canonical_type"),
                alias.get("canonical_name"),
                alias.get("filter_expression"),
            ),
            "_source": _with_embedding(source, emb),
        })

    for row in table_policy_rows():
        text = " ".join([
            row["full_table"],
            row.get("description_vi") or "",
            row.get("grain") or "",
            " ".join(row.get("metrics") or []),
        ]).strip()
        emb = await _embed_text(text[:8000])
        source = {
            "doc_type": "table",
            "canonical_type": "table",
            "canonical_name": row["full_table"],
            "full_table": row["full_table"],
            "definition_vi": row.get("description_vi"),
            "summary_vi": f"grain={row.get('grain')}; time={row.get('time_column')}; outlet={row.get('outlet_column')}",
            "search_text": text,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("metadata", "table", row["full_table"]),
            "_source": _with_embedding(source, emb),
        })

    for row in data_source_policy_rows():
        text = " ".join([
            row["dataset"],
            row.get("domain") or "",
            row.get("source_system") or "",
            row.get("storage") or "",
            row.get("time_column") or "",
            row.get("time_semantics_vi") or "",
            row.get("available_range_strategy") or "",
            row.get("freshness_label_vi") or "",
            " ".join(row.get("preferred_for_metrics") or []),
        ]).strip()
        emb = await _embed_text(text[:8000])
        source = {
            "doc_type": "data_source",
            "canonical_type": "data_source",
            "canonical_name": row["dataset"],
            "full_table": row["dataset"],
            "definition_vi": row.get("time_semantics_vi"),
            "summary_vi": (
                f"domain={row.get('domain')}; source_system={row.get('source_system')}; "
                f"storage={row.get('storage')}; time={row.get('time_column')}; "
                f"coverage={row.get('available_range_strategy')}; freshness={row.get('freshness_label_vi')}"
            ),
            "source_system": row.get("source_system"),
            "storage": row.get("storage"),
            "time_column": row.get("time_column"),
            "time_semantics_vi": row.get("time_semantics_vi"),
            "preferred_for_metrics": row.get("preferred_for_metrics") or [],
            "search_text": text,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("metadata", "data_source", row["dataset"]),
            "_source": _with_embedding(source, emb),
        })

    if actions:
        helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} semantic metadata docs.")


async def seed_learned_scenarios(client: OpenSearch, index: str):
    rows = learned_scenario_rows()
    actions = []
    for row in rows:
        text = " ".join(
            [
                str(row.get("template_key") or ""),
                str(row.get("intent") or ""),
                str(row.get("domain") or ""),
                str(row.get("task_type") or ""),
                " ".join(row.get("metric_ids") or []),
                " ".join(str(x) for x in (row.get("report_spec") or {}).values() if x),
                " ".join(row.get("example_questions") or []),
            ]
        ).strip()
        emb = await _embed_text(text[:8000])
        source = {
            "doc_type": "learned_scenario",
            "canonical_type": "learned_scenario",
            "canonical_name": row.get("scenario_key"),
            "template_key": row.get("template_key"),
            "definition_vi": (
                f"intent={row.get('intent')}; domain={row.get('domain')}; "
                f"task_type={row.get('task_type')}; report_spec={json.dumps(row.get('report_spec') or {}, ensure_ascii=False)}"
            ),
            "summary_vi": " / ".join(row.get("example_questions") or []),
            "search_text": text,
        }
        actions.append({
            "_index": index,
            "_id": stable_doc_id("metadata", "learned_scenario", row.get("scenario_key")),
            "_source": _with_embedding(source, emb),
        })

    if actions:
        helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} learned scenario docs.")


async def main():
    s = get_settings()
    client = OpenSearch(hosts=[s.opensearch_url], verify_certs=False, ssl_show_warn=False)

    await seed_aliases(client, s.opensearch_aliases_index)
    await seed_templates(client, s.opensearch_templates_index)
    await seed_catalog_snapshots(client, s.opensearch_catalog_index)
    await seed_semantic_metadata(client, s.opensearch_metadata_index)
    await seed_learned_scenarios(client, s.opensearch_metadata_index)

    print("Done.")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
