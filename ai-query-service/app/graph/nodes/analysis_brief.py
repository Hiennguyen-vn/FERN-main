"""Build a grounded analysis brief from query results.

This node is intentionally deterministic. It gives downstream formatter and
follow-up suggestions a structured "analyst notes" layer derived only from
raw_result/state, so they do not infer context from brittle canned strings.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from app.graph.nodes.data_coverage import ensure_data_source_context
from app.graph.question_frame import question_text
from app.graph.state import GraphState


_MONEY_KEYS = {"revenue", "net_revenue", "gross_revenue", "line_total", "operating_profit", "cogs", "payroll_cost"}
_COUNT_KEYS = {"qty", "txn_count", "transaction_count", "sale_count", "qty_on_hand"}


def _num(value: object) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _fmt_number(value: Decimal) -> str:
    if value == value.to_integral_value():
        return f"{int(value):,}".replace(",", ".")
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_vnd(value: Decimal) -> str:
    return f"{int(value):,}".replace(",", ".") + " đ"


def _label(row: dict[str, Any]) -> str:
    for key in ("product_name", "outlet_name", "category_name", "payment_method", "item_name", "name"):
        value = str(row.get(key) or "").strip()
        if value:
            return value
    for key in ("product_id", "outlet_id", "category_code", "item_id"):
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return "dòng dữ liệu"


def _subject_type(state: GraphState) -> str:
    template_key = str(state.get("template_key") or "")
    question = str(state.get("normalized_question") or state.get("raw_question") or "").lower()
    if template_key in {"T04_top_products", "T18_product_rank_by_outlet"} or "bán chạy" in question or "ban chay" in question:
        return "top_selling_products"
    if template_key == "T19_slow_moving_products" or "bán chậm" in question or "ban cham" in question or "slow" in question:
        return "slow_moving_products"
    if template_key in {"T11_inventory_current_stock", "T12_inventory_low_stock", "T15_inventory_reorder_alerts"}:
        return "inventory_snapshot"
    if template_key in {"T22_outlet_rank", "T02_revenue_by_outlet"}:
        return "outlet_performance"
    if str(state.get("intent") or "") == "product_mix":
        return "product_mix"
    return str(state.get("intent") or "analysis")


def _metric_totals(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    keys: list[str] = []
    for row in rows:
        for key, value in row.items():
            if key in keys:
                continue
            if key in _MONEY_KEYS or key in _COUNT_KEYS:
                if isinstance(value, (int, float, Decimal)) or str(value or "").replace(".", "", 1).isdigit():
                    keys.append(key)
    out: list[dict[str, Any]] = []
    for key in keys[:6]:
        total = sum((_num(row.get(key)) for row in rows), Decimal("0"))
        unit = "VND" if key in _MONEY_KEYS else "count"
        out.append(
            {
                "metric": key,
                "value": float(total) if total != total.to_integral_value() else int(total),
                "unit": unit,
                "text": f"{key}: {_fmt_vnd(total) if unit == 'VND' else _fmt_number(total)}",
            }
        )
    return out


def _top_product_findings(rows: list[dict[str, Any]], *, slow: bool) -> list[dict[str, Any]]:
    if not rows:
        return []
    qty_ranked = sorted(rows, key=lambda r: (_num(r.get("qty")), _num(r.get("revenue"))), reverse=not slow)
    rev_ranked = sorted(rows, key=lambda r: _num(r.get("revenue")), reverse=True)
    lead_qty = qty_ranked[0]
    lead_rev = rev_ranked[0]
    qty_label = _label(lead_qty)
    rev_label = _label(lead_rev)
    if slow:
        return [
            {
                "claim": f"{qty_label} là sản phẩm có lượng bán thấp nhất trong kết quả.",
                "evidence": [f"{qty_label}: {_fmt_number(_num(lead_qty.get('qty')))} đơn vị"],
            }
        ]

    findings = [
        {
            "claim": f"{qty_label} dẫn đầu theo số lượng bán trong kết quả.",
            "evidence": [
                f"{qty_label}: {_fmt_number(_num(lead_qty.get('qty')))} đơn vị",
                f"Doanh thu: {_fmt_vnd(_num(lead_qty.get('revenue')))}",
            ],
        }
    ]
    if rev_label != qty_label:
        findings.append(
            {
                "claim": f"{rev_label} tạo doanh thu cao nhất trong nhóm kết quả, dù không nhất thiết đứng đầu theo số lượng.",
                "evidence": [f"{rev_label}: {_fmt_vnd(_num(lead_rev.get('revenue')))}"],
            }
        )
    return findings


def _outlet_findings(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    metric = "net_revenue" if any("net_revenue" in row for row in rows) else "revenue"
    ranked = sorted(rows, key=lambda r: _num(r.get(metric)), reverse=True)
    top = ranked[0]
    bottom = ranked[-1]
    return [
        {
            "claim": f"{_label(top)} đang dẫn đầu theo {metric}.",
            "evidence": [f"{_label(top)}: {_fmt_vnd(_num(top.get(metric)))}"],
        },
        {
            "claim": f"{_label(bottom)} là outlet thấp nhất trong kết quả.",
            "evidence": [f"{_label(bottom)}: {_fmt_vnd(_num(bottom.get(metric)))}"],
        },
    ]


def _inventory_findings(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    ranked = sorted(rows, key=lambda r: _num(r.get("qty_on_hand")))
    low = ranked[0]
    high = ranked[-1]
    negative = sum(1 for row in rows if _num(row.get("qty_on_hand")) < 0)
    findings = [
        {
            "claim": f"{_label(low)} có tồn kho thấp nhất trong kết quả.",
            "evidence": [f"{_label(low)}: {_fmt_number(_num(low.get('qty_on_hand')))}"],
        },
        {
            "claim": f"{_label(high)} có tồn kho cao nhất trong kết quả.",
            "evidence": [f"{_label(high)}: {_fmt_number(_num(high.get('qty_on_hand')))}"],
        },
    ]
    if negative:
        findings.append({"claim": f"Có {negative} dòng tồn kho âm.", "evidence": [f"{negative} dòng qty_on_hand < 0"]})
    return findings


def _findings_for(state: GraphState, rows: list[dict[str, Any]], subject: str) -> list[dict[str, Any]]:
    if subject == "top_selling_products":
        return _top_product_findings(rows, slow=False)
    if subject == "slow_moving_products":
        return _top_product_findings(rows, slow=True)
    if subject == "outlet_performance":
        return _outlet_findings(rows)
    if subject == "inventory_snapshot":
        return _inventory_findings(rows)
    return []


def analysis_brief(state: GraphState) -> GraphState:
    rows = state.get("raw_result") or []
    if state.get("response_kind") in {"clarification", "unsupported"} or not rows:
        return state

    source_ctx = ensure_data_source_context(state) or {}
    subject = _subject_type(state)
    brief = {
        "question": question_text(state),
        "intent": state.get("intent"),
        "template_key": state.get("template_key"),
        "subject": {
            "type": subject,
            "entities": [_label(row) for row in rows[:10]],
        },
        "row_count": len(rows),
        "time_range": state.get("time_range") or {},
        "data_source": {
            "primary_dataset": source_ctx.get("primary_dataset"),
            "actual_data_range": source_ctx.get("actual_data_range") or {},
            "coverage_status": source_ctx.get("coverage_status"),
            "caveats": source_ctx.get("caveats") or [],
        },
        "scope": {
            "allowed_outlet_count": len(state.get("allowed_outlet_ids") or []),
        },
        "key_numbers": _metric_totals(rows),
        "findings": _findings_for(state, rows, subject),
        "guardrails": {
            "avoid_terms": ["bán chậm", "slow-moving"] if subject == "top_selling_products" else [],
            "must_preserve_subject": True,
        },
    }
    state["analysis_brief"] = brief
    state.setdefault("trace", []).append(
        {"node": "analysis_brief", "subject": subject, "findings": len(brief["findings"])}
    )
    return state
