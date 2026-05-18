"""Derive compact workflow metadata from graph state + trace (observability / debug API)."""

from __future__ import annotations

from typing import Any

from app.audit.events import graph_outcome

_TRACE_KEYS_FOR_CLIENT = frozenset(
    {
        "node",
        "skipped",
        "reason",
        "error",
        "outcome",
        "attempt",
        "passed",
        "agent",
        "source",
        "stage",
        "latency_ms",
        "tokens_in",
        "tokens_out",
        "model",
        "provider",
        "hits",
        "chars",
        "shortcut",
        "verified_asset",
        "scenario_key",
        "rows",
        "outlets",
        "datasets",
        "coverage_status",
        "router_layer",
        "confidence",
        "next_action",
    }
)


def workflow_node_sequence(trace: list[Any]) -> list[str]:
    """Ordered nodes as executed, collapsing consecutive duplicates."""
    seq: list[str] = []
    prev: str | None = None
    for e in trace:
        if not isinstance(e, dict):
            continue
        n = e.get("node")
        if not n:
            continue
        name = str(n)
        if name != prev:
            seq.append(name)
            prev = name
    return seq


def _trace_node_skipped(trace: list[Any], node: str) -> bool | None:
    for e in trace:
        if not isinstance(e, dict):
            continue
        if e.get("node") != node:
            continue
        if "skipped" in e:
            return bool(e.get("skipped"))
    return None


def compact_trace_for_client(trace: list[Any], *, max_entries: int = 48) -> list[dict[str, Any]]:
    """Trim trace to whitelisted keys for safe client exposure."""
    out: list[dict[str, Any]] = []
    tail = trace[-max_entries:] if len(trace) > max_entries else trace
    for e in tail:
        if not isinstance(e, dict):
            continue
        slim: dict[str, Any] = {}
        for k in _TRACE_KEYS_FOR_CLIENT:
            if k not in e:
                continue
            v = e[k]
            if k == "error" and isinstance(v, str):
                v = v[:240]
            slim[k] = v
        if slim.get("node"):
            out.append(slim)
    return out


def _derive_escalation(state: dict[str, Any], *, lane: str) -> tuple[bool, str | None]:
    explicit = state.get("escalation_candidate")
    reason = str(state.get("escalation_reason") or "").strip() or None
    if explicit is not None:
        return bool(explicit), reason

    if lane != "analytics":
        return False, None

    if state.get("response_kind") == "unsupported":
        return True, reason or "no_safe_supported_route"

    planning = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    question_frame = state.get("question_frame") if isinstance(state.get("question_frame"), dict) else {}
    has_followup = bool(question_frame.get("followup_source")) or bool(question_frame.get("is_time_followup")) or bool(
        state.get("contextualized_question")
    )
    ambiguities = [str(x).strip() for x in (planning.get("ambiguities") or []) if str(x).strip()]
    if planning.get("next_action") == "ask_clarification" and has_followup and ambiguities:
        return True, reason or "still_missing_slots_after_followup"
    return False, None


def build_workflow_summary(state: dict[str, Any], *, graph_cpu_ms: int | None = None) -> dict[str, Any]:
    """
    Summarize execution lane, SQL source, graph outcome, and codegen signals.
    Intended for operators / UI debug — not shown unless explicitly enabled on the API.
    """
    trace = state.get("trace") or []
    seq = workflow_node_sequence(trace)

    lane = "analytics"
    if state.get("social_kind"):
        lane = "social"
    elif state.get("agent_route") == "docs_question":
        lane = "docs"
    elif state.get("intent") == "hr_staff" or state.get("hr_query_kind"):
        lane = "hr"

    lane_detail = lane
    if lane == "hr":
        lane_detail = "hr_static"
    elif lane == "docs":
        lane_detail = "docs_rag"
    elif lane == "social":
        lane_detail = "social_reply"
    elif any(n.startswith("codegen_") for n in seq):
        lane_detail = "gensql_trial"
    elif state.get("learned_scenario_asset") or any(
        isinstance(e, dict) and e.get("source") == "learned_scenario" for e in trace
    ):
        lane_detail = "learned_scenario"
    elif any(isinstance(e, dict) and e.get("node") == "sql_logical_check" and not e.get("skipped") for e in trace):
        lane_detail = "template_with_reviewer"
    elif state.get("verified_query_asset") or any(
        isinstance(e, dict) and e.get("source") == "verified_query" for e in trace
    ):
        lane_detail = "deterministic_template"

    sql_exec = state.get("executed_sql_source")
    if sql_exec not in ("codegen", "template"):
        sql_exec = None
    if sql_exec is None and isinstance(state.get("sql_source"), str):
        ss = state["sql_source"]
        sql_exec = ss if ss in ("codegen", "template") else None

    summary: dict[str, Any] = {
        "lane": lane,
        "lane_detail": lane_detail,
        "node_sequence": seq,
        "response_kind": state.get("response_kind"),
        "template_key": state.get("template_key"),
        "sql_execution_source": sql_exec,
        "graph_outcome": graph_outcome(state),
        "guard_passed": state.get("guard_passed"),
        "correction_attempts": int(state.get("correction_attempts") or 0),
        "codegen_attempt_last": int(state.get("codegen_attempt") or 0),
    }

    if state.get("contextualized_question"):
        summary["contextualized"] = {
            "applied": True,
            "source": state.get("contextualization_source"),
        }

    escalation_candidate, escalation_reason = _derive_escalation(state, lane=lane)
    summary["escalation_candidate"] = escalation_candidate
    if escalation_reason:
        summary["escalation_reason"] = escalation_reason

    frame = state.get("question_frame")
    if isinstance(frame, dict) and frame:
        summary["question_frame"] = {
            "intent": frame.get("intent"),
            "time_source": frame.get("time_source"),
            "followup_source": frame.get("followup_source"),
            "is_time_followup": bool(frame.get("is_time_followup")),
        }

    planning = state.get("planning_frame")
    if isinstance(planning, dict) and planning:
        summary["planning_frame"] = {
            "route": planning.get("route"),
            "intent": planning.get("intent"),
            "domain": planning.get("domain"),
            "task_type": planning.get("task_type"),
            "metric_ids": list(planning.get("metric_ids") or [])[:8],
            "time_source": planning.get("time_source"),
            "next_action": planning.get("next_action"),
            "ambiguity_count": len(planning.get("ambiguities") or []),
        }
        summary["route_confidence"] = planning.get("confidence")
        if planning.get("ambiguities"):
            summary["clarification_reason"] = str((planning.get("ambiguities") or [""])[0])

    decision = state.get("planning_decision")
    if isinstance(decision, dict) and decision:
        summary["planning_decision"] = {
            "selected_domain": decision.get("selected_domain"),
            "selected_metric_ids": list(decision.get("selected_metric_ids") or [])[:8],
            "selected_dataset_candidates": list(decision.get("selected_dataset_candidates") or [])[:8],
            "missing_slots": list(decision.get("missing_slots") or [])[:4],
            "recommended_template_keys": list(decision.get("recommended_template_keys") or [])[:6],
        }
        if isinstance(decision.get("report_spec"), dict):
            spec = decision["report_spec"]
            summary["planning_decision"]["report_spec"] = {
                "analysis_mode": spec.get("analysis_mode"),
                "group_by": spec.get("group_by"),
                "time_axis": spec.get("time_axis"),
                "comparison_mode": spec.get("comparison_mode"),
                "ranking_mode": spec.get("ranking_mode"),
                "metric_focus": list(spec.get("metric_focus") or [])[:4],
            }

    verified = state.get("verified_query_asset")
    if isinstance(verified, dict) and verified:
        summary["verified_query"] = {
            "template_key": verified.get("template_key"),
            "metric_ids": verified.get("metric_ids") or [],
            "time_column": verified.get("time_column"),
            "outlet_column": verified.get("outlet_column"),
            "golden_cases": verified.get("golden_cases") or [],
        }

    learned = state.get("learned_scenario_asset")
    if isinstance(learned, dict) and learned:
        summary["learned_scenario"] = {
            "scenario_key": learned.get("scenario_key"),
            "template_key": learned.get("template_key"),
            "intent": learned.get("intent"),
            "domain": learned.get("domain"),
            "task_type": learned.get("task_type"),
            "metric_ids": list(learned.get("metric_ids") or [])[:8],
            "required_slots": list(learned.get("required_slots") or [])[:8],
        }

    learned_sql_writer = state.get("learned_sql_writer_scenario_asset")
    if isinstance(learned_sql_writer, dict) and learned_sql_writer:
        summary["learned_sql_writer_scenario"] = {
            "scenario_key": learned_sql_writer.get("scenario_key"),
            "intent": learned_sql_writer.get("intent"),
            "domain": learned_sql_writer.get("domain"),
            "task_type": learned_sql_writer.get("task_type"),
            "metric_ids": list(learned_sql_writer.get("metric_ids") or [])[:8],
            "required_slots": list(learned_sql_writer.get("required_slots") or [])[:8],
            "dataset_candidates": list(learned_sql_writer.get("dataset_candidates") or [])[:8],
        }

    time_ctx = state.get("time_context")
    if isinstance(time_ctx, dict) and time_ctx:
        summary["time_context"] = {
            "from_date": time_ctx.get("from_date"),
            "to_date": time_ctx.get("to_date"),
            "source": time_ctx.get("source"),
            "is_time_followup": bool(time_ctx.get("is_time_followup")),
        }

    coverage = state.get("data_coverage_context")
    rows = coverage.get("datasets") if isinstance(coverage, dict) else []
    if isinstance(rows, list) and rows:
        summary["data_coverage"] = [
            {
                "dataset": str(row.get("dataset") or ""),
                "min_date": str(row.get("min_date") or ""),
                "max_date": str(row.get("max_date") or ""),
                "row_count": int(row.get("row_count") or 0),
            }
            for row in rows
            if isinstance(row, dict)
        ][:12]

    source_ctx = state.get("data_source_context")
    if isinstance(source_ctx, dict) and source_ctx:
        selected = source_ctx.get("selected_data_sources")
        safe_sources: list[dict[str, Any]] = []
        if isinstance(selected, list):
            for row in selected[:8]:
                if not isinstance(row, dict):
                    continue
                safe_sources.append(
                    {
                        "dataset": str(row.get("dataset") or row.get("primary_dataset") or ""),
                        "source_system": str(row.get("source_system") or ""),
                        "storage": str(row.get("storage") or ""),
                        "time_column": row.get("time_column"),
                        "time_semantics": str(row.get("time_semantics") or ""),
                        "available_range": row.get("available_range") or {},
                        "coverage_status": str(row.get("coverage_status") or ""),
                    }
                )
        summary["selected_data_sources"] = safe_sources
        summary["coverage_status"] = source_ctx.get("coverage_status")
        summary["time_semantics"] = source_ctx.get("time_semantics")

    if graph_cpu_ms is not None:
        summary["graph_cpu_ms"] = graph_cpu_ms

    touched_codegen = any(n.startswith("codegen_") for n in seq)
    if touched_codegen:
        summary["codegen"] = {
            "exhausted": bool(state.get("codegen_exhausted")),
            "trial_passed": state.get("codegen_trial_passed"),
            "review_approve": state.get("codegen_review_approve"),
            "planner_skipped": _trace_node_skipped(trace, "codegen_sql_planner"),
        }

    plan = state.get("codegen_sql_plan")
    if isinstance(plan, dict) and plan.get("goal_vi"):
        summary["plan_goal_vi"] = str(plan.get("goal_vi") or "")[:400]

    return summary


def build_workflow_steps(state: dict[str, Any]) -> list[dict[str, str]]:
    """User-safe stepper for UI status visibility; never includes SQL/prompt text."""
    trace = state.get("trace") or []
    seq = set(workflow_node_sequence(trace))

    has_error = bool(state.get("validation_errors") or state.get("guard_violations") or state.get("execution_error"))
    lane = "analytics"
    if state.get("agent_route") == "docs_question":
        lane = "docs"
    elif state.get("intent") == "hr_staff" or state.get("hr_query_kind"):
        lane = "hr"
    elif state.get("social_kind") or state.get("intent") in ("greeting", "thanks"):
        lane = "social"

    if lane == "social":
        plan = [
            ("analyze", "Nhận diện lời chào/cảm ơn", ("contextualizer", "social_reply")),
            ("format", "Trả lời ngắn gọn", ("social_reply",)),
            ("review", "Rà soát trả lời", ("reviewer_agent",)),
        ]
    elif lane == "docs":
        plan = [
            ("analyze", "Phân tích câu hỏi", ("contextualizer", "supervisor")),
            ("metadata", "Tra cứu knowledge/metadata", ("metadata_context", "doc_reader")),
            ("format", "Tổng hợp câu trả lời", ("doc_reader", "answer_formatter")),
            ("review", "Rà soát trả lời", ("reviewer_agent",)),
        ]
    elif lane == "hr":
        plan = [
            ("analyze", "Phân tích câu hỏi", ("contextualizer", "supervisor")),
            ("resolve", "Xác định outlet/nhân viên", ("entity_resolver",)),
            ("security", "Áp dụng quyền HR/RBAC", ("hr_query",)),
            ("coverage", "Kiểm tra dữ liệu sẵn có", ("data_coverage",)),
            ("execute", "Truy vấn dữ liệu HR", ("hr_query",)),
            ("format", "Định dạng câu trả lời", ("answer_formatter", "hr_query")),
            ("review", "Rà soát trả lời", ("reviewer_agent",)),
        ]
    else:
        plan = [
            ("analyze", "Phân tích câu hỏi", ("contextualizer", "supervisor", "supervisor_agent")),
            ("metadata", "Tra cứu metadata", ("catalog_digest", "metadata_context")),
            ("coverage", "Kiểm tra dữ liệu sẵn có", ("data_coverage",)),
            ("plan", "Chọn template hoặc lập kế hoạch SQL", ("query_reasoner", "template_matcher", "codegen_sql_planner", "supervisor_agent")),
            ("security", "Áp dụng RBAC và SQL guard", ("rbac_injector", "codegen_rbac_injector", "sql_guard")),
            ("execute", "Chạy truy vấn", ("executor", "codegen_trial", "template_path")),
            ("format", "Định dạng câu trả lời", ("answer_formatter", "analysis_brief")),
            ("review", "Rà soát trả lời", ("reviewer_agent",)),
        ]
        if state.get("visualization_requested") or state.get("chart_spec"):
            plan.insert(-2, ("visualize", "Tạo chart spec", ("visualizer",)))

    out: list[dict[str, str]] = []
    for key, label, nodes in plan:
        touched = any(n in seq for n in nodes)
        status = "done" if touched else "skipped"
        if has_error and key in {"security", "execute"} and touched:
            status = "failed"
        out.append({"key": key, "label": label, "status": status})
    return out
