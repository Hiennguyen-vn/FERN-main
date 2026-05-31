"""Markdown tables and Chart.js-oriented specs derived from result rows."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app.graph.state import GraphState

_TIME_COL_HINTS = frozenset(
    {
        "week_start",
        "business_date",
        "sale_date",
        "order_date",
        "txn_date",
        "date",
        "dt",
        "day",
        "month_start",
        "period",
    }
)


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return f"{value:.6g}".rstrip("0").rstrip(".") if "." in f"{value}" else str(int(value))
    if isinstance(value, Decimal):
        return str(float(value))
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return "<binary>"
    return str(value)


def _collect_columns(rows: list[dict[str, Any]], max_cols: int) -> list[str]:
    cols: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            k = str(key)
            if k not in seen:
                seen.add(k)
                cols.append(k)
            if len(cols) >= max_cols:
                return cols
    return cols


def _markdown_table(rows: list[dict[str, Any]], *, max_rows: int, max_cols: int) -> str:
    if not rows:
        return ""
    cols = _collect_columns(rows, max_cols)
    if not cols:
        return ""

    header = "| " + " | ".join(c.replace("|", "\\|") for c in cols) + " |"
    sep = "| " + " | ".join("---" for _ in cols) + " |"
    lines = [header, sep]
    for row in rows[:max_rows]:
        if not isinstance(row, dict):
            continue
        cells: list[str] = []
        for c in cols:
            s = _cell_str(row.get(c)).replace("|", "\\|").replace("\n", " ")
            cells.append(s)
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _is_numeric_value(v: Any) -> bool:
    if v is None or isinstance(v, bool):
        return False
    if isinstance(v, (int, float, Decimal)):
        return True
    if isinstance(v, str) and v.strip():
        try:
            float(v.replace(",", ""))
            return True
        except ValueError:
            return False
    return False


def _pick_time_column(sample: dict[str, Any], keys: list[str]) -> str | None:
    lowered = {k: k.lower() for k in keys}
    for hint in _TIME_COL_HINTS:
        for k in keys:
            if k.lower() == hint:
                return k
    for k in keys:
        kl = k.lower()
        if kl.endswith("_date") or kl.endswith("_at") or "week" in kl:
            return k
    # Heuristic: first value that looks like YYYY-MM-DD
    date_re = re.compile(r"^\d{4}-\d{2}-\d{2}")
    for k in keys:
        v = sample.get(k)
        if isinstance(v, (date, datetime)):
            return k
        if isinstance(v, str) and date_re.match(v.strip()):
            return k
    return None


def _pick_metric_column(sample: dict[str, Any], keys: list[str], time_key: str | None) -> str | None:
    candidates: list[str] = []
    for k in keys:
        if time_key and k == time_key:
            continue
        if _is_numeric_value(sample.get(k)):
            candidates.append(k)
    if not candidates:
        return None
    priority = ("net_revenue", "gross_revenue", "revenue", "sales", "amount", "total", "txn_count", "count")
    lowered = {c: c.lower() for c in candidates}
    for p in priority:
        for c in candidates:
            if p in lowered[c]:
                return c
    return candidates[0]


def _infer_chart_spec(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(rows) < 2:
        return None
    sample = rows[0]
    if not isinstance(sample, dict):
        return None
    keys = [str(k) for k in sample.keys()]
    tcol = _pick_time_column(sample, keys)
    mcol = _pick_metric_column(sample, keys, tcol)
    if not tcol or not mcol:
        return None

    labels: list[str] = []
    data: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        labels.append(_cell_str(row.get(tcol)))
        raw = row.get(mcol)
        if isinstance(raw, Decimal):
            data.append(float(raw))
        elif isinstance(raw, (int, float)):
            data.append(float(raw))
        elif isinstance(raw, str):
            try:
                data.append(float(raw.replace(",", "")))
            except ValueError:
                data.append(0.0)
        else:
            data.append(0.0)

    return {
        "library": "chart.js",
        "type": "line",
        "data": {
            "labels": labels,
            "datasets": [{"label": mcol, "data": data, "tension": 0.2, "fill": False}],
        },
        "options": {"responsive": True, "plugins": {"legend": {"display": True}}},
    }


def build_presentation_bundle(
    state: GraphState,
    *,
    max_table_rows: int = 12,
    max_table_columns: int = 10,
) -> dict[str, Any]:
    """Build markdown preview table + optional chart spec from ``raw_result``."""
    if state.get("social_kind"):
        return {}
    rk = state.get("response_kind")
    if rk in {"clarification", "unsupported"}:
        return {}

    rows = state.get("raw_result") or []
    if not isinstance(rows, list) or not rows:
        return {}

    md = _markdown_table(rows, max_rows=max_table_rows, max_cols=max_table_columns)
    spec: dict[str, Any] | None = None
    if not state.get("chart_spec") and len(rows) >= 2:
        spec = _infer_chart_spec(rows)

    full_count = len(rows)
    out: dict[str, Any] = {
        "markdown_table": md,
        "table_row_cap": max_table_rows,
        "table_column_cap": max_table_columns,
        "table_truncated": full_count > max_table_rows,
        "full_row_count": full_count,
    }
    template_key = str(state.get("template_key") or "")
    lookup_output = str(state.get("intent") or "") == "lookup" or template_key in {
        "T31_outlet_directory",
        "T37_ai_sales_daily_outlets",
    }
    if spec and not lookup_output:
        out["chart_spec"] = spec
    return out
