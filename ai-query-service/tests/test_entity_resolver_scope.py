import pytest

from app.auth.context import AuthContext
from app.clients import clickhouse as ch
from app.graph.nodes import entity_resolver as er


def _auth(roles: set[str], outlets: set[int]) -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset(roles),
        permissions=frozenset(),
        outlet_ids=frozenset(outlets),
    )


@pytest.mark.asyncio
async def test_entity_resolver_keeps_requested_outlet_for_global_role(monkeypatch):
    async def fake_resolve_one(term: str, canonical_type: str):
        return {"canonical_id": 99, "canonical_type": canonical_type}

    monkeypatch.setattr(er, "_resolve_one", fake_resolve_one)
    state = {
        "auth": _auth({"finance"}, {1}),
        "raw_entities": {"outlet_names": ["remote outlet"], "product_names": [], "categories": []},
    }
    out = await er.entity_resolver(state)
    assert out["resolved_entities"]["outlet_ids"] == [99]


@pytest.mark.asyncio
async def test_entity_resolver_filters_requested_outlet_for_local_role(monkeypatch):
    async def fake_resolve_one(term: str, canonical_type: str):
        return {"canonical_id": 99, "canonical_type": canonical_type}

    monkeypatch.setattr(er, "_resolve_one", fake_resolve_one)
    state = {
        "auth": _auth({"outlet_manager"}, {1}),
        "raw_entities": {"outlet_names": ["remote outlet"], "product_names": [], "categories": []},
    }
    out = await er.entity_resolver(state)
    assert out["resolved_entities"]["outlet_ids"] == []


@pytest.mark.asyncio
async def test_entity_resolver_prefers_exact_outlet_code_over_fuzzy_alias(monkeypatch):
    async def fail_resolve_one(*_args, **_kwargs):
        raise AssertionError("OpenSearch fuzzy resolver should not run when exact outlet code is present")

    monkeypatch.setattr(er, "_resolve_one", fail_resolve_one)
    monkeypatch.setattr(
        er,
        "fetch_outlet_id_by_code_exact",
        lambda code, limit=5: [
            {
                "outlet_id": 3485603532616777729,
                "code": "SIM-SMALL-OUT-0001",
                "name": "Outlet 1 - VN-HCM",
            }
        ],
    )

    state = {
        "auth": _auth({"admin"}, {1}),
        "normalized_question": "tôi muốn thông tin chi tiết của Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001) - active",
        "raw_entities": {
            "outlet_names": ["Outlet 1"],
            "product_names": [],
            "categories": [],
        },
        "trace": [],
    }

    out = await er.entity_resolver(state)

    assert out["resolved_entities"]["outlet_ids"] == [3485603532616777729]


@pytest.mark.asyncio
async def test_short_filter_followup_skips_fuzzy_alias_and_uses_current_outlet(monkeypatch):
    async def fail_resolve_one(*_args, **_kwargs):
        raise AssertionError("Short outlet follow-up must not use fuzzy alias from prior context")

    monkeypatch.setattr(er, "_resolve_one", fail_resolve_one)
    monkeypatch.setattr(er, "fetch_outlet_id_by_code_exact", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        er,
        "fetch_outlet_id_by_name_like",
        lambda term, limit=1: [{"outlet_id": 2, "code": "SIM-SMALL-OUT-0002", "name": "Outlet VN-HCM-2"}],
    )

    state = {
        "auth": _auth({"outlet_manager"}, {1, 2}),
        "normalized_question": "còn outlet 2",
        "contextualized_question": "doanh thu tuần này của outlet 1 còn outlet 2",
        "contextualization_source": "rule_short_filter_followup",
        "raw_entities": {"outlet_names": ["outlet 1", "outlet 2"], "product_names": [], "categories": []},
        "trace": [],
    }

    out = await er.entity_resolver(state)

    assert out["resolved_entities"]["outlet_ids"] == [2]


def test_clickhouse_outlet_numeric_fallback_matches_code_suffix(monkeypatch):
    captured = {}

    def fake_execute(sql):
        captured["sql"] = sql
        return [{"outlet_id": 2, "code": "SIM-SMALL-OUT-0002", "name": "Outlet VN-HCM-2"}]

    monkeypatch.setattr(ch, "execute_query", fake_execute)

    rows = ch.fetch_outlet_id_by_name_like("outlet 2")

    assert rows[0]["outlet_id"] == 2
    assert "replaceRegexpAll(code, '^.*-0*', '') = '2'" in captured["sql"]
