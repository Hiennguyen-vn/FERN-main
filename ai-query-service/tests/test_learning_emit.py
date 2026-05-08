"""Learning staging emit — gated Kafka publish for successful template-backed queries."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.audit import learning as lg
from app.auth.context import AuthContext


def _auth() -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="s",
        roles=frozenset({"viewer"}),
        permissions=frozenset(),
        outlet_ids=frozenset({1}),
        correlation_id="cid-1",
    )


def _success_state():
    return {
        "auth": _auth(),
        "normalized_question": "doanh thu hom nay",
        "intent": "revenue",
        "template_key": "T02_revenue_by_outlet",
        "response_kind": "answer",
        "raw_result": [{"x": 1}],
        "guard_passed": True,
        "skip_answer_formatter_llm": False,
        "final_sql": "SELECT outlet_id FROM analytics.fct_sales_daily WHERE outlet_id IN (1)",
        "executed_sql_source": "template",
    }


def test_build_learning_event_shape():
    ev = lg.build_learning_event(_success_state())
    assert ev["event_type"] == "ai_query_success_candidate"
    assert ev["schema_version"] == 1
    assert ev["template_key"] == "T02_revenue_by_outlet"
    assert ev["generation_mode"] == "template"
    assert ev["sql_source"] == "template"
    assert len(ev["sql_hash"]) == 32
    assert ev["outcome"] == "success"
    assert ev["correlation_id"] == "cid-1"
    assert len(ev["normalized_question_sha256"]) == 64


def test_build_learning_event_includes_sql_writer_candidate_for_successful_codegen():
    st = _success_state()
    st["template_key"] = None
    st["executed_sql_source"] = "codegen"
    st["codegen_trial_passed"] = True
    st["codegen_reviewer_risk"] = "low"
    st["codegen_tables_used"] = ["analytics.ai_sales_daily"]
    st["codegen_candidate_tables"] = ["analytics.ai_sales_daily", "cdc.outlet"]
    st["planning_frame"] = {
        "domain": "sales",
        "task_type": "metric_summary",
        "metric_ids": ["net_revenue"],
    }
    st["planning_decision"] = {
        "selected_metric_ids": ["net_revenue"],
        "report_spec": {"analysis_mode": "summary", "metric_focus": ["net_revenue"]},
    }
    st["codegen_sql_plan"] = {"goal_vi": "Tính doanh thu theo câu hỏi mới"}

    ev = lg.build_learning_event(st)

    assert ev["scenario_candidate"] is None
    assert ev["sql_writer_candidate"]["candidate_type"] == "sql_writer_codegen"
    assert ev["sql_writer_candidate"]["scenario_key"].startswith("sqlwriter:")
    assert ev["sql_writer_candidate"]["tables_used"] == ["analytics.ai_sales_daily"]
    assert ev["sql_writer_candidate"]["promotion_policy"] == "stage_only_require_review_or_golden_before_runtime"


def test_build_learning_event_includes_scenario_candidate_when_planning_present():
    st = _success_state()
    st["planning_frame"] = {
        "domain": "sales",
        "task_type": "outlet_compare",
        "metric_ids": ["net_revenue"],
    }
    st["planning_decision"] = {
        "selected_metric_ids": ["net_revenue"],
        "selected_dataset_candidates": ["analytics.ai_sales_daily"],
        "required_slots": ["from_date", "to_date"],
        "report_spec": {
            "analysis_mode": "ranking",
            "group_by": "outlet",
            "time_axis": None,
            "comparison_mode": None,
            "ranking_mode": "top",
            "metric_focus": ["net_revenue"],
        },
    }
    st["time_range"] = {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    ev = lg.build_learning_event(st)

    assert ev["scenario_candidate"]["template_key"] == "T02_revenue_by_outlet"
    assert ev["scenario_candidate"]["report_spec"]["group_by"] == "outlet"


@pytest.mark.asyncio
async def test_emit_learning_candidate_disabled_no_kafka():
    with (
        patch.object(lg, "get_settings") as gs,
        patch.object(lg, "publish_json", new_callable=AsyncMock) as pub,
    ):
        gs.return_value = SimpleNamespace(
            learning_staging_emit_enabled=False,
            kafka_learning_topic="fern.ai-query.learning.staging",
        )
        await lg.emit_learning_candidate(_success_state())
        pub.assert_not_called()


@pytest.mark.asyncio
async def test_emit_learning_candidate_publishes_when_enabled():
    with (
        patch.object(lg, "get_settings") as gs,
        patch.object(lg, "publish_json", new_callable=AsyncMock) as pub,
    ):
        gs.return_value = SimpleNamespace(
            learning_staging_emit_enabled=True,
            kafka_learning_topic="fern.test.learning",
        )
        await lg.emit_learning_candidate(_success_state())
        pub.assert_awaited_once()
        topic, payload = pub.await_args.args
        assert topic == "fern.test.learning"
        assert payload["template_key"] == "T02_revenue_by_outlet"
        assert payload["outcome"] == "success"


@pytest.mark.asyncio
async def test_emit_skips_social_intent():
    st = _success_state()
    st["intent"] = "greeting"
    with (
        patch.object(lg, "get_settings") as gs,
        patch.object(lg, "publish_json", new_callable=AsyncMock) as pub,
    ):
        gs.return_value = SimpleNamespace(
            learning_staging_emit_enabled=True,
            kafka_learning_topic="fern.test.learning",
        )
        await lg.emit_learning_candidate(st)
        pub.assert_not_called()


@pytest.mark.asyncio
async def test_emit_skips_without_template_key():
    st = _success_state()
    st["template_key"] = None
    st["executed_sql_source"] = "template"
    with (
        patch.object(lg, "get_settings") as gs,
        patch.object(lg, "publish_json", new_callable=AsyncMock) as pub,
    ):
        gs.return_value = SimpleNamespace(
            learning_staging_emit_enabled=True,
            kafka_learning_topic="fern.test.learning",
        )
        await lg.emit_learning_candidate(st)
        pub.assert_not_called()


@pytest.mark.asyncio
async def test_emit_codegen_without_template_key():
    st = _success_state()
    st["template_key"] = None
    st["executed_sql_source"] = "codegen"
    with (
        patch.object(lg, "get_settings") as gs,
        patch.object(lg, "publish_json", new_callable=AsyncMock) as pub,
    ):
        gs.return_value = SimpleNamespace(
            learning_staging_emit_enabled=True,
            kafka_learning_topic="fern.test.learning",
        )
        await lg.emit_learning_candidate(st)
        pub.assert_awaited_once()
        _, payload = pub.await_args.args
        assert payload["generation_mode"] == "codegen"
        assert payload["sql_hash"]
