import pytest

from app.graph.nodes.preprocess import detect_standalone_social
from app.graph.nodes.template_matcher import template_matcher
from app.query_policy.learned_scenarios import LearnedScenarioAsset, LearnedScenarioMatch


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("xin chào", "greeting"),
        ("Xin chào!", "greeting"),
        ("chào bạn", "greeting"),
        ("chào bạn ạ", "greeting"),
        ("chào anh nhé", "greeting"),
        ("alo bạn ơi", "greeting"),
        ("bạn ơi", "greeting"),
        ("cho mình hỏi", "greeting"),
        ("ok ạ", "greeting"),
        ("dạ", "greeting"),
        ("hello", "greeting"),
        ("Hi!!", "greeting"),
        ("cảm ơn", "thanks"),
        ("cảm ơn bạn.", "thanks"),
        ("cảm ơn nhé", "thanks"),
        ("thanks", "thanks"),
        ("thank you!", "thanks"),
    ],
)
def test_detect_standalone_social_positive(text: str, expected: str):
    assert detect_standalone_social(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "chào cửa hàng cho mình xem doanh thu",
        "xin chào cho em hỏi doanh thu hôm nay",
        "bạn ơi xem doanh thu hôm nay",
        "ok xem top sản phẩm tháng này",
        "doanh thu hôm nay",
        "",
    ],
)
def test_detect_standalone_social_negative(text: str):
    assert detect_standalone_social(text or "") is None


@pytest.mark.asyncio
async def test_generic_metric_question_asks_one_clarification():
    state = {
        "normalized_question": "Doanh thu?",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-03", "to_date": "2026-05-03"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }
    out = await template_matcher(state)
    assert out["response_kind"] == "clarification"
    assert out["template_key"] is None
    assert "khoảng thời gian" in out["clarification_question"]


@pytest.mark.asyncio
async def test_template_matcher_fast_path_revenue_by_outlet(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic template match")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "Doanh thu từ 2026-04-01 đến 2026-05-02 theo cửa hàng",
        "intent": "revenue",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-05-02"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T02_revenue_by_outlet"
    assert out["template_params"] == {"from_date": "2026-04-01", "to_date": "2026-05-02"}
    assert out["template_confidence"] >= 0.9
    assert out["trace"][-1]["shortcut"] == "T02_revenue_by_outlet"


@pytest.mark.asyncio
async def test_template_matcher_fast_path_daily_revenue_chart(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic template match")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "Vẽ biểu đồ doanh thu từ 2026-04-01 đến 2026-05-02 theo ngày",
        "intent": "revenue",
        "agent_route": "visualization_request",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-05-02"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T01_daily_revenue"


@pytest.mark.asyncio
async def test_template_matcher_fast_path_top_products_respects_requested_limit(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic template match")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "Top 5 sản phẩm bán chạy tháng này",
        "intent": "product_mix",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T04_top_products"
    assert out["template_params"] == {"from_date": "2026-05-01", "to_date": "2026-05-04", "limit": 5}


@pytest.mark.asyncio
async def test_template_matcher_fast_path_product_revenue_ranking_uses_top_products(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious product revenue ranking")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "doanh thu mặt hàng nào cao nhất trong năm nay",
        "intent": "product_mix",
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-05-19"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T04_top_products"
    assert out["template_params"] == {
        "from_date": "2026-01-01",
        "to_date": "2026-05-19",
        "limit": 1,
        "sort_by": "revenue",
    }


@pytest.mark.asyncio
async def test_template_matcher_product_revenue_ranking_all_outlets_is_not_outlet_rank(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious product revenue ranking")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "sản phẩm nào trong tháng 4 ở tất cả các cửa hàng có doanh thu cao nhất",
        "intent": "product_mix",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T04_top_products"
    assert out["template_params"] == {
        "from_date": "2026-04-01",
        "to_date": "2026-04-30",
        "limit": 1,
        "sort_by": "revenue",
    }


@pytest.mark.asyncio
async def test_template_matcher_product_quantity_ranking_all_outlets_is_not_directory(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious product quantity ranking")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "Sản phẩm nào trong tháng 4 ở tất cả các cửa hàng bán được nhiều sản phẩm nhất",
        "intent": "product_mix",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T04_top_products"
    assert out["template_params"] == {
        "from_date": "2026-04-01",
        "to_date": "2026-04-30",
        "limit": 1,
    }


@pytest.mark.asyncio
async def test_template_matcher_verified_peak_hour_does_not_ask_time(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for verified peak-hour template")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "Giờ cao điểm bán hàng trong tuần trước",
        "intent": "revenue",
        "time_range": {"from_date": "2026-04-27", "to_date": "2026-05-03"},
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T23_peak_hour_analysis"
    assert out["template_params"] == {"from_date": "2026-04-27", "to_date": "2026-05-03"}
    assert out["verified_query_asset"]["template_key"] == "T23_peak_hour_analysis"


@pytest.mark.asyncio
async def test_template_matcher_time_followup_keeps_outlet_grain(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic template match")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "7 ngày gần nhất thì sao",
        "contextualized_question": "doanh thu theo cửa hàng 7 ngày gần nhất thì sao",
        "intent": "outlet_compare",
        "time_range": {"from_date": "2026-04-28", "to_date": "2026-05-04"},
        "resolved_entities": {},
        "conversation_context": "User: doanh thu tháng này theo cửa hàng",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T02_revenue_by_outlet"
    assert out["template_params"] == {"from_date": "2026-04-28", "to_date": "2026-05-04"}


@pytest.mark.asyncio
async def test_template_matcher_uses_planning_decision_report_spec(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called when planning decision is authoritative")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": "doanh thu chia theo hình thức thu tiền tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_decision": {
            "recommended_template_keys": ["T08_revenue_by_payment_method"],
            "report_spec": {
                "analysis_mode": "breakdown",
                "group_by": "payment_method",
                "metric_focus": ["net_revenue"],
            },
        },
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T08_revenue_by_payment_method"
    assert out["template_params"] == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert out["trace"][-1]["source"] == "planning_decision"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("question", "intent", "expected_template"),
    [
        ("top cửa hàng theo doanh thu tháng này", "outlet_compare", "T22_outlet_rank"),
        ("doanh thu theo danh mục tháng này", "product_mix", "T03_revenue_by_category"),
        ("xếp hạng doanh thu theo nhóm món tuần này", "product_mix", "T03_revenue_by_category"),
    ],
)
async def test_template_matcher_ignores_stale_payment_plan_without_payment_context(
    monkeypatch,
    question,
    intent,
    expected_template,
):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called when deterministic fallback can fix stale plan")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type("S", (), {"template_fast_path_enabled": True, "openai_embeddings_enabled": False})(),
    )

    state = {
        "normalized_question": question,
        "intent": intent,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "planning_decision": {
            "recommended_template_keys": ["T08_revenue_by_payment_method"],
            "report_spec": {
                "analysis_mode": "breakdown",
                "group_by": "payment_method",
                "metric_focus": ["net_revenue"],
            },
        },
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == expected_template
    assert out["template_params"] == {"from_date": "2026-05-01", "to_date": "2026-05-07"}


@pytest.mark.asyncio
async def test_template_matcher_uses_learned_scenario_before_planning(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called when learned scenario is authoritative")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_verified_query", lambda **_kwargs: None)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.select_learned_scenario",
        lambda **_kwargs: LearnedScenarioMatch(
            template_key="T08_revenue_by_payment_method",
            params={"from_date": "2026-05-01", "to_date": "2026-05-04"},
            confidence=0.87,
            asset=LearnedScenarioAsset(
                scenario_key="scenario:test-payment",
                template_key="T08_revenue_by_payment_method",
                intent="revenue",
                domain="payment",
                task_type="metric_summary",
                metric_ids=("net_revenue",),
                required_slots=("from_date", "to_date"),
                report_spec={"analysis_mode": "breakdown", "group_by": "payment_method", "metric_focus": ["net_revenue"]},
            ),
        ),
    )
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type(
            "S",
            (),
            {
                "template_fast_path_enabled": True,
                "openai_embeddings_enabled": False,
                "learned_scenario_matching_enabled": True,
                "learned_scenario_match_min_score": 0.78,
            },
        )(),
    )

    state = {
        "normalized_question": "doanh thu chia theo hình thức thu tiền tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_decision": {
            "recommended_template_keys": ["T32_period_revenue_summary"],
            "report_spec": {
                "analysis_mode": "summary",
                "group_by": None,
                "metric_focus": ["net_revenue"],
            },
        },
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] == "T08_revenue_by_payment_method"
    assert out["learned_scenario_asset"]["scenario_key"] == "scenario:test-payment"
    assert out["trace"][-1]["source"] == "learned_scenario"


@pytest.mark.asyncio
async def test_template_matcher_does_not_fallback_sales_template_for_finance_event_metric(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for SQL-writer-only metric")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_verified_query", lambda **_kwargs: None)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_learned_scenario", lambda **_kwargs: None)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_sql_writer_scenario", lambda **_kwargs: None)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type(
            "S",
            (),
            {
                "template_fast_path_enabled": True,
                "openai_embeddings_enabled": False,
                "learned_scenario_matching_enabled": True,
                "learned_scenario_match_min_score": 0.78,
                "codegen_sql_enabled": True,
                "codegen_route_mode": "no_template_or_low_confidence",
            },
        )(),
    )

    state = {
        "normalized_question": "hóa đơn nhà cung cấp đã duyệt tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_decision": {
            "selected_domain": "finance",
            "selected_metric_ids": ["supplier_invoice_approved"],
            "selected_dataset_candidates": ["fern.events_invoice_approved"],
            "recommended_template_keys": ["finance_supplier_invoice_approved_summary"],
            "report_spec": {
                "analysis_mode": "event_summary",
                "group_by": None,
                "time_axis": "invoiceDate",
                "metric_focus": ["supplier_invoice_approved"],
            },
        },
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] is None
    assert out["response_kind"] == "answer"
    assert out["trace"][-1]["source"] == "planning_requires_sql_writer"


@pytest.mark.asyncio
async def test_template_matcher_short_circuits_sql_writer_when_source_outside_coverage(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for outside-coverage SQL-writer-only metric")

    monkeypatch.setattr("app.graph.nodes.template_matcher.llm_call_json", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.embed", fail_llm)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_verified_query", lambda **_kwargs: None)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_learned_scenario", lambda **_kwargs: None)
    monkeypatch.setattr("app.graph.nodes.template_matcher.select_sql_writer_scenario", lambda **_kwargs: None)
    monkeypatch.setattr(
        "app.graph.nodes.template_matcher.get_settings",
        lambda: type(
            "S",
            (),
            {
                "template_fast_path_enabled": True,
                "openai_embeddings_enabled": False,
                "learned_scenario_matching_enabled": True,
                "learned_scenario_match_min_score": 0.78,
                "codegen_sql_enabled": True,
                "codegen_route_mode": "no_template_or_low_confidence",
            },
        )(),
    )

    state = {
        "normalized_question": "hóa đơn nhà cung cấp đã duyệt tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "data_source_context": {
            "primary_dataset": "fern.events_invoice_approved",
            "coverage_status": "outside",
            "requested_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        },
        "planning_decision": {
            "selected_domain": "finance",
            "selected_metric_ids": ["supplier_invoice_approved"],
            "selected_dataset_candidates": ["fern.events_invoice_approved"],
            "report_spec": {
                "analysis_mode": "event_summary",
                "time_axis": "invoiceDate",
                "metric_focus": ["supplier_invoice_approved"],
            },
        },
        "resolved_entities": {},
        "conversation_context": "",
        "trace": [],
    }

    out = await template_matcher(state)

    assert out["template_key"] is None
    assert out["response_kind"] == "answer"
    assert out["codegen_skip_reason"] == "coverage_outside"
    assert out["trace"][-1]["reason"] == "coverage_outside"
