"""Export allow-listed ClickHouse columns into knowledge/catalog_snapshot.yaml for RAG seeding.

Usage (requires reachable ClickHouse + OPENAI for embeddings at seed time, not here):
    python scripts/export_catalog_snapshot.py

Then bulk-index embeddings via:
    python scripts/seed_knowledge_catalog.py

Or one step:
    python scripts/sync_rag_offline.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE_DIR = ROOT / "knowledge"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.graph.tools.clickhouse_catalog import (  # noqa: E402
    ALLOWED_FULL_TABLES,
    fetch_columns_for_table,
    parse_allowed_full_table,
)


def _summary_vi(full_table: str, columns: list[dict]) -> str:
    lines = [
        f"Bảng `{full_table}` trong ClickHouse (FERN analytics / CDC).",
        "Danh sách cột (để chọn đúng báo cáo; không phải số liệu thực):",
    ]
    for row in columns:
        name = str(row.get("name", "")).strip()
        ctype = str(row.get("type", "")).strip()
        if name:
            lines.append(f"- {name}: {ctype}")
    return "\n".join(lines)


def main() -> int:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    snapshots: list[dict[str, str]] = []

    for full in sorted(ALLOWED_FULL_TABLES):
        parsed = parse_allowed_full_table(full)
        if not parsed:
            continue
        db, tbl = parsed
        try:
            cols = fetch_columns_for_table(db, tbl, max_columns=56)
        except Exception as e:  # noqa: BLE001
            print(f"WARN {full}: {e}")
            continue
        if not cols:
            continue
        snapshots.append({"full_table": full, "summary_vi": _summary_vi(full, cols)})

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshots": snapshots,
    }
    out = KNOWLEDGE_DIR / "catalog_snapshot.yaml"
    out.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"Wrote {len(snapshots)} table snapshots to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
