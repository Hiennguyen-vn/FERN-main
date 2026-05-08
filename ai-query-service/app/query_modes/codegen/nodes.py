"""GenSQL non-LLM nodes: entry, structure gate, RBAC rewrite, retry/fallback."""

from __future__ import annotations

import logging

import sqlglot

from app.codegen.limit_clamp import clamp_outer_limit
from app.codegen.policy import check_codegen_finance_access
from app.codegen.rbac_inject import inject_outlet_filter
from app.codegen.rbac_policy import verify_outlet_in_clause
from app.config import get_settings
from app.graph.state import GraphState
from app.guard.sql_ast import extract_qualified_table_names, validate_sql_phase1
from app.query_policy import ALLOWED_FULL_TABLES, CODEGEN_TIME_FILTER_REQUIRED_TABLES
from app.rbac.policy import compute_allowed_outlets

logger = logging.getLogger(__name__)


def codegen_entry(state: GraphState) -> GraphState:
    learned_sql_writer = state.get("learned_sql_writer_scenario_asset")
    learned_sql_writer = learned_sql_writer if isinstance(learned_sql_writer, dict) else None
    state["sql_source"] = "codegen"
    state["codegen_attempt"] = 0
    state["codegen_exhausted"] = False
    state["response_kind"] = "answer"
    state["response_hints"] = []
    state["matcher_missing_info"] = []
    state["clarification_question"] = None
    state.pop("codegen_feedback_vi", None)
    state.pop("codegen_last_error_vi", None)
    state.pop("codegen_review_approve", None)
    state.pop("codegen_trial_passed", None)
    state.pop("codegen_proposed_sql", None)
    state.pop("codegen_tables_used", None)
    state.pop("codegen_assumption_vi", None)
    state.pop("codegen_sql_plan", None)
    state.pop("codegen_candidate_tables", None)
    state.pop("codegen_rationale_vi", None)
    if learned_sql_writer:
        candidates = [
            str(x).strip().lower()
            for x in [
                *(learned_sql_writer.get("dataset_candidates") or []),
                *(learned_sql_writer.get("tables_used") or []),
            ]
            if str(x).strip()
        ]
        seen: set[str] = set()
        state["codegen_candidate_tables"] = [x for x in candidates if not (x in seen or seen.add(x))]
    state.setdefault("trace", []).append({"node": "codegen_entry"})
    return state


def codegen_structure_guard(state: GraphState) -> GraphState:
    sql = (state.get("codegen_proposed_sql") or "").strip()
    auth = state["auth"]
    err_parts: list[str] = []

    if not sql:
        err_parts.append("Generator returned empty SQL")

    if sql:
        r1 = validate_sql_phase1(
            sql,
            allowed_tables=ALLOWED_FULL_TABLES,
            require_time_filter_tables=CODEGEN_TIME_FILTER_REQUIRED_TABLES,
        )
        if not r1.passed:
            err_parts.extend(list(r1.violations))

        if not err_parts:
            try:
                ast = sqlglot.parse_one(sql, dialect="clickhouse")
                qt = extract_qualified_table_names(ast)
            except Exception as e:  # noqa: BLE001
                err_parts.append(f"AST extract failed: {e}")
                qt = frozenset()

            decl = frozenset(state.get("codegen_tables_used") or [])
            if not err_parts and qt != decl:
                err_parts.append(f"tables_used mismatch: AST={sorted(qt)} vs declared={sorted(decl)}")

            ok_fin, fin_msg = check_codegen_finance_access(qt, auth.roles)
            if not ok_fin and fin_msg:
                err_parts.append(fin_msg)

            candidate_tables = frozenset(str(x).strip().lower() for x in (state.get("codegen_candidate_tables") or []) if str(x).strip())
            outside_candidate = sorted(qt - candidate_tables) if candidate_tables else []
            if outside_candidate:
                err_parts.append(
                    "Table outside semantic domain candidate pack: "
                    f"{outside_candidate}. Retry with one of {sorted(candidate_tables)}"
                )

    if err_parts:
        state["codegen_last_error_vi"] = "; ".join(err_parts)
        state.setdefault("trace", []).append({"node": "codegen_structure_guard", "passed": False})
        return state

    state["guard_allowed_tables"] = sorted(ALLOWED_FULL_TABLES)
    state.pop("codegen_last_error_vi", None)
    state.setdefault("trace", []).append({"node": "codegen_structure_guard", "passed": True})
    return state


def make_codegen_rbac_injector(all_outlet_ids_provider):
    def codegen_rbac_injector(state: GraphState) -> GraphState:
        s = get_settings()
        auth = state["auth"]
        resolved = state.get("resolved_entities", {}) or {}
        requested = list(resolved.get("outlet_ids", []) or [])
        sql_raw = (state.get("codegen_proposed_sql") or "").strip()

        try:
            allowed = compute_allowed_outlets(
                auth_outlet_ids=auth.outlet_ids,
                requested_outlet_ids=requested,
                roles=auth.roles,
                all_outlet_ids_provider=all_outlet_ids_provider,
            )
        except ValueError as e:
            state["codegen_last_error_vi"] = str(e)
            return state

        try:
            injected = inject_outlet_filter(sql_raw, allowed)
            cap = min(s.codegen_max_outer_limit, s.max_rows_per_query)
            injected = clamp_outer_limit(injected, cap)
            ok_in, why = verify_outlet_in_clause(injected, allowed)
            if not ok_in:
                state["codegen_last_error_vi"] = f"RBAC verify failed: {why}"
                return state
        except Exception as e:  # noqa: BLE001
            logger.warning("codegen RBAC inject failed: %s", e)
            state["codegen_last_error_vi"] = f"RBAC inject failed: {e}"
            return state

        state["allowed_outlet_ids"] = allowed
        state["final_sql"] = injected
        state.pop("codegen_last_error_vi", None)
        state.setdefault("trace", []).append({"node": "codegen_rbac_injector", "outlets": len(allowed)})
        return state

    return codegen_rbac_injector


def codegen_retry_or_fallback(state: GraphState) -> GraphState:
    s = get_settings()

    if (
        state.get("sql_source") == "codegen"
        and state.get("guard_passed") is False
        and state.get("guard_violations")
        and not state.get("codegen_last_error_vi")
    ):
        state["codegen_last_error_vi"] = "SQL guard: " + "; ".join(state["guard_violations"])

    cur = state.get("codegen_attempt", 0) + 1
    state["codegen_attempt"] = cur

    err = state.pop("codegen_last_error_vi", None)
    if err:
        prev = (state.get("codegen_feedback_vi") or "").strip()
        piece = f"• {err}"
        state["codegen_feedback_vi"] = f"{prev}\n{piece}".strip() if prev else piece

    if cur >= s.max_codegen_attempts:
        state["codegen_exhausted"] = True
        state.pop("sql_source", None)
        state.pop("final_sql", None)
        state.pop("guard_passed", None)
        state.pop("guard_allowed_tables", None)
        if not state.get("template_key"):
            state["response_kind"] = "unsupported"
            state["clarification_question"] = (
                "Tôi chưa tìm được đường truy vấn SQL an toàn cho câu hỏi này. "
                "Bạn có thể bấm Kiểm tra lại để gửi cho đội dữ liệu, hoặc làm rõ thêm chỉ số/thời gian/phạm vi."
            )
            state["response_hints"] = ["review_request"]
            state["escalation_candidate"] = True
            state["escalation_reason"] = "sql_writer_exhausted_no_safe_query"
            state["escalation_target"] = "review_request"
        state.setdefault("trace", []).append({"node": "codegen_retry_or_fallback", "outcome": "exhausted"})
    else:
        state.setdefault("trace", []).append({"node": "codegen_retry_or_fallback", "attempt": cur})

    return state
