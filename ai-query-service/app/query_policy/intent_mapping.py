"""Shared intent normalisation for supervisor and eval parsing."""

from __future__ import annotations

import threading

from app.runtime_catalog import get_runtime_catalog_section


_TEMPLATE_INTENTS: dict[str, str] = {
    # Revenue / sales
    "T01_daily_revenue": "revenue",
    "T35_weekly_revenue_trend": "trend",
    "T36_revenue_period_driver_bridge": "trend",
    "T05_revenue_trend_7d": "revenue",
    "T06_revenue_trend_30d": "revenue",
    "T07_revenue_comparison_yoy": "revenue",
    "T08_revenue_by_payment_method": "revenue",
    "T09_avg_basket_size": "revenue",
    "T10_transaction_count": "revenue",
    "T23_peak_hour_analysis": "revenue",
    "T28_payment_capture_analysis": "revenue",
    "T30_sale_cancellation_rate": "revenue",
    "T32_period_revenue_summary": "revenue",
    "T34_sales_detail_by_day": "revenue",
    # Outlet comparison / ranking
    "T02_revenue_by_outlet": "outlet_compare",
    "T22_outlet_rank": "outlet_compare",
    # Product/category mix
    "T03_revenue_by_category": "product_mix",
    "T04_top_products": "product_mix",
    "T16_product_sales_mix": "product_mix",
    "T17_category_contribution": "product_mix",
    "T18_product_rank_by_outlet": "product_mix",
    "T19_slow_moving_products": "product_mix",
    "T20_product_discount_analysis": "product_mix",
    # Inventory
    "T11_inventory_current_stock": "inventory",
    "T12_inventory_low_stock": "inventory",
    "T13_inventory_movement_summary": "inventory",
    "T14_inventory_consumption_rate": "inventory",
    "T15_inventory_reorder_alerts": "inventory",
    "T29_stock_low_events": "inventory",
    # Finance/P&L
    "T24_daily_pnl_summary": "pnl",
    "T25_expense_breakdown": "pnl",
    "T26_goods_receipt_summary": "pnl",
    "T27_payroll_cost_by_outlet": "pnl",
    # Lookup
    "T31_outlet_directory": "lookup",
    "T33_zero_revenue_outlets": "lookup",
    "T37_ai_sales_daily_outlets": "lookup",
}
_RUNTIME_LOCK = threading.RLock()
_RUNTIME_VERSION: int | None = None


def ensure_runtime_intent_mapping_loaded(*, force: bool = False) -> None:
    global _RUNTIME_VERSION
    with _RUNTIME_LOCK:
        version, section = get_runtime_catalog_section("intent_mapping", force=force)
        if not force and version == _RUNTIME_VERSION:
            return
        if isinstance(section, dict) and isinstance(section.get("template_intents"), dict):
            parsed = {str(k): str(v) for k, v in section["template_intents"].items()}
            if parsed:
                _TEMPLATE_INTENTS.clear()
                _TEMPLATE_INTENTS.update(parsed)
        _RUNTIME_VERSION = version


def intent_for_template(template_key: str | None) -> str | None:
    ensure_runtime_intent_mapping_loaded()
    return _TEMPLATE_INTENTS.get(template_key or "")


def intent_for_route_and_template(
    *,
    route: str | None,
    template_key: str | None,
    question: str = "",
    current_intent: str | None = None,
) -> str:
    """Return the canonical eval-facing intent for a supervisor decision."""

    route_key = (route or "").strip()
    if route_key in {"docs_question", "clarification"}:
        return "unknown"
    if route_key in {"greeting", "thanks"}:
        return route_key
    if route_key == "social":
        return current_intent if current_intent in {"greeting", "thanks"} else "greeting"
    if route_key == "hr_staff":
        return "hr_staff"
    if route_key == "export_request":
        return "export_request"
    if route_key == "visualization_request":
        q = (question or "").lower()
        if any(
            token in q
            for token in (
                "sản phẩm",
                "san pham",
                "product",
                "danh mục",
                "danh muc",
                "category",
                "nhóm món",
                "nhom mon",
            )
        ):
            return "product_mix"
        template_intent = intent_for_template(template_key)
        if template_intent == "product_mix" and not any(token in q for token in ("doanh thu", "revenue", "sales")):
            return "product_mix"
        return "trend"

    return intent_for_template(template_key) or current_intent or "unknown"


__all__ = ["intent_for_template", "intent_for_route_and_template"]
