"""GenSQL AST helpers — phase1 allow-list, RBAC inject smoke."""

import sqlglot

from app.codegen.limit_clamp import clamp_outer_limit
from app.codegen.rbac_inject import inject_outlet_filter
from app.guard.sql_ast import extract_qualified_table_names, validate_sql, validate_sql_phase1
from app.query_modes.codegen.nodes import codegen_structure_guard
from app.query_modes.codegen.nodes import codegen_entry, codegen_retry_or_fallback
from app.query_policy import ALLOWED_FULL_TABLES


def test_validate_sql_phase1_rejects_unknown_table():
    sql = "SELECT 1 FROM analytics.unknown_tbl WHERE 1"
    r = validate_sql_phase1(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert not r.passed
    assert any("Disallowed" in v for v in r.violations)


def test_validate_sql_phase1_rejects_cte():
    sql = "WITH x AS (SELECT 1 AS a) SELECT a FROM x"
    r = validate_sql_phase1(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert not r.passed
    assert any("WITH/CTE" in v for v in r.violations)


def test_validate_sql_phase1_rejects_select_star():
    sql = "SELECT * FROM analytics.ai_sales_daily WHERE business_date >= today() - 1"
    r = validate_sql_phase1(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert not r.passed
    assert any("SELECT *" in v for v in r.violations)


def test_validate_sql_phase1_rejects_sensitive_projection():
    sql = "SELECT phone, address FROM cdc.outlet"
    r = validate_sql_phase1(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert not r.passed
    assert any("cdc.outlet.phone" in v or "cdc.outlet.address" in v for v in r.violations)


def test_validate_sql_phase1_requires_time_filter_for_raw_codegen_table():
    sql = "SELECT sum(line_total) FROM cdc.fact_sale"
    r = validate_sql_phase1(
        sql,
        allowed_tables=ALLOWED_FULL_TABLES,
        require_time_filter_tables=frozenset({"cdc.fact_sale"}),
    )
    assert not r.passed
    assert any("Missing time filter" in v and "cdc.fact_sale.business_date" in v for v in r.violations)

    bounded = "SELECT sum(line_total) FROM cdc.fact_sale WHERE business_date BETWEEN toDate('2026-05-01') AND toDate('2026-05-02')"
    ok = validate_sql_phase1(
        bounded,
        allowed_tables=ALLOWED_FULL_TABLES,
        require_time_filter_tables=frozenset({"cdc.fact_sale"}),
    )
    assert ok.passed


def test_validate_sql_phase1_allows_select_without_outlet():
    sql = "SELECT business_date FROM analytics.fct_sales_daily WHERE business_date >= today() - 1"
    r = validate_sql_phase1(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert r.passed


def test_full_guard_can_enforce_codegen_allowlist_after_rewrite():
    sql = "SELECT outlet_id FROM analytics.unknown_tbl WHERE outlet_id IN (1)"
    r = validate_sql(sql, allowed_tables=ALLOWED_FULL_TABLES)
    assert not r.passed
    assert any("Disallowed table" in v for v in r.violations)


def test_clamp_outer_limit_injects_and_reduces():
    base = "SELECT 1 FROM analytics.fct_sales_daily WHERE business_date >= today()"
    added = clamp_outer_limit(base, 100)
    compact = added.replace(" ", "")
    assert "LIMIT100" in compact

    hi = "SELECT 1 FROM analytics.fct_sales_daily LIMIT 99999"
    lo = clamp_outer_limit(hi, 50)
    assert "LIMIT50" in lo.replace(" ", "") or "LIMIT 50" in lo

    off = "SELECT 1 FROM analytics.fct_sales_daily LIMIT 200 OFFSET 10"
    capped = clamp_outer_limit(off, 30)
    assert "OFFSET 10" in capped
    assert "30" in capped


def test_inject_outlet_then_full_guard_passes():
    sql = "SELECT sum(net_revenue) FROM analytics.fct_sales_daily WHERE business_date >= today() - 7"
    injected = inject_outlet_filter(sql, [10])
    compact = injected.replace(" ", "")
    assert "outlet_id" in compact and "IN(10)" in compact
    full = validate_sql(injected)
    assert full.passed


def test_inject_outlet_uses_event_camelcase_column():
    sql = "SELECT sum(amount) FROM fern.events_payment_captured WHERE businessDate >= today() - 7"
    injected = inject_outlet_filter(sql, [10, 11])
    compact = injected.replace(" ", "")
    assert "outletId" in compact
    assert "IN(10,11)" in compact
    assert validate_sql(injected).passed


def test_inject_outlet_rejects_lookup_only_table():
    sql = "SELECT id, name FROM cdc.product FINAL LIMIT 10"
    try:
        inject_outlet_filter(sql, [10])
    except ValueError as e:
        assert "No scoped" in str(e)
    else:
        raise AssertionError("lookup-only table should not be scoped by GenSQL injector")


def test_extract_qualified_tables_lowercase():
    sql = "SELECT 1 FROM analytics.fct_sales_daily AS s JOIN cdc.outlet AS o ON s.outlet_id = o.id"
    ast = sqlglot.parse_one(sql, dialect="clickhouse")
    names = extract_qualified_table_names(ast)
    assert "analytics.fct_sales_daily" in names
    assert "cdc.outlet" in names


def test_route_always_try(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_sql_enabled = True
        codegen_route_mode = "always_try"
        codegen_confidence_threshold = 0.55

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "intent": "revenue",
        "template_key": "T02_revenue_by_outlet",
        "template_confidence": 0.99,
    }
    assert cf.route_after_template_matcher(state) == "codegen_entry"

    state["response_kind"] = "clarification"
    assert cf.route_after_template_matcher(state) == "answer_formatter"


def test_route_low_confidence(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_sql_enabled = True
        codegen_route_mode = "low_confidence"
        codegen_confidence_threshold = 0.55

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "intent": "revenue",
        "response_kind": "answer",
        "template_key": "T02_revenue_by_outlet",
        "template_confidence": 0.4,
    }
    assert cf.route_after_template_matcher(state) == "codegen_entry"

    state["template_confidence"] = 0.9
    assert cf.route_after_template_matcher(state) == "validator"


def test_route_sql_writer_when_no_template_but_slots_are_clear(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_sql_enabled = True
        codegen_route_mode = "no_template_or_low_confidence"
        codegen_confidence_threshold = 0.55

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "intent": "revenue",
        "response_kind": "clarification",
        "template_key": None,
        "template_confidence": 0.0,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "matcher_missing_info": [],
        "response_hints": [],
        "planning_frame": {"route": "data_query", "next_action": "template_match", "task_type": "metric_summary"},
    }

    assert cf.route_after_template_matcher(state) == "codegen_entry"


def test_route_sql_writer_does_not_override_real_clarification(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_sql_enabled = True
        codegen_route_mode = "no_template_or_low_confidence"
        codegen_confidence_threshold = 0.55

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "intent": "revenue",
        "response_kind": "clarification",
        "template_key": None,
        "time_range": {},
        "matcher_missing_info": ["time_range"],
        "response_hints": ["time_range"],
        "planning_frame": {"route": "data_query", "next_action": "ask_clarification", "ambiguities": ["time_range"]},
    }

    assert cf.route_after_template_matcher(state) == "answer_formatter"


def test_route_sql_writer_respects_skip_reason(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_sql_enabled = True
        codegen_route_mode = "no_template_or_low_confidence"
        codegen_confidence_threshold = 0.55

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "intent": "revenue",
        "response_kind": "answer",
        "template_key": None,
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "codegen_skip_reason": "coverage_outside",
    }

    assert cf.route_after_template_matcher(state) == "answer_formatter"


def test_codegen_structure_guard_rejects_allowed_table_outside_semantic_candidate_pack():
    from app.auth.context import AuthContext

    state = {
        "auth": AuthContext(
            user_id=1,
            session_id="s",
            roles=frozenset({"finance"}),
            permissions=frozenset(),
            outlet_ids=frozenset({1}),
        ),
        "codegen_proposed_sql": "SELECT sum(amount) FROM fern.events_expense_created WHERE createdAt >= toDateTime('2026-05-01')",
        "codegen_tables_used": ["fern.events_expense_created"],
        "codegen_candidate_tables": ["analytics.ai_sales_daily", "cdc.outlet"],
        "trace": [],
    }

    out = codegen_structure_guard(state)

    assert "outside semantic domain candidate pack" in out["codegen_last_error_vi"]
    assert out["trace"][-1]["passed"] is False


def test_codegen_structure_guard_rejects_raw_table_without_time_filter():
    from app.auth.context import AuthContext

    state = {
        "auth": AuthContext(
            user_id=1,
            session_id="s",
            roles=frozenset(),
            permissions=frozenset(),
            outlet_ids=frozenset({1}),
        ),
        "codegen_proposed_sql": "SELECT sum(line_total) FROM cdc.fact_sale",
        "codegen_tables_used": ["cdc.fact_sale"],
        "codegen_candidate_tables": ["cdc.fact_sale"],
        "trace": [],
    }

    out = codegen_structure_guard(state)

    assert "Missing time filter for raw/detail table cdc.fact_sale.business_date" in out["codegen_last_error_vi"]


def test_codegen_entry_clears_template_clarification_state():
    state = {
        "response_kind": "clarification",
        "response_hints": ["template"],
        "matcher_missing_info": ["template"],
        "clarification_question": "missing",
        "trace": [],
    }

    out = codegen_entry(state)

    assert out["sql_source"] == "codegen"
    assert out["response_kind"] == "answer"
    assert out["response_hints"] == []
    assert out["matcher_missing_info"] == []
    assert out["clarification_question"] is None


def test_codegen_entry_preserves_promoted_sql_writer_candidate_pack():
    state = {
        "response_kind": "answer",
        "learned_sql_writer_scenario_asset": {
            "scenario_key": "sqlwriter:test",
            "dataset_candidates": ["cdc.fact_sale", "analytics.ai_sales_daily"],
            "tables_used": ["cdc.fact_sale"],
        },
        "codegen_candidate_tables": ["old.table"],
        "trace": [],
    }

    out = codegen_entry(state)

    assert out["codegen_candidate_tables"] == ["cdc.fact_sale", "analytics.ai_sales_daily"]


def test_codegen_exhausted_without_template_marks_escalation(monkeypatch):
    class S:
        max_codegen_attempts = 1

    monkeypatch.setattr("app.query_modes.codegen.nodes.get_settings", lambda: S())
    state = {
        "sql_source": "codegen",
        "template_key": None,
        "codegen_attempt": 0,
        "codegen_last_error_vi": "Parse error",
        "trace": [],
    }

    out = codegen_retry_or_fallback(state)

    assert out["codegen_exhausted"] is True
    assert out["response_kind"] == "unsupported"
    assert out["escalation_candidate"] is True
    assert out["escalation_reason"] == "sql_writer_exhausted_no_safe_query"


def test_route_after_sql_guard_goes_to_executor_after_codegen_trial(monkeypatch):
    from app.query_modes.codegen import routing as cf

    class S:
        codegen_review_enabled = True

    monkeypatch.setattr(cf, "get_settings", lambda: S())

    state = {
        "guard_passed": True,
        "sql_source": "codegen",
        "executed_sql_source": "codegen",
        "codegen_trial_passed": True,
    }

    assert cf.route_after_sql_guard_unified(state) == "executor"
