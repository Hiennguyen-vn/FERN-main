from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.clients.postgres import _connect_direct  # noqa: E402
from app.query_policy.policy import (  # noqa: E402
    DATA_SOURCE_POLICIES,
    METRIC_DEFINITIONS,
    QUERY_DOMAINS,
    TABLE_BLOCKED_SELECT_COLUMNS,
    TABLE_POLICIES,
    TEMPLATE_DATASETS,
    TEMPLATE_DATASET_GROUPS,
    VALUE_ALIASES,
)
from app.query_policy.verified_queries import VERIFIED_QUERY_ASSETS  # noqa: E402
from app.query_policy.intent_mapping import _TEMPLATE_INTENTS  # noqa: E402
from app.rbac.policy import TEMPLATE_ROLE_RESTRICTIONS  # noqa: E402
from app.templates.registry import TEMPLATES  # noqa: E402
def build_payload() -> dict:
    return {
        "query_policy": {
            "table_policies": {k: vars(v) for k, v in TABLE_POLICIES.items()},
            "query_domains": {k: vars(v) for k, v in QUERY_DOMAINS.items()},
            "data_source_policies": {k: vars(v) for k, v in DATA_SOURCE_POLICIES.items()},
            "metric_definitions": list(METRIC_DEFINITIONS),
            "value_aliases": list(VALUE_ALIASES),
            "template_datasets": dict(TEMPLATE_DATASETS),
            "template_dataset_groups": {k: list(v) for k, v in TEMPLATE_DATASET_GROUPS.items()},
            "table_blocked_select_columns": {k: sorted(v) for k, v in TABLE_BLOCKED_SELECT_COLUMNS.items()},
        },
        "template_registry": {
            "templates": {k: vars(v) for k, v in TEMPLATES.items()},
        },
        "template_rbac": {
            "template_role_restrictions": {k: sorted(v) for k, v in TEMPLATE_ROLE_RESTRICTIONS.items()},
        },
        "verified_queries": {
            "assets": [vars(asset) for asset in VERIFIED_QUERY_ASSETS],
        },
        "intent_mapping": {
            "template_intents": dict(_TEMPLATE_INTENTS),
        },
    }


def main() -> int:
    payload = build_payload()
    blob = json.dumps(payload, ensure_ascii=False)
    upsert_sql = """
    INSERT INTO ai.ai_query_runtime_catalog (catalog_key, catalog_version, payload_json, is_active, updated_by)
    VALUES ('default', EXTRACT(EPOCH FROM NOW())::bigint, %(payload)s::jsonb, TRUE, 'sync_runtime_catalog.py')
    """
    with _connect_direct() as conn:
        with conn.cursor() as cur:
            cur.execute(upsert_sql, {"payload": blob})
    print("runtime catalog synced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
