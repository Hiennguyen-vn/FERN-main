"""Structured session digest for follow-up continuity and UI timeline views."""

from __future__ import annotations

from typing import Any

from app.graph.state import GraphState


def build_session_digest(state: GraphState, *, max_turns: int = 8) -> dict[str, Any]:
    """Summarise recent turns + current-resolve signals for clients (no LLM)."""
    turns = list(state.get("conversation_turns") or [])
    slice_turns = turns[-max(1, max_turns) :] if turns else []

    timeline: list[str] = []
    for t in slice_turns:
        role = str(t.get("role") or "").strip().lower()
        content = str(t.get("content") or "").strip()
        if not content:
            continue
        one_line = content.split("\n", 1)[0].strip()
        if len(one_line) > 160:
            one_line = one_line[:157] + "…"
        label = "Bạn" if role == "user" else "Trợ lý"
        timeline.append(f"- **{label}**: {one_line}")

    qf = state.get("question_frame") or {}
    if not isinstance(qf, dict):
        qf = {}
    eff = str(
        qf.get("effective_question")
        or state.get("contextualized_question")
        or state.get("normalized_question")
        or state.get("raw_question")
        or ""
    ).strip()

    raw_rows = state.get("raw_result") or []
    row_count = len(raw_rows) if isinstance(raw_rows, list) else 0

    signals: dict[str, Any] = {}
    if eff:
        signals["effective_question"] = eff[:800]
    intent = state.get("intent")
    if intent:
        signals["intent"] = intent
    tk = state.get("template_key")
    if tk:
        signals["template_key"] = tk
    tr = state.get("time_range")
    if isinstance(tr, dict) and tr:
        signals["time_range"] = tr
    if row_count:
        signals["row_count"] = row_count

    intent_summary_vi = ""
    if eff:
        intent_summary_vi = eff[:360] if len(eff) > 360 else eff
    elif timeline:
        intent_summary_vi = "Câu hỏi tiếp nối — xem các lượt gần nhất trong timeline."
    else:
        intent_summary_vi = ""

    if not intent_summary_vi and not timeline and not signals:
        return {}

    return {
        "intent_summary_vi": intent_summary_vi,
        "timeline_markdown": "\n".join(timeline) if timeline else "",
        "signals": signals,
    }
