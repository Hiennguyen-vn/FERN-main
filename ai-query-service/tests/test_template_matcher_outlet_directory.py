import pytest

from app.graph.nodes import template_matcher as tm


@pytest.mark.asyncio
async def test_single_period_historical_revenue_uses_summary_fast_path(monkeypatch):
    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    async def fail_llm(**_kwargs):
        raise AssertionError("LLM should not be called for simple historical revenue")

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm)

    state = {
        "normalized_question": "doanh thu 1 năm trước",
        "intent": "revenue",
        "time_range": {"from_date": "2025-01-01", "to_date": "2025-12-31"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T32_period_revenue_summary"
    assert out["template_params"] == {"from_date": "2025-01-01", "to_date": "2025-12-31"}
    assert out["trace"][-1]["shortcut"] == "T32_period_revenue_summary"


@pytest.mark.asyncio
async def test_outlet_list_shortcut_matches_vietnamese_question():
    state = {
        "normalized_question": "tôi muốn hỏi hệ thống có những cửa hàng nào",
        "intent": "lookup",
        "time_range": {},
        "resolved_entities": {},
        "conversation_context": "",
    }
    out = await tm.template_matcher(state)
    assert out["template_key"] == "T31_outlet_directory"
    assert out["response_kind"] == "answer"
    assert out["template_confidence"] >= 0.9


@pytest.mark.asyncio
async def test_outlet_list_shortcut_unaccented_variant():
    state = {
        "normalized_question": "he thong co nhung cua hang nao",
        "intent": "lookup",
        "time_range": {},
        "resolved_entities": {},
        "conversation_context": "",
    }
    out = await tm.template_matcher(state)
    assert out["template_key"] == "T31_outlet_directory"


@pytest.mark.asyncio
async def test_product_list_shortcut_matches_vietnamese_question(monkeypatch):
    async def fail_llm(**_kwargs):
        raise AssertionError("LLM matcher should not be called for product directory lookup")

    monkeypatch.setattr(tm, "llm_call_json", fail_llm)

    state = {
        "normalized_question": "có những sản phẩm nào trong hệ thống",
        "intent": "lookup",
        "time_range": {},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }
    out = await tm.template_matcher(state)
    assert out["template_key"] == "T38_product_directory"
    assert out["template_params"] == {"limit": 50}
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_product_count_shortcut_matches_vietnamese_question(monkeypatch):
    async def fail_llm(**_kwargs):
        raise AssertionError("LLM matcher should not be called for product count lookup")

    monkeypatch.setattr(tm, "llm_call_json", fail_llm)

    state = {
        "normalized_question": "có bao nhiêu sản phẩm trong hệ thống",
        "intent": "lookup",
        "time_range": {},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }
    out = await tm.template_matcher(state)
    assert out["template_key"] == "T38_product_directory"
    assert out["template_params"] == {"limit": 50}
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_ai_sales_daily_outlet_list_shortcut_avoids_llm(monkeypatch):
    async def fail_llm(**_kwargs):
        raise AssertionError("LLM matcher should not be called for ai_sales_daily outlet lookup")

    monkeypatch.setattr(tm, "llm_call_json", fail_llm)

    state = {
        "normalized_question": "Nguồn dữ liệu analytics.ai_sales_daily có những cửa hàng nào",
        "intent": "lookup",
        "time_range": {"from_date": "2026-05-20", "to_date": "2026-05-20"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T37_ai_sales_daily_outlets"
    assert out["template_params"] == {}
    assert out["response_kind"] == "answer"
    assert out["trace"][-1]["shortcut"] == "T37_ai_sales_daily_outlets"


@pytest.mark.asyncio
async def test_outlet_detail_with_code_shortcuts_to_directory_template():
    state = {
        "normalized_question": "tôi muốn thông tin chi tiết của Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001) - active",
        "intent": "lookup",
        "time_range": {},
        "resolved_entities": {"outlet_ids": [3485603532616777729]},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T31_outlet_directory"
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_revenue_by_outlet_recovers_when_llm_misses(monkeypatch):
    class Settings:
        template_fast_path_enabled = False
        openai_embeddings_enabled = False

    async def fake_llm_call_json(**_kwargs):
        return (
            {
                "template_key": None,
                "params": {"from_date": None, "to_date": None, "limit": None, "threshold": None},
                "confidence": 0.23,
                "missing_info": ["template"],
            },
            {"latency_ms": 1, "tokens_in": 1, "tokens_out": 1},
        )

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "hybrid_search_templates", lambda **_kwargs: [])
    monkeypatch.setattr(tm, "llm_call_json", fake_llm_call_json)
    monkeypatch.setattr(tm, "select_verified_query", lambda **_kwargs: None)

    state = {
        "normalized_question": "Doanh thu từ 2026-04-01 đến 2026-05-02 theo cửa hàng",
        "intent": "outlet_compare",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-05-02"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T02_revenue_by_outlet"
    assert out["template_params"] == {"from_date": "2026-04-01", "to_date": "2026-05-02"}
    assert out["response_kind"] == "answer"
    assert out["trace"][-1]["recovered_by_rule"] == "T02_revenue_by_outlet"


@pytest.mark.asyncio
async def test_period_revenue_summary_overrides_daily_template(monkeypatch):
    class Settings:
        template_fast_path_enabled = False
        openai_embeddings_enabled = False

    async def fake_llm_call_json(**_kwargs):
        return (
            {
                "template_key": "T01_daily_revenue",
                "params": {"from_date": "2026-04-01", "to_date": "2026-04-30", "limit": None, "threshold": None},
                "confidence": 0.88,
                "missing_info": [],
            },
            {"latency_ms": 1, "tokens_in": 1, "tokens_out": 1},
        )

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "hybrid_search_templates", lambda **_kwargs: [])
    monkeypatch.setattr(tm, "llm_call_json", fake_llm_call_json)
    monkeypatch.setattr(tm, "select_verified_query", lambda **_kwargs: None)

    state = {
        "normalized_question": "doanh thu tất cả cửa hàng tháng trước",
        "intent": "revenue",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T32_period_revenue_summary"
    assert out["trace"][-1]["overridden_by_rule"] == "T32_period_revenue_summary"
    assert out["trace"][-1]["llm_template_key"] == "T01_daily_revenue"


@pytest.mark.asyncio
async def test_outlet_rank_overrides_unclear_match(monkeypatch):
    class Settings:
        template_fast_path_enabled = False
        openai_embeddings_enabled = False

    async def fake_llm_call_json(**_kwargs):
        return (
            {
                "template_key": None,
                "params": {"from_date": None, "to_date": None, "limit": None, "threshold": None},
                "confidence": 0.19,
                "missing_info": ["template"],
            },
            {"latency_ms": 1, "tokens_in": 1, "tokens_out": 1},
        )

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "hybrid_search_templates", lambda **_kwargs: [])
    monkeypatch.setattr(tm, "llm_call_json", fake_llm_call_json)
    monkeypatch.setattr(tm, "select_verified_query", lambda **_kwargs: None)

    state = {
        "normalized_question": "cửa hàng nào doanh thu cao nhất",
        "intent": "outlet_compare",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T22_outlet_rank"
    assert out["template_params"] == {"from_date": "2026-04-01", "to_date": "2026-04-30"}


@pytest.mark.asyncio
async def test_verified_query_runs_before_llm(monkeypatch):
    class Settings:
        template_fast_path_enabled = False
        openai_embeddings_enabled = False

    async def fail_llm_call_json(**_kwargs):
        raise AssertionError("LLM matcher should not be called for verified query asset")

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)

    state = {
        "normalized_question": "20 ngày gần nhất doanh thu cửa hàng nào cao nhất",
        "intent": "outlet_compare",
        "time_range": {"from_date": "2026-04-15", "to_date": "2026-05-04"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T22_outlet_rank"
    assert out["template_params"] == {"from_date": "2026-04-15", "to_date": "2026-05-04"}
    assert out["trace"][-1]["source"] == "verified_query"
    assert out["verified_query_asset"]["metric_ids"] == ["net_revenue"]


@pytest.mark.asyncio
async def test_specific_outlet_revenue_uses_outlet_template_without_llm(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for specific outlet revenue")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)
    monkeypatch.setattr(tm, "embed", fail_llm_call_json)

    state = {
        "normalized_question": "doanh thu tuần này của outlet 2",
        "intent": "outlet_compare",
        "time_range": {"from_date": "2026-05-04", "to_date": "2026-05-04"},
        "resolved_entities": {"outlet_ids": [2]},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T02_revenue_by_outlet"
    assert out["template_params"] == {"from_date": "2026-05-04", "to_date": "2026-05-04"}


@pytest.mark.asyncio
async def test_inventory_negative_stock_uses_static_template_without_llm(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious current inventory question")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)
    monkeypatch.setattr(tm, "embed", fail_llm_call_json)

    state = {
        "normalized_question": "mặt hàng nào tồn âm nhiều nhất hiện tại",
        "intent": "inventory",
        "time_range": {"from_date": "2026-05-04", "to_date": "2026-05-04"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T12_inventory_low_stock"
    assert out["template_params"]["threshold"] == 0
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_zero_revenue_outlets_do_not_route_to_rank(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for zero-revenue outlet query")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)

    state = {
        "normalized_question": "còn 2 cửa hàng không phát sinh doanh thu là cửa hàng nào trong tháng 3",
        "intent": "revenue",
        "time_range": {"from_date": "2026-03-01", "to_date": "2026-03-31"},
        "time_context": {"current_has_time_expression": True, "is_time_followup": False},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T33_zero_revenue_outlets"
    assert out["template_key"] != "T22_outlet_rank"
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_sales_detail_all_outlets_does_not_route_to_directory(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for sales detail query")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)

    state = {
        "normalized_question": "chi tiết bán hàng ngày 5/4/2026 tất cả cửa hàng, các đơn mua hàng",
        "intent": "revenue",
        "time_range": {"from_date": "2026-04-05", "to_date": "2026-04-05"},
        "time_context": {"current_has_time_expression": True, "is_time_followup": False},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T34_sales_detail_by_day"
    assert out["template_key"] != "T31_outlet_directory"
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_sales_detail_specific_outlet_code_does_not_route_to_directory(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for specific outlet sales detail query")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)

    state = {
        "normalized_question": "chi tiết bán hàng của cửa hàng SIM-SMALL-OUT-0002 trong ngày 5/4/2026",
        "intent": "lookup",
        "time_range": {"from_date": "2026-04-05", "to_date": "2026-04-05"},
        "time_context": {"current_has_time_expression": True, "is_time_followup": False},
        "resolved_entities": {"outlet_ids": [3485603532616777730]},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] == "T34_sales_detail_by_day"
    assert out["template_key"] != "T31_outlet_directory"
    assert out["response_kind"] == "answer"


@pytest.mark.asyncio
async def test_strict_business_detail_without_time_asks_clarification(monkeypatch):
    async def fail_llm_call_json(*_args, **_kwargs):
        raise AssertionError("LLM should not be called when required time slot is missing")

    class Settings:
        template_fast_path_enabled = True
        openai_embeddings_enabled = False

    monkeypatch.setattr(tm, "get_settings", lambda: Settings())
    monkeypatch.setattr(tm, "llm_call_json", fail_llm_call_json)

    state = {
        "normalized_question": "chi tiết bán hàng của cửa hàng SIM-SMALL-OUT-0002",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-05"},
        "time_context": {"current_has_time_expression": False, "is_time_followup": False},
        "resolved_entities": {"outlet_ids": [3485603532616777730]},
        "conversation_context": "",
        "trace": [],
    }

    out = await tm.template_matcher(state)

    assert out["template_key"] is None
    assert out["response_kind"] == "clarification"
    assert "khoảng thời gian" in out["clarification_question"]
