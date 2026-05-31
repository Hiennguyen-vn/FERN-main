from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.auth.context import AuthContext
from app.graph.builder import build_graph
from app.graph.nodes import data_coverage as dc
from app.graph.nodes import entity_resolver as er
from app.graph.nodes import hr_query as hr
from app.graph.nodes import supervisor as sup
from app.graph.nodes import template_matcher as tm
from app.graph.nodes import query_reasoner as qr
from app.agents import reviewer_agent as reviewer_mod
from app.graph.nodes import catalog_digest as cd
from app.graph.nodes import metadata_context as mc
from app.graph.nodes import sql_logical_check as slc
from app.graph.nodes import executor as ex
from app.query_modes.codegen import routing


TODAY = date(2026, 5, 4)


def _settings(**overrides):
    values = {
        "deterministic_supervisor_enabled": True,
        "openai_embeddings_enabled": False,
        "catalog_digest_enabled": False,
        "catalog_digest_max_tables": 2,
        "catalog_digest_max_columns_per_table": 40,
        "catalog_digest_max_chars": 2800,
        "metadata_context_enabled": False,
        "metadata_context_max_hits": 5,
        "metadata_context_max_chars": 2600,
        "query_reasoning_enabled": False,
        "template_fast_path_enabled": True,
        "sql_logical_check_enabled": False,
        "codegen_sql_enabled": False,
        "codegen_route_mode": "off",
        "codegen_confidence_threshold": 0.55,
        "codegen_review_enabled": True,
        "codegen_sql_plan_enabled": True,
        "codegen_max_outer_limit": 1000,
        "max_codegen_attempts": 2,
        "max_codegen_trial_rows": 50,
        "max_codegen_trial_timeout_seconds": 10,
        "max_rows_per_query": 1000,
        "hr_query_enabled": True,
        "hr_query_max_rows": 50,
        "reviewer_agent_enabled": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _auth(*, roles: set[str] | None = None, outlets: set[int] | None = None) -> AuthContext:
    return AuthContext(
        user_id=1,
        session_id="test-session",
        roles=frozenset(roles or {"admin", "finance", "hr"}),
        permissions=frozenset({"ai_query:read", "finance:read", "hr:read"}),
        outlet_ids=frozenset(outlets or {1, 2, 3}),
        correlation_id="test-correlation",
        service_name="gateway",
    )


def _coverage():
    return {
        "datasets": [
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_sales_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 1506,
            },
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_product_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 32925,
            },
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_payment_daily",
                "min_date": "2026-05-02",
                "max_date": "2026-05-02",
                "row_count": 27,
            },
            {
                "source": "clickhouse",
                "dataset": "cdc.fact_sale",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 250000,
            },
            {
                "source": "clickhouse",
                "dataset": "cdc.sale_record",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 120000,
            },
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_inventory_on_hand_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 89877,
            },
            {
                "source": "postgres",
                "dataset": "core.work_shift",
                "min_date": "2025-07-02",
                "max_date": "2026-05-04",
                "row_count": 43836,
            },
            {
                "source": "postgres",
                "dataset": "core.payroll_period",
                "min_date": "2025-07-01",
                "max_date": "2026-03-31",
                "row_count": 9,
            },
        ],
        "errors": [],
    }


@pytest.fixture
def realistic_graph(monkeypatch):
    settings = _settings()
    for module in (sup, er, cd, mc, qr, tm, slc, routing, hr):
        monkeypatch.setattr(module, "get_settings", lambda s=settings: s)
    monkeypatch.setattr(reviewer_mod, "get_settings", lambda s=settings: s)
    monkeypatch.setattr(sup, "today_local", lambda: TODAY)
    monkeypatch.setattr(hr, "today_local", lambda: TODAY)
    monkeypatch.setattr(dc, "_cached_coverage", _coverage)
    monkeypatch.setattr(er, "hybrid_search_aliases", lambda **_kwargs: [])
    monkeypatch.setattr(er, "fetch_outlet_id_by_code_exact", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        er,
        "fetch_outlet_id_by_name_like",
        lambda term, limit=1: [
            {
                "outlet_id": 1 if "1" in term else 2 if "2" in term else 3,
                "code": f"OUT-{term}",
                "name": term,
            }
        ],
    )

    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called in deterministic E2E tests")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(tm, "llm_call_json", fail_llm)
    monkeypatch.setattr(qr, "llm_call_json", fail_llm)
    monkeypatch.setattr(slc, "llm_call_json", fail_llm)

    return build_graph(all_outlet_ids_provider=lambda: [1, 2, 3])


async def _invoke(graph, question: str, *, auth: AuthContext | None = None, turns: list[dict[str, str]] | None = None):
    return await graph.ainvoke(
        {
            "raw_question": question,
            "auth": auth or _auth(),
            "conversation_turns": turns or [],
            "correction_attempts": 0,
            "trace": [],
        },
        config={"configurable": {"thread_id": "test:e2e"}},
    )


@pytest.mark.asyncio
async def test_e2e_ambiguous_metric_returns_one_clarification_without_executor(realistic_graph, monkeypatch):
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))

    out = await _invoke(realistic_graph, "Doanh thu?")

    assert out["response_kind"] == "clarification"
    assert out["answer_text"] == "Bạn muốn xem khoảng thời gian nào (hôm nay, 7 ngày gần nhất, hay tháng này)? Nếu có outlet cụ thể hãy ghi tên."
    assert out["response_hints"] == ["time_range"]
    assert out.get("final_sql") is None
    assert "executor" not in [e.get("node") for e in out["trace"] if isinstance(e, dict)]


@pytest.mark.asyncio
async def test_e2e_short_outlet_followup_overrides_prior_outlet_filter(realistic_graph, monkeypatch):
    seen_sql = []

    def fake_execute(sql: str):
        seen_sql.append(sql)
        return [{"outlet_id": 2, "outlet_name": "Outlet 2", "net_revenue": 2200000, "txn_count": 22}]

    monkeypatch.setattr(ex, "execute_query", fake_execute)
    monkeypatch.setattr(
        er,
        "hybrid_search_aliases",
        lambda **_kwargs: [{"_score": 0.99, "canonical_id": 1}],
    )

    out = await _invoke(
        realistic_graph,
        "còn outlet 2",
        auth=_auth(roles={"outlet_manager"}, outlets={1, 2}),
        turns=[
            {"role": "user", "content": "doanh thu tuần này của outlet 1"},
            {"role": "assistant", "content": "Outlet 1 đạt 1.100.000 đ trong tuần này."},
        ],
    )

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T02_revenue_by_outlet"
    assert out["question_frame"]["effective_question"] == "doanh thu tuần này của outlet 2"
    assert out["question_frame"]["followup_source"] == "rule_short_filter_followup"
    assert out["time_range"] == {"from_date": "2026-05-04", "to_date": "2026-05-04"}
    assert out["allowed_outlet_ids"] == [2]
    assert "outlet_id IN (2)" in seen_sql[0]
    assert "outlet_id IN (1, 2)" not in seen_sql[0]
    assert "Outlet 2" in out["answer_text"]
    assert "SQL" not in out["answer_text"]
    assert "template" not in out["answer_text"].lower()


@pytest.mark.asyncio
async def test_e2e_peak_hour_query_uses_verified_template_without_clarification(realistic_graph, monkeypatch):
    seen_sql = []

    def fake_execute(sql: str):
        seen_sql.append(sql)
        assert "toHour(sr.created_at)" in sql
        assert "sr.business_date BETWEEN '2026-04-27' AND '2026-05-03'" in sql
        return [
            {"hour_of_day": 9, "txn_count": 10, "revenue": 1000000},
            {"hour_of_day": 12, "txn_count": 25, "revenue": 3000000},
            {"hour_of_day": 18, "txn_count": 20, "revenue": 4000000},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "Giờ cao điểm bán hàng trong tuần trước")

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T23_peak_hour_analysis"
    assert out["verified_query_asset"]["template_key"] == "T23_peak_hour_analysis"
    assert out["planning_frame"]["task_type"] == "peak_hour_analysis"
    assert out["planning_frame"]["next_action"] == "verified_template"
    assert out["data_source_context"]["primary_dataset"] == "cdc.sale_record"
    assert "12:00-12:59" in out["answer_text"]
    assert "Nguồn thời gian: business_date trong cdc.sale_record" in out["answer_text"]
    assert "SQL" not in out["answer_text"]
    assert "template" not in out["answer_text"].lower()
    assert seen_sql


@pytest.mark.asyncio
async def test_e2e_peak_sales_q3_2025_parses_quarter_and_runs_peak_hour(realistic_graph, monkeypatch):
    seen_sql = []

    def fake_execute(sql: str):
        seen_sql.append(sql)
        assert "toHour(sr.created_at)" in sql
        assert "sr.business_date BETWEEN '2025-07-02' AND '2025-09-30'" in sql
        return [
            {"hour_of_day": 8, "txn_count": 150, "revenue": 8000000},
            {"hour_of_day": 12, "txn_count": 450, "revenue": 25000000},
            {"hour_of_day": 18, "txn_count": 390, "revenue": 21000000},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "Cao điểm bán hàng quý 3 năm 2025")

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T23_peak_hour_analysis"
    assert out["time_range"] == {"from_date": "2025-07-02", "to_date": "2025-09-30"}
    assert out["planning_frame"]["task_type"] == "peak_hour_analysis"
    assert out["planning_frame"]["next_action"] == "verified_template"
    assert out["data_source_context"]["coverage_status"] == "full"
    assert "12:00-12:59" in out["answer_text"]
    assert "2025-07-02 đến 2025-09-30" in out["answer_text"]
    assert "chỉ cập nhật" not in out["answer_text"]
    assert seen_sql


@pytest.mark.asyncio
async def test_e2e_yoy_outside_coverage_refuses_false_growth_claim(realistic_graph, monkeypatch):
    def fake_execute(sql: str):
        assert "sumIf(net_revenue" in sql
        return [
            {
                "revenue_current": 76926300,
                "revenue_last_year": 0,
                "txn_current": 1140,
                "txn_last_year": 0,
            }
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "doanh thu tháng này so với cùng kỳ năm ngoái")

    assert out["template_key"] == "T07_revenue_comparison_yoy"
    assert out["verified_query_asset"]["template_key"] == "T07_revenue_comparison_yoy"
    assert out["time_context"]["comparison_from_date"] == "2025-05-01"
    assert "Chưa đủ dữ liệu cùng kỳ năm ngoái" in out["answer_text"]
    assert "tăng" not in out["answer_text"].splitlines()[0].lower()
    assert "2025-07-02" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_hr_ordinal_followup_keeps_employee_context_and_new_period(realistic_graph, monkeypatch):
    calls = []

    def fake_execute_readonly(sql, params=None):
        params = params or {}
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0034"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 34
            assert params["from_date"] == "2026-04-01"
            assert params["to_date"] == "2026-04-30"
            return [
                {
                    "user_id": 34,
                    "full_name": "Dinh Hong Son",
                    "username": "sim_small_emp_0034",
                    "employee_code": "SIM-SMALL-EMP-0034",
                    "attended_days": 21,
                    "attended_shifts": 65,
                    "total_work_hours": Decimal("109.22"),
                    "late_shifts": 3,
                    "absent_shifts": 7,
                    "first_work_date": date(2026, 4, 1),
                    "last_work_date": date(2026, 4, 30),
                    "employment_type": "part_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected HR SQL")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute_readonly)

    out = await _invoke(
        realistic_graph,
        "nhân viên 2 tháng trước đã làm bao nhiêu giờ?",
        auth=_auth(roles={"hr"}, outlets={3}),
        turns=[
            {"role": "user", "content": "Dinh Hong Son tháng này đã làm bao nhiêu giờ?"},
            {
                "role": "assistant",
                "content": (
                    "Tìm thấy nhiều nhân viên khớp 'Dinh Hong Son'. Bạn muốn xem giờ làm của ai?\n"
                    "- Dinh Hong Son (SIM-SMALL-EMP-0143) - username sim_small_emp_0143\n"
                    "- Dinh Hong Son (SIM-SMALL-EMP-0034) - username sim_small_emp_0034"
                ),
            },
        ],
    )

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["template_key"] == "HR_employee_work_hours"
    assert out["response_kind"] == "answer"
    assert out["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-04-30"}
    assert "Dinh Hong Son (SIM-SMALL-EMP-0034)" in out["answer_text"]
    assert "109.22 giờ" in out["answer_text"]
    assert "2026-04-01 đến 2026-04-30" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_social_early_exit_does_not_touch_data_nodes(realistic_graph, monkeypatch):
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))
    monkeypatch.setattr(hr.pg, "execute_readonly", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no Postgres")))

    out = await _invoke(realistic_graph, "xin chào")

    nodes = [e.get("node") for e in out["trace"] if isinstance(e, dict)]
    assert out["response_kind"] == "answer"
    assert out["intent"] == "greeting"
    assert "AI Analyst" in out["answer_text"]
    assert "data_coverage" not in nodes
    assert "executor" not in nodes


@pytest.mark.asyncio
async def test_e2e_payment_method_has_single_day_source_caveat(realistic_graph, monkeypatch):
    def fake_execute(sql: str):
        assert "analytics.ai_payment_daily" in sql
        return [
            {"payment_method": "bank_transfer", "revenue": 2308001309, "txn_count": 34717},
            {"payment_method": "cash", "revenue": 2305469371, "txn_count": 34672},
            {"payment_method": "ewallet", "revenue": 2302905746, "txn_count": 34620},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "doanh thu theo phương thức thanh toán tháng này")

    assert out["template_key"] == "T08_revenue_by_payment_method"
    assert "dữ liệu hiện có 2026-05-02 đến 2026-05-02" in out["answer_text"]
    assert "Phạm vi: 2026-05-02" in out["answer_text"]
    assert "SQL" not in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_payment_breakdown_colloquial_phrase_uses_report_spec(realistic_graph, monkeypatch):
    settings = _settings(query_reasoning_enabled=True)
    for module in (sup, er, cd, mc, qr, tm, slc, routing, hr):
        monkeypatch.setattr(module, "get_settings", lambda s=settings: s)
    monkeypatch.setattr(sup, "today_local", lambda: TODAY)
    monkeypatch.setattr(hr, "today_local", lambda: TODAY)
    monkeypatch.setattr(dc, "_cached_coverage", _coverage)
    monkeypatch.setattr(er, "hybrid_search_aliases", lambda **_kwargs: [])
    monkeypatch.setattr(er, "fetch_outlet_id_by_code_exact", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        er,
        "fetch_outlet_id_by_name_like",
        lambda term, limit=1: [
            {
                "outlet_id": 1 if "1" in term else 2 if "2" in term else 3,
                "code": f"OUT-{term}",
                "name": term,
            }
        ],
    )

    async def fail_llm(*_args, **_kwargs):
        raise AssertionError("LLM should not be called in deterministic reasoning test")

    monkeypatch.setattr(sup, "llm_call_json", fail_llm)
    monkeypatch.setattr(tm, "llm_call_json", fail_llm)
    monkeypatch.setattr(qr, "llm_call_json", fail_llm)
    monkeypatch.setattr(slc, "llm_call_json", fail_llm)

    reasoning_graph = build_graph(all_outlet_ids_provider=lambda: [1, 2, 3])

    def fake_execute(sql: str):
        assert "analytics.ai_payment_daily" in sql
        return [
            {"payment_method": "bank_transfer", "revenue": 2308001309, "txn_count": 34717},
            {"payment_method": "cash", "revenue": 2305469371, "txn_count": 34672},
            {"payment_method": "ewallet", "revenue": 2302905746, "txn_count": 34620},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(reasoning_graph, "doanh thu chia theo hình thức thu tiền tháng này")

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T08_revenue_by_payment_method"
    assert out["planning_decision"]["report_spec"]["group_by"] == "payment_method"
    assert out["planning_decision"]["recommended_template_keys"] == ["T08_revenue_by_payment_method"]
    assert out["data_source_context"]["primary_dataset"] == "analytics.ai_payment_daily"
    assert "bank_transfer" in out["answer_text"]
    assert "dữ liệu hiện có 2026-05-02 đến 2026-05-02" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_inventory_negative_stock_uses_latest_snapshot_template(realistic_graph, monkeypatch):
    def fake_execute(sql: str):
        assert "cdc.inventory_transaction" in sql
        assert "SELECT max(business_date)" in sql
        assert "HAVING qty_on_hand < 0" in sql
        return [
            {"outlet_id": 6, "item_id": 3485603532637749262, "snapshot_date": "2026-05-02", "qty_on_hand": -8752},
            {"outlet_id": 6, "item_id": 3485603532637749254, "snapshot_date": "2026-05-02", "qty_on_hand": -5065},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "mặt hàng nào tồn âm nhiều nhất hiện tại")

    assert out["template_key"] == "T12_inventory_low_stock"
    assert out["template_params"]["threshold"] == 0
    assert "3485603532637749262" in out["answer_text"]
    assert "snapshot 2026-05-02" in out["answer_text"]
    assert "cặp outlet-item" in out["answer_text"]
    assert "không tự suy diễn tên sản phẩm" in out["answer_text"].lower()
    assert "Kiểm tra logic" not in out["answer_text"]
    assert any(
        isinstance(e, dict) and e.get("source") == "deterministic_inventory_stock" for e in out["trace"]
    )


@pytest.mark.asyncio
async def test_e2e_inventory_negative_stock_stays_inventory_when_reasoning_enabled(realistic_graph, monkeypatch):
    settings = _settings(query_reasoning_enabled=True)
    for module in (sup, er, cd, mc, qr, tm, slc, routing, hr):
        monkeypatch.setattr(module, "get_settings", lambda s=settings: s)
    monkeypatch.setattr(sup, "today_local", lambda: TODAY)
    monkeypatch.setattr(hr, "today_local", lambda: TODAY)
    monkeypatch.setattr(dc, "_cached_coverage", _coverage)

    def fake_execute(sql: str):
        assert "cdc.inventory_transaction" in sql
        assert "analytics.ai_sales_daily" not in sql
        assert "HAVING qty_on_hand < 0" in sql
        return [
            {"outlet_id": 6, "item_id": 3485603532637749262, "snapshot_date": "2026-05-02", "qty_on_hand": -8752},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "tồn kho hiện tại mặt hàng nào tồn âm nhiều nhất")

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T12_inventory_low_stock"
    assert out["template_params"]["threshold"] == 0
    assert out["planning_frame"]["domain"] == "inventory"
    assert out["planning_decision"]["recommended_template_keys"] == ["T12_inventory_low_stock"]
    assert out["data_source_context"]["primary_dataset"] == "analytics.ai_inventory_on_hand_daily"
    assert "snapshot 2026-05-02" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_sql_writer_generates_sql_when_no_template_matches(realistic_graph, monkeypatch):
    settings = _settings(
        codegen_sql_enabled=True,
        codegen_route_mode="no_template_or_low_confidence",
        codegen_review_enabled=False,
        codegen_sql_plan_enabled=False,
    )
    for module in (sup, er, cd, mc, qr, tm, slc, routing, hr):
        monkeypatch.setattr(module, "get_settings", lambda s=settings: s)
    monkeypatch.setattr(sup, "today_local", lambda: TODAY)
    monkeypatch.setattr(dc, "_cached_coverage", _coverage)
    monkeypatch.setattr(tm, "_fast_template_match", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(tm, "select_verified_query", lambda **_kwargs: None)
    monkeypatch.setattr(tm, "select_learned_scenario", lambda **_kwargs: None)
    monkeypatch.setattr("app.query_modes.codegen.planner.get_settings", lambda s=settings: s)
    monkeypatch.setattr("app.query_modes.codegen.nodes.get_settings", lambda s=settings: s)
    monkeypatch.setattr("app.query_modes.codegen.routing.get_settings", lambda s=settings: s)
    monkeypatch.setattr("app.query_modes.codegen.trial.get_settings", lambda s=settings: s)

    async def fail_matcher_llm(*_args, **_kwargs):
        raise RuntimeError("no template match")

    async def fake_generator_llm(**_kwargs):
        return (
            {
                "proposed_sql": (
                    "SELECT business_date, sum(net_revenue) AS revenue "
                    "FROM analytics.ai_sales_daily "
                    "WHERE business_date BETWEEN toDate('2026-05-01') AND toDate('2026-05-04') "
                    "GROUP BY business_date ORDER BY business_date"
                ),
                "rationale_vi": "Dùng metric view doanh thu ngày.",
                "assumption_vi": "Grain theo business_date; backend inject outlet.",
                "tables_used": ["analytics.ai_sales_daily"],
            },
            {"tokens_in": 10, "tokens_out": 20, "latency_ms": 1},
        )

    monkeypatch.setattr(tm, "llm_call_json", fail_matcher_llm)
    monkeypatch.setattr("app.query_modes.codegen.generator.llm_call_json", fake_generator_llm)
    monkeypatch.setattr("app.clients.clickhouse.explain_syntax", lambda _sql: (True, ""))
    monkeypatch.setattr("app.clients.clickhouse.explain_pipeline", lambda _sql, max_execution_seconds=5.0: (True, ""))
    monkeypatch.setattr("app.clients.clickhouse.execute_query_with_settings", lambda _sql, settings=None: [{"ok": 1}])

    def fake_execute(sql: str):
        assert "analytics.ai_sales_daily" in sql
        compact = sql.replace(" ", "")
        assert "outlet_idIN(1,2,3)" in compact or ".outlet_idIN(1,2,3)" in compact
        return [
            {"business_date": "2026-05-01", "revenue": 1000000},
            {"business_date": "2026-05-02", "revenue": 1200000},
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "doanh thu theo thứ trong tuần tháng này")

    assert out["response_kind"] == "answer"
    assert out["executed_sql_source"] == "codegen"
    assert out["template_key"] is None
    assert out["codegen_trial_passed"] is True
    assert "codegen_generator" in [e.get("node") for e in out["trace"] if isinstance(e, dict)]
    assert "2 dòng dữ liệu" in out["answer_text"] or "2026-05-01" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_hr_duplicate_employee_name_clarifies_without_work_hours_query(realistic_graph, monkeypatch):
    calls = []

    def fake_execute_readonly(sql, params=None):
        params = params or {}
        calls.append((sql, params))
        assert sql == hr._EMPLOYEE_SEARCH_SQL
        assert params["pattern"] == "%Nguyen Van An%"
        return [
            {"user_id": 79, "full_name": "Nguyen Van An", "username": "sim_small_emp_0079", "employee_code": "SIM-SMALL-EMP-0079"},
            {"user_id": 90, "full_name": "Nguyen Van An", "username": "sim_small_emp_0090", "employee_code": "SIM-SMALL-EMP-0090"},
            {"user_id": 185, "full_name": "Nguyen Van An", "username": "sim_small_emp_0185", "employee_code": "SIM-SMALL-EMP-0185"},
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute_readonly)
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))

    out = await _invoke(realistic_graph, "Nguyen Van An tháng này làm bao nhiêu giờ?", auth=_auth(roles={"hr"}, outlets={3}))

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL]
    assert out["response_kind"] == "clarification"
    assert out["template_key"] == "HR_employee_work_hours"
    assert "Tìm thấy nhiều nhân viên" in out["answer_text"]
    assert "SIM-SMALL-EMP-0079" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_hr_time_clarification_answer_with_prefix_does_not_fall_to_staff_list(realistic_graph, monkeypatch):
    calls = []

    def fake_execute_readonly(sql, params=None):
        params = params or {}
        calls.append((sql, params))
        assert sql == hr._ATTENDANCE_TOP_SQL
        assert params["from_date"] == "2026-05-01"
        assert params["to_date"] == "2026-05-04"
        return [
            {
                "user_id": 84,
                "full_name": "Ngo Anh Linh",
                "username": "sim_small_emp_0084",
                "employee_code": "SIM-SMALL-EMP-0084",
                "attended_days": 2,
                "attended_shifts": 6,
                "total_work_hours": Decimal("41.50"),
                "late_shifts": 0,
                "absent_shifts": 0,
                "first_work_date": date(2026, 5, 1),
                "last_work_date": date(2026, 5, 2),
                "employment_type": "full_time",
                "outlet_codes": "SIM-SMALL-OUT-0003",
                "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
            }
        ]

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute_readonly)
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))

    out = await _invoke(
        realistic_graph,
        "thế tháng này'",
        auth=_auth(roles={"hr"}, outlets={3}),
        turns=[
            {"role": "user", "content": "nhân viên nào đi làm nhiều nhất?"},
            {"role": "assistant", "content": "Bạn muốn xem trong khoảng thời gian nào (hôm nay, tuần này, tháng này, hay năm nay)?"},
        ],
    )

    assert [c[0] for c in calls] == [hr._ATTENDANCE_TOP_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_attendance_top"
    assert out["time_range"] == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert out["question_frame"]["followup_source"] == "rule_time_followup"
    assert "Ngo Anh Linh (SIM-SMALL-EMP-0084)" in out["answer_text"]
    assert "HR_staff_list" not in str(out.get("template_key"))


@pytest.mark.asyncio
async def test_e2e_hr_employee_selection_after_duplicate_clarification_inherits_time(realistic_graph, monkeypatch):
    calls = []

    def fake_execute_readonly(sql, params=None):
        params = params or {}
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0009"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 9
            assert params["from_date"] == "2026-05-01"
            assert params["to_date"] == "2026-05-04"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                    "attended_days": 2,
                    "attended_shifts": 3,
                    "total_work_hours": Decimal("12.75"),
                    "late_shifts": 0,
                    "absent_shifts": 1,
                    "first_work_date": date(2026, 5, 1),
                    "last_work_date": date(2026, 5, 2),
                    "employment_type": "part_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected HR SQL")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute_readonly)
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))

    out = await _invoke(
        realistic_graph,
        "tôi muốn xem giờ làm của - Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009",
        auth=_auth(roles={"hr"}, outlets={3}),
        turns=[
            {"role": "user", "content": "Nguyen Van An tháng này làm bao nhiêu giờ?"},
            {
                "role": "assistant",
                "content": (
                    "Tìm thấy nhiều nhân viên khớp 'Nguyen Van An'. Bạn muốn xem giờ làm của ai?\n"
                    "- Nguyen Van An (SIM-SMALL-EMP-0009) - username sim_small_emp_0009\n"
                    "- Nguyen Van An (SIM-SMALL-EMP-0090) - username sim_small_emp_0090"
                ),
            },
        ],
    )

    assert [c[0] for c in calls] == [hr._EMPLOYEE_SEARCH_SQL, hr._EMPLOYEE_WORK_HOURS_SQL]
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert out["time_range"] == {"from_date": "2026-05-01", "to_date": "2026-05-04"}
    assert out["question_frame"]["followup_source"] == "rule_hr_employee_selection_followup"
    assert "Nguyen Van An (SIM-SMALL-EMP-0009)" in out["answer_text"]
    assert "12.75 giờ" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_hr_previous_month_followup_keeps_employee_code_context(realistic_graph, monkeypatch):
    calls = []

    def fake_execute_readonly(sql, params=None):
        params = params or {}
        calls.append((sql, params))
        if sql == hr._EMPLOYEE_SEARCH_SQL:
            assert params["term"] == "SIM-SMALL-EMP-0009"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                }
            ]
        if sql == hr._EMPLOYEE_WORK_HOURS_SQL:
            assert params["user_id"] == 9
            assert params["from_date"] == "2026-04-01"
            assert params["to_date"] == "2026-04-30"
            return [
                {
                    "user_id": 9,
                    "full_name": "Nguyen Van An",
                    "username": "sim_small_emp_0009",
                    "employee_code": "SIM-SMALL-EMP-0009",
                    "attended_days": 18,
                    "attended_shifts": 26,
                    "total_work_hours": Decimal("143.50"),
                    "late_shifts": 1,
                    "absent_shifts": 0,
                    "first_work_date": date(2026, 4, 1),
                    "last_work_date": date(2026, 4, 30),
                    "employment_type": "part_time",
                    "outlet_codes": "SIM-SMALL-OUT-0003",
                    "outlet_labels": "Outlet VN-HCM-3 (SIM-SMALL-OUT-0003)",
                }
            ]
        raise AssertionError("unexpected HR SQL")

    monkeypatch.setattr(hr.pg, "execute_readonly", fake_execute_readonly)
    monkeypatch.setattr(ex, "execute_query", lambda _sql: (_ for _ in ()).throw(AssertionError("no ClickHouse")))

    out = await _invoke(
        realistic_graph,
        "tháng trước thì sao",
        auth=_auth(roles={"hr"}, outlets={3}),
        turns=[{"role": "user", "content": "SIM-SMALL-EMP-0009 tháng này làm bao nhiêu giờ?"}],
    )

    assert calls[-1][0] == hr._EMPLOYEE_WORK_HOURS_SQL
    assert out["response_kind"] == "answer"
    assert out["template_key"] == "HR_employee_work_hours"
    assert out["time_range"] == {"from_date": "2026-04-01", "to_date": "2026-04-30"}
    assert out["question_frame"]["followup_source"] == "rule_time_followup"
    assert "Nguyen Van An (SIM-SMALL-EMP-0009)" in out["answer_text"]
    assert "143.50 giờ" in out["answer_text"]


@pytest.mark.asyncio
async def test_e2e_revenue_7_year_window_runs_with_coverage_caveat(realistic_graph, monkeypatch):
    def fake_execute(sql: str):
        assert "analytics.ai_sales_daily" in sql
        assert "business_date BETWEEN '2025-07-02' AND '2026-05-04'" in sql
        return [
            {
                "active_outlets": 8,
                "net_revenue": 1656466790,
                "gross_revenue": 1507026000,
                "txn_count": 25390,
                "discount_amount": 1147100,
                "business_days": 305,
            }
        ]

    monkeypatch.setattr(ex, "execute_query", fake_execute)

    out = await _invoke(realistic_graph, "doanh thu 7 năm gần nhất")

    assert out["response_kind"] == "answer"
    assert out["template_key"] == "T32_period_revenue_summary"
    assert out["time_range"] == {"from_date": "2025-07-02", "to_date": "2026-05-04"}
    assert out["data_source_context"]["coverage_status"] == "full"
    assert "2025-07-02 đến 2026-05-04" in out["answer_text"]
    assert "không ước lượng" not in out["answer_text"].lower()
