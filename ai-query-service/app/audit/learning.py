"""Optional Kafka staging stream for RAG / learning promotion pipelines."""

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any

from app.audit.events import _hash_sql, _redact_pii, _truncate, graph_outcome
from app.clients.kafka import publish_json
from app.config import get_settings
from app.graph.state import GraphState
from app.query_policy import build_scenario_candidate_from_state


def _sql_writer_candidate_from_state(state: GraphState, *, sql_hash: str) -> dict[str, Any] | None:
    if state.get("executed_sql_source") != "codegen":
        return None
    if not state.get("codegen_trial_passed") or not state.get("guard_passed") or state.get("execution_error"):
        return None
    question = str(state.get("normalized_question") or state.get("contextualized_question") or "").strip()
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    decision = state.get("planning_decision") if isinstance(state.get("planning_decision"), dict) else {}
    plan = state.get("codegen_sql_plan") if isinstance(state.get("codegen_sql_plan"), dict) else {}
    tables = [str(x).strip().lower() for x in (state.get("codegen_tables_used") or []) if str(x).strip()]
    candidates = [str(x).strip().lower() for x in (state.get("codegen_candidate_tables") or []) if str(x).strip()]
    required_slots = [str(x).strip() for x in (decision.get("required_slots") or []) if str(x).strip()]
    if not required_slots:
        tr = state.get("time_range") if isinstance(state.get("time_range"), dict) else {}
        if tr.get("from_date") and tr.get("to_date"):
            required_slots = ["from_date", "to_date"]
    safe_plan = {
        "goal_vi": str(plan.get("goal_vi") or "")[:400],
        "primary_tables": [str(x).strip().lower() for x in (plan.get("primary_tables") or []) if str(x).strip()][:8],
        "optional_tables": [str(x).strip().lower() for x in (plan.get("optional_tables") or []) if str(x).strip()][:8],
        "grain_vi": str(plan.get("grain_vi") or "")[:300],
        "time_binding_vi": str(plan.get("time_binding_vi") or "")[:300],
        "metric_plan_vi": [str(x).strip() for x in (plan.get("metric_plan_vi") or []) if str(x).strip()][:10],
        "join_hints_vi": [str(x).strip() for x in (plan.get("join_hints_vi") or []) if str(x).strip()][:8],
        "filter_hints_vi": [str(x).strip() for x in (plan.get("filter_hints_vi") or []) if str(x).strip()][:8],
        "risk_notes_vi": [str(x).strip() for x in (plan.get("risk_notes_vi") or []) if str(x).strip()][:6],
        "must_avoid_vi": [str(x).strip() for x in (plan.get("must_avoid_vi") or []) if str(x).strip()][:10],
        "logical_steps_vi": [str(x).strip() for x in (plan.get("logical_steps_vi") or []) if str(x).strip()][:12],
    }
    key_payload = "|".join(
        [
            str(state.get("intent") or ""),
            str(frame.get("domain") or ""),
            str(frame.get("task_type") or ""),
            ",".join(tables),
            sql_hash,
        ]
    )
    return {
        "candidate_type": "sql_writer_codegen",
        "scenario_key": "sqlwriter:" + hashlib.sha1(key_payload.encode("utf-8")).hexdigest()[:16],
        "intent": state.get("intent"),
        "domain": frame.get("domain"),
        "task_type": frame.get("task_type"),
        "metric_ids": list(frame.get("metric_ids") or decision.get("selected_metric_ids") or [])[:8],
        "required_slots": required_slots[:8],
        "report_spec": decision.get("report_spec") if isinstance(decision.get("report_spec"), dict) else {},
        "dataset_candidates": candidates[:10],
        "tables_used": tables[:10],
        "sql_hash": sql_hash,
        "sql_plan": safe_plan,
        "reviewer_risk": state.get("codegen_reviewer_risk"),
        "trial_passed": True,
        "plan_goal_vi": str(plan.get("goal_vi") or "")[:400],
        "example_questions": [question] if question else [],
        "permission_profile": {
            "include_fallback_tables": any(x.startswith(("cdc.", "fern.", "analytics.fct_")) for x in candidates),
            "max_tables": max(6, min(len(candidates) or 6, 16)),
        },
        "promotion_policy": "stage_only_require_review_or_golden_before_runtime",
    }


def build_learning_event(state: GraphState) -> dict[str, Any]:
    auth = state["auth"]
    norm = state.get("normalized_question") or ""
    norm_safe = _truncate(_redact_pii(norm), 400)
    digest = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    sql = state.get("corrected_sql") or state.get("final_sql") or ""

    sql_hash = _hash_sql(sql) if sql else ""
    return {
        "event_id": str(uuid.uuid4()),
        "event_type": "ai_query_success_candidate",
        "schema_version": 1,
        "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "correlation_id": auth.correlation_id,
        "user_id": auth.user_id,
        "intent": state.get("intent"),
        "template_key": state.get("template_key"),
        "generation_mode": "codegen"
        if state.get("executed_sql_source") == "codegen"
        else "template",
        "sql_source": state.get("executed_sql_source") or state.get("sql_source") or ("template" if sql else None),
        "sql_hash": sql_hash,
        "response_kind": state.get("response_kind"),
        "normalized_question_preview": norm_safe,
        "normalized_question_sha256": digest,
        "row_count": len(state.get("raw_result") or []),
        "outcome": graph_outcome(state),
        "scenario_candidate": build_scenario_candidate_from_state(state),
        "sql_writer_candidate": _sql_writer_candidate_from_state(state, sql_hash=sql_hash),
    }


async def emit_learning_candidate(state: GraphState) -> None:
    """Emit a minimal, privacy-conscious record for offline promotion jobs (staging topic)."""
    s = get_settings()
    if not s.learning_staging_emit_enabled:
        return
    if graph_outcome(state) != "success":
        return
    intent = state.get("intent") or ""
    if intent in ("greeting", "thanks", "hr_staff"):
        return
    src = state.get("executed_sql_source") or state.get("sql_source")
    if not state.get("template_key") and src != "codegen":
        return
    if state.get("skip_answer_formatter_llm"):
        return

    await publish_json(s.kafka_learning_topic, build_learning_event(state))
