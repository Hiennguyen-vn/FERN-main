from __future__ import annotations

from typing import Any

from app.graph.state import GraphState


def build_question_frame(
    state: GraphState,
    *,
    effective_question: str,
    current_question: str,
    intent: str,
    time_range: dict[str, str],
    time_context: dict[str, Any],
    raw_entities: dict[str, list[str]],
) -> dict[str, Any]:
    """Stable downstream contract after contextualizer/supervisor."""
    frame = {
        "effective_question": effective_question,
        "current_question": current_question,
        "intent": intent,
        "agent_route": state.get("agent_route"),
        "time_range": {
            "from_date": str(time_range.get("from_date") or ""),
            "to_date": str(time_range.get("to_date") or ""),
        },
        "time_source": time_context.get("source"),
        "is_time_followup": bool(time_context.get("is_time_followup")),
        "entities": raw_entities,
        "followup_source": state.get("contextualization_source"),
    }
    state["question_frame"] = frame
    return frame


def question_text(state: GraphState) -> str:
    frame = state.get("question_frame")
    if isinstance(frame, dict):
        text = str(frame.get("effective_question") or "").strip()
        if text:
            return text
    return str(
        (state.get("contextualized_question") or "").strip()
        or (state.get("normalized_question") or state.get("raw_question") or "").strip()
    )


def question_time_range(state: GraphState) -> dict[str, str]:
    frame = state.get("question_frame")
    if isinstance(frame, dict):
        tr = frame.get("time_range")
        if isinstance(tr, dict) and tr.get("from_date") and tr.get("to_date"):
            return {"from_date": str(tr["from_date"]), "to_date": str(tr["to_date"])}
    tr = state.get("time_range") or {}
    return {"from_date": str(tr.get("from_date") or ""), "to_date": str(tr.get("to_date") or "")}
