"""Deterministic node: build CSV export artifact when policy says yes."""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.exports import build_csv_artifact, build_json_artifact, should_generate_export
from app.graph.nodes.data_coverage import ensure_data_source_context, executed_datasets_for_state
from app.graph.state import GraphState

logger = logging.getLogger(__name__)


def _safe_correlation_id(state: GraphState) -> str:
    auth = state.get("auth")
    if auth is not None and getattr(auth, "correlation_id", None):
        return str(auth.correlation_id)
    return ""


def _safe_user_id(state: GraphState) -> int:
    auth = state.get("auth")
    if auth is not None and getattr(auth, "user_id", None) is not None:
        try:
            return int(auth.user_id)
        except (TypeError, ValueError):
            return 0
    return 0


def export_builder(state: GraphState) -> GraphState:
    s = get_settings()
    if not s.exports_enabled:
        return state

    rows = state.get("raw_result") or []
    question_frame = state.get("question_frame") or {}
    question = str(question_frame.get("effective_question") or state.get("normalized_question") or state.get("raw_question") or "")
    intent = state.get("intent")
    template_key = state.get("template_key")
    response_kind = state.get("response_kind")

    decide, reason = should_generate_export(
        intent=intent,
        response_kind=response_kind,
        row_count=len(rows),
        question=question,
        template_key=template_key,
    )
    state.setdefault("trace", []).append(
        {"node": "export_builder", "decide": decide, "reason": reason, "row_count": len(rows)}
    )
    if not decide:
        return state

    allowed_outlets = state.get("allowed_outlet_ids") or []
    allowed_count = len(allowed_outlets) if isinstance(allowed_outlets, list) else 0
    tables_used = executed_datasets_for_state(state)
    data_source = ensure_data_source_context(state)

    artifact = build_csv_artifact(
        rows=rows,
        question=question,
        correlation_id=_safe_correlation_id(state),
        user_id=_safe_user_id(state),
        template_key=template_key,
        intent=intent if isinstance(intent, str) else None,
        rationale_vi=state.get("codegen_rationale_vi"),
        tables_used=tables_used,
        time_range=state.get("time_range") or {},
        allowed_outlet_count=allowed_count,
        data_source=data_source,
    )
    if artifact is None:
        return state

    artifact_dict: dict[str, Any] = {
        "artifact_id": artifact.artifact_id,
        "format": artifact.format,
        "filename": artifact.filename,
        "row_count": artifact.row_count,
        "size_bytes": artifact.size_bytes,
        "expires_at": artifact.expires_at.isoformat().replace("+00:00", "Z"),
        "sha256": artifact.sha256,
    }
    state.setdefault("exports", []).append(artifact_dict)

    json_art = build_json_artifact(
        rows=rows,
        question=question,
        correlation_id=_safe_correlation_id(state),
        user_id=_safe_user_id(state),
        template_key=template_key,
        intent=intent if isinstance(intent, str) else None,
        tables_used=tables_used,
        time_range=state.get("time_range") or {},
        allowed_outlet_count=allowed_count,
        data_source=data_source,
    )
    if json_art is not None:
        state.setdefault("exports", []).append(
            {
                "artifact_id": json_art.artifact_id,
                "format": json_art.format,
                "filename": json_art.filename,
                "row_count": json_art.row_count,
                "size_bytes": json_art.size_bytes,
                "expires_at": json_art.expires_at.isoformat().replace("+00:00", "Z"),
                "sha256": json_art.sha256,
            }
        )
    return state
