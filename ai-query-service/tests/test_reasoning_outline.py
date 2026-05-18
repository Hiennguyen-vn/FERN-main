from app.graph.nodes.query_reasoner import format_reasoning_outline_for_matcher
from app.graph.nodes import query_reasoner as qr
import pytest


def test_format_outline_empty_returns_empty():
    assert format_reasoning_outline_for_matcher(None) == ""
    assert format_reasoning_outline_for_matcher({}) == ""


def test_format_outline_contains_key_lines():
    text = format_reasoning_outline_for_matcher(
        {
            "problem_paraphrase_vi": "Doanh thu theo cửa hàng",
            "domain": "revenue",
            "grain_hypothesis_vi": "Theo outlet, theo ngày",
            "metric_hypotheses_vi": ["GMV"],
            "implicit_filters_vi": ["Outlet user được phép"],
            "verification_questions_vi": [],
        },
    )
    assert "Doanh thu theo cửa hàng" in text
    assert "GMV" in text
    assert "Dự thảo tư duy" in text


async def _fail_llm(**_kwargs):
    raise AssertionError("LLM should not be called")


@pytest.mark.asyncio
async def test_query_reasoner_skips_deterministic_outlet_lookup(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": "tôi muốn thông tin chi tiết của Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001) - active",
        "intent": "lookup",
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["reasoning_outline"] == {}
    assert out["trace"][-1]["reason"] == "deterministic_outlet_lookup"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("question", "intent"),
    [
        ("từ ngày 1/4/2026 đến ngày 22/4/2026 doanh thu cửa hàng nào cao nhất", "outlet_compare"),
        ("doanh thu tháng này so với cùng kỳ năm ngoái", "outlet_compare"),
        ("doanh thu tháng 4 năm ngoái", "revenue"),
        ("doanh thu tháng 1 và 2 năm nay", "revenue"),
        ("chi tiết bán hàng ngày 5/4/2026 tất cả cửa hàng, các đơn mua hàng", "revenue"),
        ("cửa hàng không phát sinh doanh thu trong tháng 3", "revenue"),
        ("Giờ cao điểm bán hàng trong tuần trước", "revenue"),
        ("Cao điểm bán hàng quý 3 năm 2025", "revenue"),
    ],
)
async def test_query_reasoner_skips_obvious_revenue_template_shortcut(monkeypatch, question, intent):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": question,
        "intent": intent,
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-22"},
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["reasoning_outline"] == {}
    assert out["trace"][-1]["reason"] == "deterministic_template_shortcut"
    assert out["planning_decision"]["missing_slots"] == []


@pytest.mark.asyncio
async def test_query_reasoner_asks_clarification_from_planning_frame(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": "doanh thu?",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-04", "to_date": "2026-05-04"},
        "planning_frame": {
            "route": "data_query",
            "intent": "revenue",
            "domain": "sales",
            "task_type": "metric_summary",
            "metric_ids": ["net_revenue"],
            "grain": "period",
            "ambiguities": ["time_range"],
            "next_action": "ask_clarification",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["response_kind"] == "clarification"
    assert out["planning_decision"]["missing_slots"] == ["time_range"]
    assert out["trace"][-1]["next_action"] == "ask_clarification"


@pytest.mark.asyncio
async def test_query_reasoner_builds_report_spec_from_planning_frame(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": "doanh thu chia theo hình thức thu tiền tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_frame": {
            "route": "data_query",
            "intent": "revenue",
            "domain": "sales",
            "task_type": "metric_summary",
            "metric_ids": ["net_revenue"],
            "grain": "period",
            "ambiguities": [],
            "next_action": "template_match",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["planning_decision"]["recommended_template_keys"] == ["T08_revenue_by_payment_method"]
    assert out["planning_decision"]["report_spec"]["analysis_mode"] == "breakdown"
    assert out["planning_decision"]["report_spec"]["group_by"] == "payment_method"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("question", "intent", "task_type", "expected_template", "expected_group_by"),
    [
        ("top cửa hàng theo doanh thu tháng này", "outlet_compare", "outlet_compare", "T22_outlet_rank", "outlet"),
        ("doanh thu theo danh mục tháng này", "product_mix", "product_mix", "T03_revenue_by_category", "category"),
        ("xếp hạng doanh thu theo nhóm món tuần này", "product_mix", "product_mix", "T03_revenue_by_category", "category"),
    ],
)
async def test_query_reasoner_does_not_treat_theo_as_card_payment(
    monkeypatch,
    question,
    intent,
    task_type,
    expected_template,
    expected_group_by,
):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": question,
        "intent": intent,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-07"},
        "planning_frame": {
            "route": "data_query",
            "intent": intent,
            "domain": "product" if intent == "product_mix" else "sales",
            "task_type": task_type,
            "metric_ids": ["net_revenue"],
            "grain": "period",
            "ambiguities": [],
            "next_action": "template_match",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["planning_decision"]["recommended_template_keys"] == [expected_template]
    assert out["planning_decision"]["report_spec"]["group_by"] == expected_group_by


@pytest.mark.asyncio
async def test_query_reasoner_inventory_negative_stock_recommends_snapshot_template(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(qr, "get_settings", lambda: type("S", (), {"query_reasoning_enabled": True})())
    state = {
        "normalized_question": "tồn kho hiện tại mặt hàng nào tồn âm nhiều nhất",
        "intent": "inventory",
        "time_range": {"from_date": "2026-05-04", "to_date": "2026-05-04"},
        "planning_frame": {
            "route": "data_query",
            "intent": "inventory",
            "domain": "inventory",
            "task_type": "inventory",
            "metric_ids": ["qty_on_hand"],
            "grain": "outlet + item + latest_snapshot",
            "ambiguities": [],
            "next_action": "template_match",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert out["planning_decision"]["recommended_template_keys"] == ["T12_inventory_low_stock"]
    assert out["planning_decision"]["report_spec"]["analysis_mode"] == "exception_list"
    assert out["planning_decision"]["report_spec"]["group_by"] == "inventory_item"
    assert "negative_stock" in out["planning_decision"]["report_spec"]["metric_focus"]


@pytest.mark.asyncio
async def test_query_reasoner_can_expand_dataset_candidates_for_agent_permissions(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(
        qr,
        "get_settings",
        lambda: type(
            "S",
            (),
            {
                "query_reasoning_enabled": True,
                "agent_extended_dataset_access_enabled": True,
                "agent_extended_dataset_max_tables": 10,
            },
        )(),
    )
    state = {
        "normalized_question": "Cao điểm bán hàng quý 3 năm 2025",
        "intent": "revenue",
        "time_range": {"from_date": "2025-07-01", "to_date": "2025-09-30"},
        "planning_frame": {
            "route": "data_query",
            "intent": "revenue",
            "domain": "sales",
            "task_type": "peak_hour_analysis",
            "metric_ids": ["peak_hour", "txn_count", "net_revenue"],
            "grain": "hour_of_day",
            "ambiguities": [],
            "next_action": "verified_template",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert "cdc.fact_sale" in out["planning_decision"]["selected_dataset_candidates"]


@pytest.mark.asyncio
async def test_query_reasoner_expands_finance_invoice_event_candidates(monkeypatch):
    monkeypatch.setattr(qr, "llm_call_json", _fail_llm)
    monkeypatch.setattr(
        qr,
        "get_settings",
        lambda: type(
            "S",
            (),
            {
                "query_reasoning_enabled": True,
                "agent_extended_dataset_access_enabled": True,
                "agent_extended_dataset_max_tables": 10,
            },
        )(),
    )
    state = {
        "normalized_question": "hóa đơn nhà cung cấp đã duyệt tháng này",
        "intent": "revenue",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_frame": {
            "route": "data_query",
            "intent": "revenue",
            "domain": "finance",
            "task_type": "metric_summary",
            "metric_ids": ["supplier_invoice_approved"],
            "grain": "period",
            "ambiguities": [],
            "next_action": "template_match",
        },
        "trace": [],
    }

    out = await qr.query_reasoner(state)

    assert "fern.events_invoice_approved" in out["planning_decision"]["selected_dataset_candidates"]
    assert out["planning_decision"]["report_spec"]["metric_focus"] == ["supplier_invoice_approved"]
    assert out["planning_decision"]["report_spec"]["time_axis"] == "invoiceDate"
