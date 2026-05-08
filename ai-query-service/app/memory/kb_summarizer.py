"""Distil a finished session into a knowledge nugget for the long-term store.

Pure Python — no LLM hop. The summarizer emits a single concise Vietnamese
sentence (or two) that captures *what was learned* (intent, template,
time range, headline metric). The retriever later embeds the user's new
question and surfaces nuggets above a similarity threshold.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from app.config import get_settings
from app.graph.state import GraphState


_INTENT_LABEL_VI: dict[str, str] = {
    "revenue": "doanh thu",
    "outlet_compare": "so sánh cửa hàng",
    "product_mix": "cơ cấu sản phẩm",
    "inventory": "tồn kho",
    "pnl": "lợi nhuận / chi phí",
    "trend": "xu hướng",
    "hr_staff": "nhân sự",
    "export_request": "xuất file dữ liệu",
    "pos": "POS / giao dịch",
}


@dataclass
class _DraftNugget:
    topic: str
    summary_vi: str
    intent: str | None
    template_key: str | None
    time_range_from: date | None
    time_range_to: date | None
    metadata: dict[str, Any]


def _short_question(state: GraphState, *, cap: int = 220) -> str:
    qf = state.get("question_frame") or {}
    eff = ""
    if isinstance(qf, dict):
        eff = str(qf.get("effective_question") or "").strip()
    if not eff:
        eff = str(state.get("contextualized_question") or state.get("normalized_question") or state.get("raw_question") or "").strip()
    eff = eff.split("\n", 1)[0].strip()
    if len(eff) > cap:
        eff = eff[: cap - 1] + "…"
    return eff


def _parse_iso_date(s: Any) -> date | None:
    if not s:
        return None
    if isinstance(s, date):
        return s
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def _intent_label_vi(intent: str | None) -> str:
    if not intent:
        return "câu hỏi"
    return _INTENT_LABEL_VI.get(intent.strip().lower(), intent)


def _headline_metric(state: GraphState) -> str:
    rows = state.get("raw_result") or []
    if not isinstance(rows, list) or not rows:
        return ""

    # Common revenue/inventory shapes: pick the first numeric column on row 0.
    sample = rows[0] if isinstance(rows[0], dict) else {}
    for k in ("net_revenue", "gross_revenue", "revenue", "total", "amount", "txn_count", "qty"):
        if k in sample and isinstance(sample[k], (int, float)) and sample[k]:
            return f"{k}={sample[k]}"
    return f"rows={len(rows)}"


def build_nugget_from_state(state: GraphState) -> _DraftNugget | None:
    """Return a draft nugget when the turn yielded actionable signal, else None."""
    s = get_settings()

    rk = state.get("response_kind")
    if rk and rk != "answer":
        return None
    if state.get("execution_error"):
        return None
    if state.get("social_kind"):
        return None

    rows = state.get("raw_result") or []
    if not rows:
        return None

    eff = _short_question(state)
    if not eff:
        return None

    intent_raw = state.get("intent")
    intent = intent_raw if isinstance(intent_raw, str) else None
    template_key = state.get("template_key") if isinstance(state.get("template_key"), str) else None
    tr = state.get("time_range") or {}
    if not isinstance(tr, dict):
        tr = {}

    range_label = ""
    from_d = _parse_iso_date(tr.get("from_date"))
    to_d = _parse_iso_date(tr.get("to_date"))
    if from_d and to_d:
        if from_d == to_d:
            range_label = f" (ngày {from_d.isoformat()})"
        else:
            range_label = f" ({from_d.isoformat()} → {to_d.isoformat()})"

    headline = _headline_metric(state)
    summary_vi = (
        f"Đã trả lời câu hỏi {_intent_label_vi(intent)}: \"{eff}\"{range_label}."
    )
    if headline:
        summary_vi += f" Tóm tắt số liệu: {headline}."

    cap = max(120, int(s.agent_kb_max_summary_chars))
    summary_vi = summary_vi[:cap]

    topic = (intent or "general").strip().lower() + " :: " + eff
    topic = topic[:280]

    metadata: dict[str, Any] = {
        "row_count": len(rows),
        "audience": state.get("audience"),
    }
    ds = state.get("data_source_context")
    if isinstance(ds, dict):
        ds_name = ds.get("primary_dataset") or ds.get("dataset")
        if ds_name:
            metadata["primary_dataset"] = str(ds_name)
    metadata = {k: v for k, v in metadata.items() if v not in (None, "", [])}

    return _DraftNugget(
        topic=topic,
        summary_vi=summary_vi,
        intent=intent,
        template_key=template_key,
        time_range_from=from_d,
        time_range_to=to_d,
        metadata=metadata,
    )
