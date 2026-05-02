"""Seed OpenSearch ai_aliases + ai_templates from YAML and ClickHouse dim_outlet.

Usage:
    python scripts/seed_knowledge_catalog.py

Outlets are loaded dynamically from fern.dim_outlet (not hard-coded in YAML).
"""
import asyncio
import re
import sys
import unicodedata
from pathlib import Path

import yaml
from opensearchpy import OpenSearch, helpers

from app.clients.clickhouse import fetch_all_outlet_ids, get_ch_client
from app.config import get_settings
from app.llm.openai_client import embed
from app.templates.registry import TEMPLATES


KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge"


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


async def _embed_text(text: str) -> list[float]:
    return await embed(text)


async def seed_aliases(client: OpenSearch, index: str):
    yaml_data = yaml.safe_load((KNOWLEDGE_DIR / "aliases.yaml").read_text(encoding="utf-8")) or {}

    actions = []

    # Static categories + metrics
    for entity_type in ("categories", "metrics"):
        for entry in yaml_data.get(entity_type, []) or []:
            text = " ".join(entry["alias_vi"])
            emb = await _embed_text(text)
            actions.append({
                "_index": index,
                "_source": {
                    "alias_vi": text,
                    "canonical_type": entry["canonical_type"],
                    "canonical_id": entry.get("canonical_id"),
                    "canonical_name": entry["canonical_name"],
                    "embedding": emb,
                },
            })

    # Dynamic outlets from ClickHouse
    ch = get_ch_client()
    rows = ch.query("SELECT outlet_id, name FROM fern.dim_outlet FINAL").result_rows
    for outlet_id, name in rows:
        aliases = generate_outlet_aliases(name)
        text = " ".join(aliases)
        emb = await _embed_text(text)
        actions.append({
            "_index": index,
            "_source": {
                "alias_vi": text,
                "canonical_type": "outlet",
                "canonical_id": int(outlet_id),
                "canonical_name": name,
                "embedding": emb,
            },
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
        actions.append({
            "_index": index,
            "_source": {
                "template_key": key,
                "description_vi": tpl["description_vi"],
                "intent": tpl["intent"],
                "required_params": tpl.get("required_params", []),
                "embedding": emb,
            },
        })
    helpers.bulk(client, actions)
    print(f"Seeded {len(actions)} templates.")


async def main():
    s = get_settings()
    client = OpenSearch(hosts=[s.opensearch_url], verify_certs=False, ssl_show_warn=False)

    await seed_aliases(client, s.opensearch_aliases_index)
    await seed_templates(client, s.opensearch_templates_index)

    print("Done.")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
