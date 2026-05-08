"""Routing helpers for the GenSQL subgraph."""

from app.config import get_settings
from app.graph.state import GraphState

_BLOCKED_INTENTS = frozenset({"hr_staff", "greeting", "thanks"})
_MISSING_SLOT_HINTS = frozenset({"time_range", "metric_or_report", "employee", "outlet"})


def route_structure_ok(state: GraphState) -> str:
    return "rbac" if not state.get("codegen_last_error_vi") else "retry"


def route_after_codegen_rbac(state: GraphState) -> str:
    return "retry" if state.get("codegen_last_error_vi") else "guard"


def route_after_codegen_reviewer(state: GraphState) -> str:
    if state.get("codegen_review_approve"):
        return "trial"
    return "retry"


def route_after_codegen_trial(state: GraphState) -> str:
    return "merge" if state.get("codegen_trial_passed") else "retry"


def route_after_codegen_retry(state: GraphState) -> str:
    if not state.get("codegen_exhausted"):
        return "generator"
    return "validator" if state.get("template_key") else "answer_formatter"


def route_after_sql_guard_unified(state: GraphState) -> str:
    """After hard AST guard: template → executor; codegen → reviewer/trial."""
    s = get_settings()
    if not state.get("guard_passed"):
        if state.get("sql_source") == "codegen":
            return "codegen_retry_or_fallback"
        return "answer_formatter"
    if state.get("executed_sql_source") == "codegen" and state.get("codegen_trial_passed"):
        return "executor"
    if state.get("sql_source") == "codegen":
        return "codegen_reviewer" if s.codegen_review_enabled else "codegen_trial"
    return "executor"


def route_after_template_matcher(state: GraphState) -> str:
    """Template path vs experimental GenSQL subgraph."""
    s = get_settings()
    rk = state.get("response_kind") or ""
    if state.get("codegen_skip_reason"):
        return "answer_formatter"
    if rk == "unsupported":
        return "answer_formatter"
    if not s.codegen_sql_enabled or s.codegen_route_mode == "off":
        if rk == "clarification":
            return "answer_formatter"
        return "validator"
    intent = state.get("intent") or ""
    if intent in _BLOCKED_INTENTS:
        return "validator"
    if rk == "clarification" and not _codegen_can_take_over_unmatched(state):
        return "answer_formatter"
    if s.codegen_route_mode == "low_confidence":
        tk = state.get("template_key")
        conf = float(state.get("template_confidence") or 0.0)
        if tk and conf < s.codegen_confidence_threshold:
            return "codegen_entry"
        return "validator"
    if s.codegen_route_mode == "no_template_or_low_confidence":
        tk = state.get("template_key")
        conf = float(state.get("template_confidence") or 0.0)
        if not tk and _codegen_can_take_over_unmatched(state):
            return "codegen_entry"
        if tk and conf < s.codegen_confidence_threshold:
            return "codegen_entry"
        return "validator"
    if s.codegen_route_mode == "always_try":
        tk = state.get("template_key")
        rk_ok = (state.get("response_kind") or "answer") == "answer"
        if tk and rk_ok:
            return "codegen_entry"
        if not tk and _codegen_can_take_over_unmatched(state):
            return "codegen_entry"
    return "validator"


def sql_writer_preconditions_ok(state: GraphState) -> bool:
    """Whether Finch ``sql_writer_agent`` may run (slots OK, no planner clarification).

    Shared with GenSQL ``_codegen_can_take_over_unmatched`` so one policy decides
    when open-ended SQL/codegen is safe.
    """
    return _codegen_can_take_over_unmatched(state)


def _codegen_can_take_over_unmatched(state: GraphState) -> bool:
    """Allow SQL Writer fallback only when planner did not ask for a real slot clarification."""
    if state.get("agent_route") == "docs_question":
        return False
    intent = str(state.get("intent") or "").strip().lower()
    if intent in _BLOCKED_INTENTS:
        return False

    planning = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    if planning.get("next_action") == "ask_clarification":
        return False

    missing = {
        str(x).strip().lower()
        for x in [
            *(state.get("matcher_missing_info") or []),
            *(state.get("response_hints") or []),
            *(state.get("ambiguities") or []),
            *(planning.get("ambiguities") or []),
        ]
        if str(x).strip()
    }
    if missing & _MISSING_SLOT_HINTS:
        return False

    decision = state.get("planning_decision") if isinstance(state.get("planning_decision"), dict) else {}
    decision_missing = {str(x).strip().lower() for x in (decision.get("missing_slots") or []) if str(x).strip()}
    if decision_missing & _MISSING_SLOT_HINTS:
        return False

    # If the question is ambiguous enough to carry no time at all, let the dialog policy ask first.
    tr = state.get("time_range") if isinstance(state.get("time_range"), dict) else {}
    task = str(planning.get("task_type") or "").strip().lower()
    latest_snapshot_task = intent == "inventory" or task == "inventory"
    has_time = bool(tr.get("from_date") and tr.get("to_date"))
    if not latest_snapshot_task and not has_time:
        return False

    return True
