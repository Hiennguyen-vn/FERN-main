"""Create a lightweight chart/table spec from executed rows.

V1 does not render images server-side; it returns a safe spec the client can
display or use later for chart rendering.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.graph.nodes.contextualizer import effective_question
from app.graph.state import GraphState


_METRIC_LABELS = {
    "net_revenue": "doanh thu ròng",
    "gross_revenue": "doanh thu gộp",
    "revenue": "doanh thu",
    "txn_count": "số giao dịch",
    "qty": "số lượng",
    "total_discount": "giảm giá",
    "avg_basket_size": "giá trị đơn hàng trung bình",
    "operating_profit": "lợi nhuận vận hành",
    "operating_margin": "biên lợi nhuận",
}


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _first_existing(keys: list[str], candidates: tuple[str, ...]) -> str | None:
    key_set = set(keys)
    return next((c for c in candidates if c in key_set), None)


def _pick_metric_column(state: GraphState, keys: list[str], rows: list[dict[str, Any]], x: str | None) -> str | None:
    q = _fold(effective_question(state) or state.get("normalized_question") or "")

    if re.search(r"\b(giao dich|don hang|transaction|txn|orders?)\b", q):
        chosen = _first_existing(keys, ("txn_count", "order_count"))
        if chosen:
            return chosen
    if re.search(r"\b(giam gia|discount)\b", q):
        chosen = _first_existing(keys, ("total_discount", "discount_amount"))
        if chosen:
            return chosen
    if re.search(r"\b(aov|basket|trung binh)\b", q):
        chosen = _first_existing(keys, ("avg_basket_size",))
        if chosen:
            return chosen
    if re.search(r"\b(gop|gross|subtotal)\b", q):
        chosen = _first_existing(keys, ("gross_revenue",))
        if chosen:
            return chosen

    # FERN semantic policy maps plain "doanh thu/revenue/sales/gmv" to net_revenue.
    if re.search(r"\b(doanh thu|doanh so|revenue|sales|gmv|rong|thuan|net)\b", q):
        chosen = _first_existing(keys, ("net_revenue", "revenue", "gross_revenue"))
        if chosen:
            return chosen

    for preferred in (
        "net_revenue",
        "revenue",
        "gross_revenue",
        "operating_profit",
        "qty",
        "txn_count",
        "avg_basket_size",
    ):
        if preferred in keys:
            return preferred

    if rows:
        return next(
            (
                k
                for k in keys
                if k != x and not k.lower().endswith("_id") and isinstance(rows[0].get(k), (int, float))
            ),
            None,
        )
    return None


def _pick_columns(state: GraphState, rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    if not rows:
        return None, None
    keys = list(rows[0].keys())
    x = next((k for k in keys if "date" in k.lower() or k.lower() in {"outlet_name", "product_name", "payment_method"}), None)
    y = _pick_metric_column(state, keys, rows, x)
    return x, y


def visualizer(state: GraphState) -> GraphState:
    rows = state.get("raw_result") or []
    x, y = _pick_columns(state, rows)
    if not rows or not x or not y:
        spec = {
            "type": "table",
            "title": "Bảng dữ liệu",
            "reason": "Không đủ cột phân loại + số để gợi ý chart.",
        }
    else:
        chart_type = "line" if "date" in x.lower() else "bar"
        spec = {
            "type": chart_type,
            "title": f"{_METRIC_LABELS.get(y, y)} theo {x}",
            "x": x,
            "y": y,
            "metric_label": _METRIC_LABELS.get(y, y),
            "row_count": len(rows),
        }
    state["chart_spec"] = spec
    state.setdefault("trace", []).append({"node": "visualizer", "outcome": spec.get("type")})
    return state
