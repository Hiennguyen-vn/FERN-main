#!/usr/bin/env python3
"""Orchestrate offline RAG refresh: ClickHouse catalog YAML → OpenSearch bulk embed.

Runs, in order:
1. ``export_catalog_snapshot.py`` — whitelist-only ``system.columns`` → ``knowledge/catalog_snapshot.yaml``
2. ``seed_knowledge_catalog.py`` — aliases + templates + catalog embeddings into OpenSearch

Prerequisites (see each script): reachable ClickHouse for (1); OPENAI_API_KEY + OpenSearch for (2).

Usage:
    python scripts/sync_rag_offline.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    export_py = ROOT / "scripts" / "export_catalog_snapshot.py"
    seed_py = ROOT / "scripts" / "seed_knowledge_catalog.py"
    py = sys.executable
    r1 = subprocess.run([py, str(export_py)], cwd=str(ROOT), check=False)
    if r1.returncode != 0:
        return int(r1.returncode)
    r2 = subprocess.run([py, str(seed_py)], cwd=str(ROOT), check=False)
    return int(r2.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
