from unittest.mock import patch

import pytest

from app.auth.context import AuthContext
from app.query_modes.codegen.generator import codegen_generator


@pytest.mark.asyncio
async def test_generator_prompt_uses_semantic_candidate_pack_not_full_allowlist():
    captured = {}

    async def fake_llm_call_json(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        return (
            {
                "proposed_sql": (
                    "SELECT business_date, sum(net_revenue) AS revenue "
                    "FROM analytics.ai_sales_daily "
                    "WHERE business_date >= toDate('2026-05-01') "
                    "GROUP BY business_date"
                ),
                "rationale_vi": "Dùng metric view doanh thu.",
                "assumption_vi": "Backend inject outlet.",
                "tables_used": ["analytics.ai_sales_daily"],
            },
            {"tokens_in": 1, "tokens_out": 1, "latency_ms": 1},
        )

    state = {
        "auth": AuthContext(
            user_id=1,
            session_id="s",
            roles=frozenset({"finance"}),
            permissions=frozenset(),
            outlet_ids=frozenset({1}),
        ),
        "normalized_question": "doanh thu tháng này theo ngày",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "resolved_entities": {},
        "trace": [],
    }

    with patch("app.query_modes.codegen.generator.llm_call_json", side_effect=fake_llm_call_json):
        out = await codegen_generator(state)

    prompt = captured["user_prompt"]
    assert "analytics.ai_sales_daily" in prompt
    assert "cdc.outlet" in prompt
    assert "fern.events_expense_created" not in prompt
    assert out["codegen_candidate_tables"]
    assert out["codegen_tables_used"] == ["analytics.ai_sales_daily"]
