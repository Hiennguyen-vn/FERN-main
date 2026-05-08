from dataclasses import dataclass
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


SQL_DIR = Path(__file__).parent / "sql"


@dataclass(frozen=True)
class TemplateMeta:
    key: str
    required_params: tuple[str, ...]
    optional_params: tuple[str, ...]


# Source of truth — must match files in app/templates/sql/
TEMPLATES: dict[str, TemplateMeta] = {
    # Revenue (10)
    "T01_daily_revenue": TemplateMeta("T01_daily_revenue", ("from_date", "to_date"), ()),
    "T02_revenue_by_outlet": TemplateMeta("T02_revenue_by_outlet", ("from_date", "to_date"), ()),
    "T03_revenue_by_category": TemplateMeta("T03_revenue_by_category", ("from_date", "to_date"), ()),
    "T04_top_products": TemplateMeta("T04_top_products", ("from_date", "to_date"), ("limit",)),
    "T05_revenue_trend_7d": TemplateMeta("T05_revenue_trend_7d", (), ()),
    "T06_revenue_trend_30d": TemplateMeta("T06_revenue_trend_30d", (), ()),
    "T07_revenue_comparison_yoy": TemplateMeta("T07_revenue_comparison_yoy", ("from_date", "to_date"), ()),
    "T08_revenue_by_payment_method": TemplateMeta("T08_revenue_by_payment_method", ("from_date", "to_date"), ()),
    "T09_avg_basket_size": TemplateMeta("T09_avg_basket_size", ("from_date", "to_date"), ()),
    "T10_transaction_count": TemplateMeta("T10_transaction_count", ("from_date", "to_date"), ()),
    "T32_period_revenue_summary": TemplateMeta("T32_period_revenue_summary", ("from_date", "to_date"), ()),
    "T33_zero_revenue_outlets": TemplateMeta("T33_zero_revenue_outlets", ("from_date", "to_date"), ()),
    "T34_sales_detail_by_day": TemplateMeta("T34_sales_detail_by_day", ("from_date", "to_date"), ()),
    "T35_weekly_revenue_trend": TemplateMeta("T35_weekly_revenue_trend", ("from_date", "to_date"), ()),
    "T36_revenue_period_driver_bridge": TemplateMeta(
        "T36_revenue_period_driver_bridge",
        ("from_date_a", "to_date_a", "from_date_b", "to_date_b"),
        (),
    ),
    # Inventory (5)
    "T11_inventory_current_stock": TemplateMeta("T11_inventory_current_stock", (), ("limit",)),
    "T12_inventory_low_stock": TemplateMeta("T12_inventory_low_stock", (), ("threshold",)),
    "T13_inventory_movement_summary": TemplateMeta("T13_inventory_movement_summary", ("from_date", "to_date"), ()),
    "T14_inventory_consumption_rate": TemplateMeta("T14_inventory_consumption_rate", ("from_date", "to_date"), ()),
    "T15_inventory_reorder_alerts": TemplateMeta("T15_inventory_reorder_alerts", (), ()),
    # Product (5)
    "T16_product_sales_mix": TemplateMeta("T16_product_sales_mix", ("from_date", "to_date"), ()),
    "T17_category_contribution": TemplateMeta("T17_category_contribution", ("from_date", "to_date"), ()),
    "T18_product_rank_by_outlet": TemplateMeta("T18_product_rank_by_outlet", ("from_date", "to_date"), ("limit",)),
    "T19_slow_moving_products": TemplateMeta("T19_slow_moving_products", ("from_date", "to_date"), ()),
    "T20_product_discount_analysis": TemplateMeta("T20_product_discount_analysis", ("from_date", "to_date"), ()),
    # Outlet/Operations (5)
    "T21_outlet_performance": TemplateMeta("T21_outlet_performance", ("from_date", "to_date"), ()),
    "T22_outlet_rank": TemplateMeta("T22_outlet_rank", ("from_date", "to_date"), ()),
    "T23_peak_hour_analysis": TemplateMeta("T23_peak_hour_analysis", ("from_date", "to_date"), ()),
    "T28_payment_capture_analysis": TemplateMeta("T28_payment_capture_analysis", ("from_date", "to_date"), ()),
    "T30_sale_cancellation_rate": TemplateMeta("T30_sale_cancellation_rate", ("from_date", "to_date"), ()),
    # Directory / lookup (1)
    "T31_outlet_directory": TemplateMeta("T31_outlet_directory", (), ()),
    # P&L / Finance (4) — restricted
    "T24_daily_pnl_summary": TemplateMeta("T24_daily_pnl_summary", ("from_date", "to_date"), ()),
    "T25_expense_breakdown": TemplateMeta("T25_expense_breakdown", ("from_date", "to_date"), ()),
    "T26_goods_receipt_summary": TemplateMeta("T26_goods_receipt_summary", ("from_date", "to_date"), ()),
    "T27_payroll_cost_by_outlet": TemplateMeta("T27_payroll_cost_by_outlet", ("from_date", "to_date"), ()),
    # Stock Events (1)
    "T29_stock_low_events": TemplateMeta("T29_stock_low_events", ("from_date", "to_date"), ()),
}


_env: Environment | None = None


def _get_env() -> Environment:
    global _env
    if _env is None:
        _env = Environment(
            loader=FileSystemLoader(str(SQL_DIR)),
            undefined=StrictUndefined,
            autoescape=select_autoescape(disabled_extensions=("sql",), default=False),
            trim_blocks=True,
            lstrip_blocks=True,
        )
    return _env


def list_templates() -> list[str]:
    return sorted(TEMPLATES.keys())


def get_meta(key: str) -> TemplateMeta:
    if key not in TEMPLATES:
        raise KeyError(f"Unknown template: {key}")
    return TEMPLATES[key]


def render(key: str, *, outlet_ids: list[int], **params) -> str:
    """Render Jinja2 template with outlet_ids + params. outlet_ids must be list[int]."""
    if not isinstance(outlet_ids, list) or not all(isinstance(x, int) for x in outlet_ids):
        raise ValueError("outlet_ids must be list[int]")
    if not outlet_ids:
        raise ValueError("outlet_ids cannot be empty")

    meta = get_meta(key)
    missing = [p for p in meta.required_params if p not in params]
    if missing:
        raise ValueError(f"Missing required params for {key}: {missing}")

    env = _get_env()
    template = env.get_template(f"{key}.sql")
    return template.render(outlet_ids=outlet_ids, **params)


def template_exists(key: str) -> bool:
    return key in TEMPLATES and (SQL_DIR / f"{key}.sql").exists()
