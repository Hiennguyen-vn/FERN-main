from __future__ import annotations

import copy

import app.runtime_catalog as runtime_catalog
from app.query_policy import intent_mapping as intent_mod
from app.query_policy import policy as policy_mod
from app.query_policy import verified_queries as verified_mod
from app.rbac import policy as rbac_mod
from app.templates import registry as registry_mod


def test_runtime_catalog_loader_uses_cache(monkeypatch):
    calls: list[int] = []

    def fake_execute(sql, params):
        calls.append(1)
        return [{"catalog_version": 7, "payload_json": {"hello": {"value": 1}}}]

    monkeypatch.setattr(runtime_catalog, "execute_readonly", fake_execute)
    runtime_catalog.clear_runtime_catalog_cache()

    version, payload = runtime_catalog.load_runtime_catalog(force=True)
    assert version == 7
    assert payload == {"hello": {"value": 1}}

    version2, payload2 = runtime_catalog.load_runtime_catalog()
    assert version2 == 7
    assert payload2 == {"hello": {"value": 1}}
    assert len(calls) == 1


def test_runtime_catalog_overrides_selected_sections(monkeypatch):
    template_snapshot = copy.deepcopy(registry_mod.TEMPLATES)
    rbac_snapshot = copy.deepcopy(rbac_mod.TEMPLATE_ROLE_RESTRICTIONS)
    intents_snapshot = dict(intent_mod._TEMPLATE_INTENTS)
    verified_snapshot = tuple(verified_mod.VERIFIED_QUERY_ASSETS)
    query_snapshot = {
        "TEMPLATE_DATASETS": dict(policy_mod.TEMPLATE_DATASETS),
        "TEMPLATE_DATASET_GROUPS": {k: tuple(v) for k, v in policy_mod.TEMPLATE_DATASET_GROUPS.items()},
        "TABLE_BLOCKED_SELECT_COLUMNS": {k: frozenset(v) for k, v in policy_mod.TABLE_BLOCKED_SELECT_COLUMNS.items()},
        "CODEGEN_TIME_FILTER_REQUIRED_TABLES": set(policy_mod.CODEGEN_TIME_FILTER_REQUIRED_TABLES),
        "INTENT_TABLE_PRIORITY": {k: tuple(v) for k, v in policy_mod._INTENT_TABLE_PRIORITY.items()},
        "INTENT_DOMAIN_PRIORITY": {k: tuple(v) for k, v in policy_mod._INTENT_DOMAIN_PRIORITY.items()},
        "METRIC_DEFINITIONS": tuple(policy_mod.METRIC_DEFINITIONS),
        "VALUE_ALIASES": tuple(policy_mod.VALUE_ALIASES),
    }

    payload = {
        "template_registry": {
            "templates": {
                "T99_demo": {"key": "T99_demo", "required_params": ["from_date"], "optional_params": []}
            }
        },
        "template_rbac": {
            "template_role_restrictions": {"T99_demo": ["admin", "finance"]}
        },
        "intent_mapping": {
            "template_intents": {"T99_demo": "revenue"}
        },
        "verified_queries": {
            "assets": [
                {
                    "template_key": "T99_demo",
                    "metric_ids": ["net_revenue"],
                    "question_patterns": [r"demo"],
                    "required_slots": ["from_date"],
                    "time_column": "business_date",
                    "outlet_column": "outlet_id",
                    "golden_cases": ["demo-case"],
                    "confidence": 0.91,
                }
            ]
        },
        "query_policy": {
            "template_datasets": {"T99_demo": "analytics.ai_sales_daily"},
            "template_dataset_groups": {"T99_demo": ["analytics.ai_sales_daily"]},
            "table_blocked_select_columns": {"cdc.outlet": ["phone"]},
            "codegen_time_filter_required_tables": ["cdc.payment"],
            "intent_table_priority": {"unknown": ["analytics.ai_sales_daily"]},
            "intent_domain_priority": {"unknown": ["sales"]},
            "metric_definitions": [{"id": "net_revenue", "canonical_name": "net_revenue"}],
            "value_aliases": [{"canonical_name": "CARD", "canonical_type": "payment_method"}],
        },
    }

    monkeypatch.setattr(registry_mod, "get_runtime_catalog_section", lambda name, force=False: (1, payload.get(name)))
    monkeypatch.setattr(rbac_mod, "get_runtime_catalog_section", lambda name, force=False: (1, payload.get(name)))
    monkeypatch.setattr(intent_mod, "get_runtime_catalog_section", lambda name, force=False: (1, payload.get(name)))
    monkeypatch.setattr(verified_mod, "get_runtime_catalog_section", lambda name, force=False: (1, payload.get(name)))
    monkeypatch.setattr(policy_mod, "get_runtime_catalog_section", lambda name, force=False: (1, payload.get(name)))

    try:
        registry_mod.ensure_runtime_templates_loaded(force=True)
        rbac_mod.ensure_runtime_template_rbac_loaded(force=True)
        intent_mod.ensure_runtime_intent_mapping_loaded(force=True)
        verified_mod.ensure_runtime_verified_queries_loaded(force=True)
        policy_mod.ensure_runtime_query_policy_loaded(force=True)

        assert "T99_demo" in registry_mod.TEMPLATES
        assert registry_mod.TEMPLATES["T99_demo"].required_params == ("from_date",)
        assert rbac_mod.check_template_access("T99_demo", frozenset({"admin"}))
        assert intent_mod.intent_for_template("T99_demo") == "revenue"
        assert verified_mod.select_verified_query(
            question="demo query",
            intent="revenue",
            time_range={"from_date": "2026-01-01", "to_date": "2026-01-31"},
        )
        assert policy_mod.dataset_for_template("T99_demo") == "analytics.ai_sales_daily"
        assert policy_mod.datasets_for_template("T99_demo") == ("analytics.ai_sales_daily",)
        assert "phone" in policy_mod.TABLE_BLOCKED_SELECT_COLUMNS["cdc.outlet"]
        assert "cdc.payment" in policy_mod.CODEGEN_TIME_FILTER_REQUIRED_TABLES
        assert policy_mod.tables_for_intent("unknown", max_tables=1) == ["analytics.ai_sales_daily"]
        assert intent_mod.intent_for_route_and_template(route="visualization_request", template_key="T99_demo") == "trend"
    finally:
        registry_mod.TEMPLATES.clear()
        registry_mod.TEMPLATES.update(template_snapshot)
        rbac_mod.TEMPLATE_ROLE_RESTRICTIONS.clear()
        rbac_mod.TEMPLATE_ROLE_RESTRICTIONS.update(rbac_snapshot)
        intent_mod._TEMPLATE_INTENTS.clear()
        intent_mod._TEMPLATE_INTENTS.update(intents_snapshot)
        verified_mod.VERIFIED_QUERY_ASSETS = verified_snapshot
        policy_mod.TEMPLATE_DATASETS.clear()
        policy_mod.TEMPLATE_DATASETS.update(query_snapshot["TEMPLATE_DATASETS"])
        policy_mod.TEMPLATE_DATASET_GROUPS.clear()
        policy_mod.TEMPLATE_DATASET_GROUPS.update(query_snapshot["TEMPLATE_DATASET_GROUPS"])
        policy_mod.TABLE_BLOCKED_SELECT_COLUMNS.clear()
        policy_mod.TABLE_BLOCKED_SELECT_COLUMNS.update(query_snapshot["TABLE_BLOCKED_SELECT_COLUMNS"])
        policy_mod.CODEGEN_TIME_FILTER_REQUIRED_TABLES.clear()
        policy_mod.CODEGEN_TIME_FILTER_REQUIRED_TABLES.update(query_snapshot["CODEGEN_TIME_FILTER_REQUIRED_TABLES"])
        policy_mod._INTENT_TABLE_PRIORITY.clear()
        policy_mod._INTENT_TABLE_PRIORITY.update(query_snapshot["INTENT_TABLE_PRIORITY"])
        policy_mod._INTENT_DOMAIN_PRIORITY.clear()
        policy_mod._INTENT_DOMAIN_PRIORITY.update(query_snapshot["INTENT_DOMAIN_PRIORITY"])
        policy_mod.METRIC_DEFINITIONS = query_snapshot["METRIC_DEFINITIONS"]
        policy_mod.VALUE_ALIASES = query_snapshot["VALUE_ALIASES"]
        policy_mod._rebuild_policy_derived_state()
