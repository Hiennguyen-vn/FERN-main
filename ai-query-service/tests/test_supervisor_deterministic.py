import pytest
from datetime import date

from app.graph.nodes import supervisor as sup


@pytest.mark.asyncio
async def test_supervisor_deterministic_revenue_by_outlet(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious revenue query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "Doanh thu từ 2026-04-01 đến 2026-05-02 theo cửa hàng",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "outlet_compare"
    assert out["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-05-02"}
    assert out["question_frame"]["effective_question"] == state["normalized_question"]
    assert out["question_frame"]["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-05-02"}
    assert out["question_frame"]["time_source"] == "current_turn"
    assert out["planning_frame"]["next_action"] == "template_match"
    assert out["planning_frame"]["domain"] == "sales"
    assert out["planning_frame"]["grain"] == "outlet"
    assert "executor_brief_vi" in out["planning_frame"]
    assert "Planner đã suy diễn" in out["planning_frame"]["executor_brief_vi"]
    assert out["planning_frame"].get("executor_directives")
    assert out["route_confidence"] >= 0.8
    assert out["trace"][-1]["source"] == "deterministic"


@pytest.mark.asyncio
async def test_supervisor_deterministic_vietnamese_numeric_date_range(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious outlet ranking query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "từ ngày 1/4/2026 đến ngày 22/4/2026 doanh thu cửa hàng nào cao nhất",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "outlet_compare"
    assert out["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-04-22"}
    assert out["trace"][-1]["source"] == "deterministic"


@pytest.mark.asyncio
async def test_supervisor_deterministic_visualization(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious visualization query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "Vẽ biểu đồ doanh thu từ 2026-04-01 đến 2026-05-02 theo ngày",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "visualization_request"
    assert out["intent"] == "revenue"
    assert out["visualization_requested"] is True


@pytest.mark.asyncio
async def test_supervisor_deterministic_docs(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious docs query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": "doanh thu ròng là gì?", "trace": []}

    out = await sup.supervisor(state)

    assert out["agent_route"] == "docs_question"
    assert out["intent"] == "revenue"


@pytest.mark.asyncio
async def test_supervisor_deterministic_hr(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious HR query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": "nhân viên nào đi làm nhiều nhất năm nay?", "trace": []}

    out = await sup.supervisor(state)

    assert out["agent_route"] == "hr_staff"
    assert out["intent"] == "hr_staff"
    assert out["time_range"]["from_date"].endswith("-01-01")


@pytest.mark.asyncio
async def test_supervisor_deterministic_inventory_negative_stock(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious inventory query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": "mặt hàng nào tồn âm nhiều nhất hiện tại", "trace": []}

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "inventory"


@pytest.mark.asyncio
async def test_supervisor_deterministic_hr_work_hours_without_employee_keyword(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious HR work-hours query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": "Dinh Hong Son tháng này đã làm bao nhiêu giờ?", "trace": []}

    out = await sup.supervisor(state)

    assert out["agent_route"] == "hr_staff"
    assert out["intent"] == "hr_staff"
    assert out["trace"][-1]["source"] == "deterministic"


@pytest.mark.asyncio
async def test_supervisor_deterministic_hr_time_followup_prefers_current_period(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for HR time follow-up")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "tháng trước thì sao",
        "contextualized_question": "Nguyễn Văn An đã làm bao nhiêu giờ tháng trước thì sao",
        "conversation_context": (
            "User: Nguyễn Văn An tháng này đã làm bao nhiêu giờ?\n"
            "Assistant: Nguyễn Văn An đã làm 18.50 giờ trong tháng này."
        ),
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "hr_staff"
    assert out["intent"] == "hr_staff"
    assert out["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-04-30"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("current", "expected"),
    [
        ("tuần rồi thì sao", {"from_date": "2026-04-27", "to_date": "2026-05-03"}),
        ("tháng rồi thì sao", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("quý trước thì sao", {"from_date": "2026-01-01", "to_date": "2026-03-31"}),
        ("quý này thì sao", {"from_date": "2026-04-01", "to_date": "2026-05-04"}),
        ("tháng 4 thì sao", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
        ("7 ngày gần nhất thì sao", {"from_date": "2026-04-28", "to_date": "2026-05-04"}),
        ("30 ngày qua thì sao", {"from_date": "2026-04-05", "to_date": "2026-05-04"}),
        ("kỳ trước thì sao", {"from_date": "2026-04-01", "to_date": "2026-04-30"}),
    ],
)
async def test_supervisor_deterministic_time_followup_variants(monkeypatch, current, expected):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic time follow-up")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": current,
        "contextualized_question": f"doanh thu theo cửa hàng {current}",
        "conversation_context": (
            "User: doanh thu tháng này theo cửa hàng\n"
            "Assistant: Doanh thu tháng này theo cửa hàng là ..."
        ),
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["time_range"] == expected


@pytest.mark.asyncio
async def test_supervisor_same_period_comparison_followup_uses_base_period(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for same-period comparison follow-up")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "so với cùng kỳ năm ngoái",
        "contextualized_question": "doanh thu theo cửa hàng so với cùng kỳ năm ngoái",
        "contextualization_source": "rule_time_followup",
        "conversation_context": "User: doanh thu tháng này theo cửa hàng",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "outlet_compare"
    assert out["time_range"] == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert out["time_context"]["comparison_from_date"] == "2025-05-01"
    assert out["question_frame"]["is_time_followup"] is True


@pytest.mark.asyncio
async def test_supervisor_direct_same_period_comparison_is_outlet_compare(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for obvious YoY revenue question")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "doanh thu tháng này so với cùng kỳ năm ngoái",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["intent"] == "outlet_compare"
    assert out["time_range"] == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert out["time_context"]["comparison_from_date"] == "2025-05-01"


@pytest.mark.asyncio
async def test_supervisor_deterministic_docs_for_semantic_hr_metric(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for known metric definition")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": "giờ làm được tính như thế nào?", "trace": []}

    out = await sup.supervisor(state)

    assert out["agent_route"] == "docs_question"
    assert out["intent"] == "lookup"


@pytest.mark.asyncio
async def test_supervisor_outlet_directory_ignores_prior_hr_context(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for outlet directory lookup")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "có các cửa hàng nào trong hệ thống",
        "conversation_context": (
            "User: Le Hoang Cuong tháng trước đã làm bao nhiêu giờ?\n"
            "Assistant: Le Hoang Cuong đã làm 102.55 giờ."
        ),
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "lookup"
    assert out["trace"][-1]["source"] == "deterministic"


@pytest.mark.asyncio
async def test_supervisor_outlet_detail_with_code_is_lookup(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for exact outlet-code lookup")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "tôi muốn thông tin chi tiết của Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001) - active",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "lookup"


@pytest.mark.asyncio
async def test_supervisor_sales_detail_with_outlet_code_is_business_query(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for sales detail query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "chi tiết bán hàng của cửa hàng SIM-SMALL-OUT-0002 trong ngày 5/4/2026",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "revenue"
    assert out["time_range"] == {"from_date": "2026-04-05", "to_date": "2026-04-05"}
    assert out["planning_frame"]["task_type"] == "sales_detail"
    assert out["planning_frame"]["next_action"] == "verified_template"


@pytest.mark.asyncio
async def test_supervisor_zero_revenue_is_business_query(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for zero revenue query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "còn 2 cửa hàng không phát sinh doanh thu là cửa hàng nào trong tháng 3",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "outlet_compare"
    assert out["time_range"] == {"from_date": "2026-03-01", "to_date": "2026-03-31"}
    assert out["planning_frame"]["task_type"] == "zero_revenue_outlets"
    assert out["planning_frame"]["next_action"] == "verified_template"


@pytest.mark.asyncio
async def test_supervisor_peak_hour_with_time_is_verified_business_query(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for peak-hour query with time")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "Giờ cao điểm bán hàng trong tuần trước",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "revenue"
    assert out["time_range"] == {"from_date": "2026-04-27", "to_date": "2026-05-03"}
    assert out["planning_frame"]["task_type"] == "peak_hour_analysis"
    assert out["planning_frame"]["grain"] == "hour_of_day"
    assert {"peak_hour", "txn_count", "net_revenue"}.issubset(set(out["planning_frame"]["metric_ids"]))
    assert out["planning_frame"]["next_action"] == "verified_template"


@pytest.mark.asyncio
async def test_supervisor_peak_hour_without_time_asks_clarification(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for peak-hour clarification")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "Giờ cao điểm bán hàng là lúc nào?",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["response_kind"] == "clarification"
    assert out["planning_frame"]["next_action"] == "ask_clarification"
    assert out["response_hints"] == ["time_range"]
    assert "giờ cao điểm" in out["clarification_question"].lower()


@pytest.mark.asyncio
async def test_supervisor_marks_escalation_candidate_for_ambiguous_followup(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic ambiguous follow-up")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "so sánh cái này",
        "contextualized_question": "doanh thu tháng này theo cửa hàng so sánh cái này",
        "contextualization_source": "rule_short_followup",
        "conversation_context": "User: doanh thu tháng này theo cửa hàng\nAssistant: ...",
        "conversation_turns": [
            {"role": "user", "content": "doanh thu tháng này theo cửa hàng"},
            {"role": "assistant", "content": "Doanh thu tháng này theo cửa hàng là ..."},
        ],
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["response_kind"] == "clarification"
    assert out["planning_frame"]["next_action"] == "ask_clarification"
    assert out["escalation_candidate"] is True
    assert out["escalation_reason"] == "still_missing_slots_after_followup"


@pytest.mark.asyncio
async def test_supervisor_peak_sales_q3_2025_defaults_to_peak_hour(monkeypatch):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for peak-sales quarter query")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {
        "normalized_question": "Cao điểm bán hàng quý 3 năm 2025",
        "trace": [],
    }

    out = await sup.supervisor(state)

    assert out["agent_route"] == "data_query"
    assert out["intent"] == "revenue"
    assert out["time_range"] == {"from_date": "2025-07-01", "to_date": "2025-09-30"}
    assert out["planning_frame"]["task_type"] == "peak_hour_analysis"
    assert out["planning_frame"]["grain"] == "hour_of_day"
    assert out["planning_frame"]["next_action"] == "verified_template"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("question", "expected_intent", "expected_range", "expected_task", "expected_next_action"),
    [
        (
            "doanh thu 20 ngày gần nhất theo cửa hàng",
            "outlet_compare",
            {"from_date": "2026-04-15", "to_date": "2026-05-04"},
            "outlet_compare",
            "template_match",
        ),
        (
            "doanh thu tháng 5 năm 2024",
            "revenue",
            {"from_date": "2024-05-01", "to_date": "2024-05-31"},
            "metric_summary",
            "template_match",
        ),
        (
            "doanh thu tháng 1. 2 năm nay",
            "revenue",
            {"from_date": "2026-01-01", "to_date": "2026-02-28"},
            "metric_summary",
            "template_match",
        ),
        (
            "doanh thu 7 năm gần nhất",
            "revenue",
            {"from_date": "2019-05-05", "to_date": "2026-05-04"},
            "metric_summary",
            "template_match",
        ),
        (
            "doanh thu chia theo hình thức thu tiền tháng này",
            "revenue",
            {"from_date": "2026-05-01", "to_date": "2026-05-04"},
            "metric_summary",
            "template_match",
        ),
        (
            "tồn kho hiện tại mặt hàng nào tồn âm nhiều nhất",
            "inventory",
            {"from_date": "2026-05-04", "to_date": "2026-05-04"},
            "inventory",
            "template_match",
        ),
        (
            "nhân viên nào đi làm nhiều nhất năm nay",
            "hr_staff",
            {"from_date": "2026-01-01", "to_date": "2026-05-04"},
            "hr_static",
            "hr_static",
        ),
        (
            "SIM-SMALL-EMP-0009 tháng trước đã nhận bao nhiêu lương",
            "hr_staff",
            {"from_date": "2026-04-01", "to_date": "2026-04-30"},
            "hr_static",
            "hr_static",
        ),
    ],
)
async def test_supervisor_hard_business_question_matrix(
    monkeypatch,
    question,
    expected_intent,
    expected_range,
    expected_task,
    expected_next_action,
):
    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called for deterministic hard question matrix")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(sup, "today_local", lambda: date(2026, 5, 4))
    monkeypatch.setattr(sup, "get_settings", lambda: type("S", (), {"deterministic_supervisor_enabled": True})())
    state = {"normalized_question": question, "trace": []}

    out = await sup.supervisor(state)

    assert out["intent"] == expected_intent
    assert out["time_range"] == expected_range
    assert out["planning_frame"]["task_type"] == expected_task
    assert out["planning_frame"]["next_action"] == expected_next_action
