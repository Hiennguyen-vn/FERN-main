"""AI-facing query policy.

The same contract feeds prompt metadata, AST allow-listing, RBAC rewrite, and
offline OpenSearch seeding. Keep this module free of database/client imports.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
import threading
import unicodedata
from typing import Any

from app.runtime_catalog import get_runtime_catalog_section


@dataclass(frozen=True)
class TablePolicy:
    full_name: str
    outlet_column: str | None
    time_column: str | None
    grain: str
    metrics: tuple[str, ...] = ()
    role_group: str | None = None
    lookup_only: bool = False
    description_vi: str = ""


@dataclass(frozen=True)
class QueryDomain:
    """Curated AI-facing data mart/domain pack.

    A production DB can have hundreds of operational tables. LLM agents should
    not choose across that raw surface. They first choose a small semantic
    domain, then a preferred flattened table/view; fallback facts are exposed
    only to GenSQL/planner paths that explicitly need them.
    """

    key: str
    intents: tuple[str, ...]
    description_vi: str
    preferred_tables: tuple[str, ...]
    lookup_tables: tuple[str, ...] = ()
    fallback_tables: tuple[str, ...] = ()
    verified_templates: tuple[str, ...] = ()
    notes_vi: tuple[str, ...] = ()


@dataclass(frozen=True)
class DataSourcePolicy:
    """Business/time contract for an AI-facing data source.

    TablePolicy answers "is this table allowed and how is outlet RBAC applied?".
    DataSourcePolicy answers "what business clock does this source represent and
    how should coverage caveats be explained?". Keep these responsibilities
    separate so answer/planner code does not infer semantics from a column name.
    """

    dataset: str
    domain: str
    source_system: str
    storage: str
    preferred_for_metrics: tuple[str, ...]
    time_column: str | None
    time_semantics_vi: str
    available_range_strategy: str
    freshness_label_vi: str
    coverage_severity_policy: str = "warn_partial"
    static_lane: bool = False
    external: bool = False
    coverage_enabled: bool = True


TABLE_POLICIES: dict[str, TablePolicy] = {
    # Preferred flattened metric views.
    "analytics.ai_sales_daily": TablePolicy(
        "analytics.ai_sales_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date",
        ("gross_revenue", "net_revenue", "txn_count", "avg_basket_size", "cancellation_rate"),
        description_vi="Bảng metric phẳng ưu tiên cho doanh thu, số đơn, AOV và tỷ lệ hủy theo ngày/cửa hàng.",
    ),
    "analytics.ai_product_daily": TablePolicy(
        "analytics.ai_product_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + product_id",
        ("revenue", "qty", "txn_count"),
        description_vi=(
            "Metric phẳng theo sản phẩm×ngày×outlet: revenue và **qty là tổng số lượng bán** (đơn vị POS), "
            "không phải số SKU hay số món trong catalog khi đã cộng dồn theo nhóm/ngày."
        ),
    ),
    "analytics.ai_pnl_daily": TablePolicy(
        "analytics.ai_pnl_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date",
        ("revenue", "cogs", "payroll_cost", "operating_profit", "operating_margin"),
        role_group="finance",
        description_vi="Bảng metric phẳng ưu tiên cho P&L ngày: doanh thu, giá vốn, lương, lợi nhuận, margin.",
    ),
    "analytics.ai_payment_daily": TablePolicy(
        "analytics.ai_payment_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + payment_method",
        ("revenue", "txn_count"),
        description_vi="Bảng metric phẳng ưu tiên cho doanh thu theo phương thức thanh toán.",
    ),
    "analytics.ai_sales_hourly": TablePolicy(
        "analytics.ai_sales_hourly",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + hour_of_day",
        ("net_revenue", "txn_count", "avg_ticket"),
        description_vi="Bảng metric theo giờ cho peak-hour/anomaly doanh thu; giờ lấy từ thời điểm tạo sale header.",
    ),
    "analytics.ai_finance_daily": TablePolicy(
        "analytics.ai_finance_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date",
        (
            "revenue",
            "actual_or_theoretical_cogs",
            "goods_receipt_cost",
            "payroll_cost",
            "expense_amount",
            "gross_profit",
            "operating_profit",
            "margin",
        ),
        role_group="finance",
        description_vi=(
            "Finance mart chuẩn cho P&L AI: goods_receipt_cost là chi phí nhập/nhận hàng, "
            "không mặc định là COGS nếu chưa có consumption/recipe cost."
        ),
    ),
    "analytics.ai_inventory_on_hand_daily": TablePolicy(
        "analytics.ai_inventory_on_hand_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + item_id",
        ("qty_on_hand", "movement_qty"),
        description_vi=(
            "Tồn kho on-hand theo ngày được tính bằng running balance từ inventory transactions; "
            "khác với movement trong ngày."
        ),
    ),
    "analytics.ai_inventory_movement_daily": TablePolicy(
        "analytics.ai_inventory_movement_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + item_id + movement_type",
        ("qty_change", "movement_count"),
        description_vi="Biến động kho theo ngày/item/loại giao dịch; không dùng như tồn kho hiện tại.",
    ),
    # Existing analytics/template tables.
    "analytics.fct_sales_daily": TablePolicy(
        "analytics.fct_sales_daily",
        "outlet_id",
        "business_date",
        "outlet_id + business_date",
        ("gross_revenue", "net_revenue", "txn_count"),
        description_vi="Fallback doanh thu ngày theo cửa hàng.",
    ),
    "analytics.fct_sales_by_category": TablePolicy(
        "analytics.fct_sales_by_category",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + category_code",
        ("revenue", "qty"),
        description_vi="Fallback doanh thu theo danh mục.",
    ),
    "analytics.fct_sales_by_product": TablePolicy(
        "analytics.fct_sales_by_product",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + product_id",
        ("revenue", "qty", "txn_count"),
        description_vi="Fallback doanh thu theo sản phẩm.",
    ),
    "analytics.fct_payment_split": TablePolicy(
        "analytics.fct_payment_split",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + payment_method",
        ("revenue", "txn_count"),
        description_vi="Fallback payment split.",
    ),
    "analytics.fct_daily_pnl": TablePolicy(
        "analytics.fct_daily_pnl",
        "outlet_id",
        "business_date",
        "outlet_id + business_date",
        ("revenue", "cogs", "payroll_cost", "operating_profit"),
        role_group="finance",
        description_vi="Fallback P&L ngày.",
    ),
    "analytics.fct_inventory_snapshot": TablePolicy(
        "analytics.fct_inventory_snapshot",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + item_id",
        ("qty_on_hand",),
        description_vi=(
            "Legacy inventory snapshot view; không dùng làm nguồn current stock ưu tiên "
            "vì lịch sử cũ có thể là movement theo ngày."
        ),
    ),
    # CDC/event tables still allowed for templates and special cases.
    "cdc.fact_sale": TablePolicy(
        "cdc.fact_sale",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + sale_id + product_id",
        ("line_total", "unit_price", "qty", "discount_amount", "tax_amount"),
        description_vi=(
            "Sale-line CDC chi tiết; dùng cho cấp giá/price band, tỷ lệ giảm giá, "
            "unit price và các phép tính line_total không có trong metric daily."
        ),
    ),
    "cdc.sale_record": TablePolicy("cdc.sale_record", "outlet_id", "business_date", "outlet_id + sale_id"),
    "cdc.payment": TablePolicy(
        "cdc.payment",
        "outlet_id",
        "business_date",
        "outlet_id + sale_id + payment_method",
        ("revenue", "txn_count", "payment_state"),
        description_vi="Payment CDC raw/fallback; ưu tiên analytics.ai_payment_daily khi đủ.",
    ),
    "cdc.inventory_transaction": TablePolicy("cdc.inventory_transaction", "outlet_id", "business_date", "outlet_id + item_id + txn_time"),
    "cdc.product": TablePolicy(
        "cdc.product",
        None,
        None,
        "product_id",
        lookup_only=True,
        description_vi="Product master data cho tên/danh mục/trạng thái; catalog AI không có giá bán hiện hành.",
    ),
    "cdc.product_category": TablePolicy(
        "cdc.product_category",
        None,
        None,
        "category_code",
        lookup_only=True,
        description_vi="Product category master data; dùng để map category_code sang tên danh mục.",
    ),
    "cdc.outlet": TablePolicy("cdc.outlet", None, None, "outlet_id", lookup_only=True),
    # Legacy fern.* raw/event tables. These are still curated and scoped; do not expose arbitrary schema.
    "fern.fact_sale": TablePolicy(
        "fern.fact_sale",
        "outlet_id",
        "business_date",
        "outlet_id + business_date + sale_id + product_id",
        ("line_total", "qty", "discount_amount"),
        description_vi="Legacy raw sale fact; dùng khi cần sale/product/payment detail không có trong metric view.",
    ),
    "fern.fact_inventory_movement": TablePolicy(
        "fern.fact_inventory_movement",
        "outlet_id",
        "business_date",
        "outlet_id + item_id + txn_time",
        ("qty_change",),
        description_vi="Legacy raw inventory movement fact.",
    ),
    "fern.dim_product": TablePolicy("fern.dim_product", None, None, "product_id", lookup_only=True),
    "fern.dim_outlet": TablePolicy("fern.dim_outlet", "outlet_id", None, "outlet_id", lookup_only=True),
    "fern.events_sale_completed": TablePolicy(
        "fern.events_sale_completed",
        "outletId",
        "businessDate",
        "outletId + businessDate + saleId + eventId",
        ("totalAmount",),
        description_vi="Sale-completed event stream; event-level validation/completeness checks.",
    ),
    "fern.events_stock_low": TablePolicy("fern.events_stock_low", "outletId", "detectedAt", "outletId + itemId + detectedAt"),
    "fern.events_goods_receipt_posted": TablePolicy(
        "fern.events_goods_receipt_posted",
        "outletId",
        "businessDate",
        "outletId + businessDate",
        role_group="finance",
    ),
    "fern.events_expense_created": TablePolicy(
        "fern.events_expense_created",
        "outletId",
        "createdAt",
        "outletId + createdAt",
        role_group="finance",
    ),
    "fern.events_invoice_issued": TablePolicy(
        "fern.events_invoice_issued",
        "outletId",
        "issuedAt",
        "outletId + issuedAt + invoiceId",
        role_group="finance",
    ),
    "fern.events_invoice_approved": TablePolicy(
        "fern.events_invoice_approved",
        "outletId",
        "invoiceDate",
        "outletId + invoiceDate + supplierInvoiceId",
        ("totalAmount",),
        role_group="finance",
    ),
    "fern.events_payment_captured": TablePolicy("fern.events_payment_captured", "outletId", "businessDate", "outletId + businessDate"),
    "fern.events_payroll_approved": TablePolicy(
        "fern.events_payroll_approved",
        "outletId",
        "approvedAt",
        "outletId + approvedAt",
        role_group="finance",
    ),
}

ALLOWED_FULL_TABLES: set[str] = set(TABLE_POLICIES)
ALLOWED_SCHEMAS: set[str] = {x.split(".", 1)[0] for x in ALLOWED_FULL_TABLES}
TABLE_OUTLET_COLUMNS: dict[str, str | None] = {k: v.outlet_column for k, v in TABLE_POLICIES.items()}
LOOKUP_ONLY_TABLES: set[str] = {k for k, v in TABLE_POLICIES.items() if v.lookup_only}
TABLE_TIME_COLUMNS: dict[str, str | None] = {k: v.time_column for k, v in TABLE_POLICIES.items()}

# Columns that AI-generated SQL must not expose directly in SELECT projections.
# They can exist in source tables for operational services, but analytics
# answers should not leak contact/free-text identifiers.
TABLE_BLOCKED_SELECT_COLUMNS: dict[str, frozenset[str]] = {
    "cdc.outlet": frozenset({"address", "phone"}),
    "cdc.fact_sale": frozenset({"note"}),
    "fern.events_invoice_issued": frozenset({"invoicenumber"}),
}

# Raw/detail tables and event streams must be time-bounded in SQL Writer mode.
# This prevents expensive or semantically unbounded scans when the generator
# falls back from flattened marts to granular data.
CODEGEN_TIME_FILTER_REQUIRED_TABLES: set[str] = set(
    full
    for full, policy in TABLE_POLICIES.items()
    if policy.time_column
    and (
        full.startswith("cdc.")
        or full.startswith("fern.events_")
        or full.startswith("fern.fact_")
    )
)

# cdc.sale_record is not lookup-only, but non-aggregating bridge subqueries over it
# are allowed by sql_guard when an outer scoped fact enforces tenant isolation.
LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET: set[str] = LOOKUP_ONLY_TABLES | {"cdc.sale_record"}

_INTENT_TABLE_PRIORITY: dict[str, tuple[str, ...]] = {
    "revenue": ("analytics.ai_sales_daily", "analytics.ai_payment_daily", "analytics.fct_sales_daily"),
    "outlet_compare": ("analytics.ai_sales_daily", "analytics.fct_sales_daily", "cdc.outlet"),
    "trend": ("analytics.ai_sales_daily", "analytics.fct_sales_daily"),
    "lookup": ("cdc.outlet", "cdc.product", "cdc.product_category"),
    "inventory": ("analytics.ai_inventory_on_hand_daily", "analytics.ai_inventory_movement_daily", "cdc.inventory_transaction"),
    "product_mix": ("analytics.ai_product_daily", "analytics.fct_sales_by_product"),
    "pnl": (
        "analytics.ai_finance_daily",
        "analytics.ai_pnl_daily",
        "analytics.fct_daily_pnl",
        "fern.events_expense_created",
        "fern.events_invoice_approved",
        "fern.events_invoice_issued",
        "fern.events_goods_receipt_posted",
    ),
    "export_request": ("analytics.ai_sales_daily", "analytics.ai_product_daily", "analytics.ai_inventory_on_hand_daily"),
    "visualization_request": ("analytics.ai_sales_daily", "analytics.ai_product_daily", "analytics.ai_payment_daily"),
    "unknown": ("analytics.ai_sales_daily",),
}

QUERY_DOMAINS: dict[str, QueryDomain] = {
    "sales": QueryDomain(
        key="sales",
        intents=("revenue", "outlet_compare", "trend", "export_request", "visualization_request"),
        description_vi="Doanh thu, số giao dịch, AOV, tỷ lệ hủy theo ngày/cửa hàng.",
        preferred_tables=("analytics.ai_sales_daily",),
        lookup_tables=("cdc.outlet",),
        fallback_tables=(
            "analytics.ai_sales_hourly",
            "analytics.fct_sales_daily",
            "cdc.fact_sale",
            "cdc.sale_record",
            "fern.fact_sale",
            "fern.events_sale_completed",
        ),
        verified_templates=(
            "T01_daily_revenue",
            "T02_revenue_by_outlet",
            "T07_revenue_comparison_yoy",
            "T09_avg_basket_size",
            "T10_transaction_count",
            "T22_outlet_rank",
            "T30_sale_cancellation_rate",
            "T32_period_revenue_summary",
            "T33_zero_revenue_outlets",
            "T34_sales_detail_by_day",
            "T35_weekly_revenue_trend",
            "T36_revenue_period_driver_bridge",
            "T37_ai_sales_daily_outlets",
            "INS_SALES_DRIVER",
            "ANOM_SALES",
            "FORECAST_REVENUE",
        ),
        notes_vi=(
            "Ưu tiên analytics.ai_sales_daily; chỉ dùng CDC/raw sale khi metric view không đủ cột.",
            "Câu hỏi theo giờ/sub-day: giờ cao điểm (T23) dùng cdc.sale_record (header đơn); chi tiết dòng/giá/discount cần cdc.fact_sale.",
            "Cấp giá/price band và tỷ lệ giảm giá cần cdc.fact_sale; fern.fact_sale chỉ là legacy fallback.",
            "Không join nhiều bảng sale thô nếu câu hỏi có thể trả lời từ metric view.",
        ),
    ),
    "payment": QueryDomain(
        key="payment",
        intents=("revenue", "export_request", "visualization_request"),
        description_vi="Doanh thu/số giao dịch theo phương thức thanh toán.",
        preferred_tables=("analytics.ai_payment_daily",),
        lookup_tables=("cdc.outlet",),
        fallback_tables=("analytics.fct_payment_split", "cdc.payment", "fern.events_payment_captured"),
        verified_templates=("T08_revenue_by_payment_method", "T28_payment_capture_analysis"),
        notes_vi=("Nguồn ai_payment_daily hiện có coverage riêng; formatter phải nêu caveat nếu kỳ hỏi vượt coverage.",),
    ),
    "product": QueryDomain(
        key="product",
        intents=("product_mix", "export_request", "visualization_request"),
        description_vi="Sản phẩm/danh mục bán chạy, doanh thu và số lượng theo ngày/cửa hàng/sản phẩm.",
        preferred_tables=("analytics.ai_product_daily",),
        lookup_tables=("cdc.product", "cdc.product_category", "cdc.outlet"),
        fallback_tables=("analytics.fct_sales_by_product", "analytics.fct_sales_by_category", "cdc.fact_sale", "fern.fact_sale"),
        verified_templates=("T03_revenue_by_category", "T04_top_products", "T16_product_sales_mix", "T17_category_contribution", "T18_product_rank_by_outlet"),
        notes_vi=(
            "Ưu tiên ai_product_daily để tránh join sale_item/product/category phức tạp.",
            "Nếu câu hỏi cần unit price/price band hoặc discount line detail thì dùng cdc.fact_sale.",
        ),
    ),
    "inventory": QueryDomain(
        key="inventory",
        intents=("inventory", "export_request"),
        description_vi="Tồn kho on-hand, tồn âm/thấp, và biến động inventory theo ngày.",
        preferred_tables=("analytics.ai_inventory_on_hand_daily",),
        lookup_tables=("cdc.product", "cdc.product_category", "cdc.outlet"),
        fallback_tables=(
            "analytics.ai_inventory_movement_daily",
            "analytics.fct_inventory_snapshot",
            "cdc.inventory_transaction",
            "fern.fact_inventory_movement",
            "fern.events_stock_low",
        ),
        verified_templates=(
            "T11_inventory_current_stock",
            "T12_inventory_low_stock",
            "T13_inventory_movement_summary",
            "T14_inventory_consumption_rate",
            "T15_inventory_reorder_alerts",
            "T29_stock_low_events",
            "INS_INVENTORY_DRIVER",
            "ANOM_INVENTORY",
            "FORECAST_STOCK_COVER",
        ),
        notes_vi=(
            "Current stock phải dùng analytics.ai_inventory_on_hand_daily hoặc stock balance thật.",
            "Biến động kho dùng analytics.ai_inventory_movement_daily; không gọi movement là tồn kho hiện tại.",
        ),
    ),
    "finance": QueryDomain(
        key="finance",
        intents=("pnl",),
        description_vi="P&L ngày, chi phí nhập/nhận hàng, payroll cost, expenses và lợi nhuận vận hành.",
        preferred_tables=("analytics.ai_finance_daily",),
        lookup_tables=("cdc.outlet",),
        fallback_tables=(
            "analytics.ai_pnl_daily",
            "analytics.fct_daily_pnl",
            "fern.events_expense_created",
            "fern.events_goods_receipt_posted",
            "fern.events_invoice_approved",
            "fern.events_invoice_issued",
            "fern.events_payroll_approved",
        ),
        verified_templates=(
            "T24_daily_pnl_summary",
            "T25_expense_breakdown",
            "T26_goods_receipt_summary",
            "T27_payroll_cost_by_outlet",
            "INS_FINANCE_DRIVER",
            "ANOM_FINANCE",
            "FORECAST_PROFIT",
        ),
        notes_vi=(
            "Finance tables yêu cầu role finance/admin; không expose cho user thiếu quyền.",
            "Goods receipt là chi phí nhập/nhận hàng, không phải COGS mặc định.",
        ),
    ),
    "lookup": QueryDomain(
        key="lookup",
        intents=("lookup", "unknown"),
        description_vi="Tra cứu outlet/product dimension an toàn trong phạm vi RBAC.",
        preferred_tables=("cdc.outlet", "cdc.product", "cdc.product_category"),
        lookup_tables=(),
        fallback_tables=("fern.dim_outlet", "fern.dim_product"),
        verified_templates=("T31_outlet_directory",),
        notes_vi=("Lookup-only không được dùng một mình trong GenSQL scoped executor nếu không có bảng scoped để inject outlet.",),
    ),
    "hr": QueryDomain(
        key="hr",
        intents=("hr_staff",),
        description_vi="HR đi qua static Postgres lane có bind params và RBAC riêng, không dùng ClickHouse GenSQL.",
        preferred_tables=(),
        lookup_tables=(),
        fallback_tables=(),
        verified_templates=(),
        notes_vi=("Không đưa 268 bảng core Postgres vào prompt; chỉ dùng các truy vấn HR static đã kiểm soát.",),
    ),
}

DATA_SOURCE_POLICIES: dict[str, DataSourcePolicy] = {
    "analytics.ai_sales_daily": DataSourcePolicy(
        dataset="analytics.ai_sales_daily",
        domain="sales",
        source_system="POS analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("net_revenue", "gross_revenue", "txn_count", "avg_basket_size", "cancellation_rate"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS theo ca/ngày F&B",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày kinh doanh mới nhất đã đồng bộ",
    ),
    "analytics.ai_product_daily": DataSourcePolicy(
        dataset="analytics.ai_product_daily",
        domain="product",
        source_system="POS product analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("product_revenue", "qty", "txn_count", "top_product", "category_mix"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh bán hàng theo sản phẩm",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày sản phẩm mới nhất đã đồng bộ",
    ),
    "analytics.ai_payment_daily": DataSourcePolicy(
        dataset="analytics.ai_payment_daily",
        domain="payment",
        source_system="POS payment analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("payment_method_revenue", "payment_txn_count"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh của payment split",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày payment split mới nhất đã đồng bộ",
    ),
    "analytics.ai_sales_hourly": DataSourcePolicy(
        dataset="analytics.ai_sales_hourly",
        domain="sales",
        source_system="POS hourly analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("hourly_revenue", "hourly_txn_count", "sales_anomaly"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS; hour_of_day lấy từ thời điểm tạo sale header",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="giờ/ngày bán hàng mới nhất đã đồng bộ",
    ),
    "analytics.ai_finance_daily": DataSourcePolicy(
        dataset="analytics.ai_finance_daily",
        domain="finance",
        source_system="Finance core BI mart",
        storage="clickhouse",
        preferred_for_metrics=(
            "revenue",
            "actual_or_theoretical_cogs",
            "goods_receipt_cost",
            "payroll_cost",
            "expense_amount",
            "gross_profit",
            "operating_profit",
            "margin",
        ),
        time_column="business_date",
        time_semantics_vi=(
            "ngày kinh doanh finance mart; goods_receipt_cost là chi phí nhập/nhận hàng, "
            "không phải COGS nếu chưa có actual consumption/recipe cost"
        ),
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày finance mart mới nhất đã đồng bộ",
    ),
    "analytics.ai_inventory_on_hand_daily": DataSourcePolicy(
        dataset="analytics.ai_inventory_on_hand_daily",
        domain="inventory",
        source_system="Inventory on-hand analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("qty_on_hand", "low_stock", "negative_stock", "current_inventory", "stock_cover"),
        time_column="business_date",
        time_semantics_vi=(
            "ngày snapshot tồn kho on-hand tính bằng running balance từ giao dịch kho; "
            "không phải movement trong ngày"
        ),
        available_range_strategy="latest_snapshot",
        freshness_label_vi="ngày on-hand tồn kho mới nhất",
    ),
    "analytics.ai_inventory_movement_daily": DataSourcePolicy(
        dataset="analytics.ai_inventory_movement_daily",
        domain="inventory",
        source_system="Inventory movement analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("inventory_movement", "movement_qty", "movement_count", "consumption_rate"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh của biến động kho theo item/loại giao dịch; không phải tồn hiện tại",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày movement kho mới nhất",
    ),
    "analytics.ai_pnl_daily": DataSourcePolicy(
        dataset="analytics.ai_pnl_daily",
        domain="finance",
        source_system="Legacy finance analytics mart",
        storage="clickhouse",
        preferred_for_metrics=("revenue", "cogs", "payroll_cost", "operating_profit", "operating_margin"),
        time_column="business_date",
        time_semantics_vi="legacy P&L theo ngày/cửa hàng; ưu tiên analytics.ai_finance_daily cho câu hỏi mới",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày P&L mới nhất đã đồng bộ",
    ),
    "analytics.fct_sales_daily": DataSourcePolicy(
        dataset="analytics.fct_sales_daily",
        domain="sales",
        source_system="POS analytics fact",
        storage="clickhouse",
        preferred_for_metrics=("net_revenue", "gross_revenue", "txn_count"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS theo fact doanh thu ngày",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày fact doanh thu mới nhất",
        coverage_enabled=False,
    ),
    "analytics.fct_sales_by_category": DataSourcePolicy(
        dataset="analytics.fct_sales_by_category",
        domain="product",
        source_system="POS category analytics fact",
        storage="clickhouse",
        preferred_for_metrics=("category_revenue", "qty"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS theo danh mục sản phẩm",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày category fact mới nhất",
        coverage_enabled=False,
    ),
    "analytics.fct_sales_by_product": DataSourcePolicy(
        dataset="analytics.fct_sales_by_product",
        domain="product",
        source_system="POS product analytics fact",
        storage="clickhouse",
        preferred_for_metrics=("product_revenue", "qty", "txn_count"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS theo sản phẩm",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày product fact mới nhất",
        coverage_enabled=False,
    ),
    "analytics.fct_payment_split": DataSourcePolicy(
        dataset="analytics.fct_payment_split",
        domain="payment",
        source_system="POS payment analytics fact",
        storage="clickhouse",
        preferred_for_metrics=("payment_method_revenue", "payment_txn_count"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh POS theo payment split",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày payment fact mới nhất",
        coverage_enabled=False,
    ),
    "analytics.fct_daily_pnl": DataSourcePolicy(
        dataset="analytics.fct_daily_pnl",
        domain="finance",
        source_system="Finance analytics fact",
        storage="clickhouse",
        preferred_for_metrics=("revenue", "cogs", "payroll_cost", "operating_profit"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh dùng để tổng hợp fact P&L",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày P&L fact mới nhất",
        coverage_enabled=False,
    ),
    "analytics.fct_inventory_snapshot": DataSourcePolicy(
        dataset="analytics.fct_inventory_snapshot",
        domain="inventory",
        source_system="Legacy inventory analytics snapshot",
        storage="clickhouse",
        preferred_for_metrics=("qty_on_hand", "low_stock", "negative_stock", "current_inventory"),
        time_column="business_date",
        time_semantics_vi=(
            "legacy snapshot tồn kho; câu hỏi current stock mới ưu tiên "
            "analytics.ai_inventory_on_hand_daily để tránh nhầm movement theo ngày"
        ),
        available_range_strategy="latest_snapshot",
        freshness_label_vi="ngày snapshot tồn kho mới nhất",
    ),
    "cdc.fact_sale": DataSourcePolicy(
        dataset="cdc.fact_sale",
        domain="sales",
        source_system="POS CDC sale fact",
        storage="clickhouse",
        preferred_for_metrics=("sale_line_revenue", "sale_item_detail", "price_bucket", "discount_detail"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh từ giao dịch bán hàng thô",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày sale CDC mới nhất",
        coverage_enabled=False,
    ),
    "cdc.sale_record": DataSourcePolicy(
        dataset="cdc.sale_record",
        domain="sales",
        source_system="POS CDC sale record",
        storage="clickhouse",
        preferred_for_metrics=("sale_record_detail", "peak_hour_txn_by_hour"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh từ sale record thô",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày sale record CDC mới nhất",
        coverage_enabled=False,
    ),
    "cdc.payment": DataSourcePolicy(
        dataset="cdc.payment",
        domain="payment",
        source_system="POS CDC payment",
        storage="clickhouse",
        preferred_for_metrics=("payment_method_revenue", "payment_state", "payment_time_detail"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh của payment raw; payment_time/created_at là thời điểm event chi tiết",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày payment CDC mới nhất",
    ),
    "cdc.inventory_transaction": DataSourcePolicy(
        dataset="cdc.inventory_transaction",
        domain="inventory",
        source_system="Inventory CDC transaction",
        storage="clickhouse",
        preferred_for_metrics=("inventory_movement", "consumption_rate"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh gắn với giao dịch inventory; txn_time là thời điểm event chi tiết",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày inventory transaction mới nhất",
        coverage_enabled=False,
    ),
    "cdc.outlet": DataSourcePolicy(
        dataset="cdc.outlet",
        domain="lookup",
        source_system="Outlet master data",
        storage="clickhouse",
        preferred_for_metrics=("outlet_directory",),
        time_column=None,
        time_semantics_vi="danh mục cửa hàng hiện tại, không phải chuỗi thời gian kinh doanh",
        available_range_strategy="no_time_coverage",
        freshness_label_vi="dữ liệu master hiện tại",
        coverage_enabled=False,
    ),
    "cdc.product": DataSourcePolicy(
        dataset="cdc.product",
        domain="lookup",
        source_system="Product master data",
        storage="clickhouse",
        preferred_for_metrics=("product_directory",),
        time_column=None,
        time_semantics_vi="danh mục sản phẩm hiện tại, không phải chuỗi thời gian kinh doanh",
        available_range_strategy="no_time_coverage",
        freshness_label_vi="dữ liệu master hiện tại",
        coverage_enabled=False,
    ),
    "cdc.product_category": DataSourcePolicy(
        dataset="cdc.product_category",
        domain="lookup",
        source_system="Product category master data",
        storage="clickhouse",
        preferred_for_metrics=("product_category_directory",),
        time_column=None,
        time_semantics_vi="danh mục nhóm sản phẩm hiện tại, không phải chuỗi thời gian kinh doanh",
        available_range_strategy="no_time_coverage",
        freshness_label_vi="dữ liệu master hiện tại",
        coverage_enabled=False,
    ),
    "fern.fact_sale": DataSourcePolicy(
        dataset="fern.fact_sale",
        domain="sales",
        source_system="Legacy FERN sale fact",
        storage="clickhouse",
        preferred_for_metrics=("sale_line_revenue", "payment_method", "discount_detail"),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh từ fact sale legacy",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày legacy sale fact mới nhất",
    ),
    "fern.fact_inventory_movement": DataSourcePolicy(
        dataset="fern.fact_inventory_movement",
        domain="inventory",
        source_system="Legacy FERN inventory movement",
        storage="clickhouse",
        preferred_for_metrics=("inventory_movement",),
        time_column="business_date",
        time_semantics_vi="ngày kinh doanh của inventory movement legacy; txn_time là thời điểm giao dịch",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày legacy inventory movement mới nhất",
    ),
    "fern.dim_outlet": DataSourcePolicy(
        dataset="fern.dim_outlet",
        domain="lookup",
        source_system="Legacy outlet dimension",
        storage="clickhouse",
        preferred_for_metrics=("outlet_directory",),
        time_column=None,
        time_semantics_vi="danh mục cửa hàng legacy hiện tại, không phải chuỗi thời gian kinh doanh",
        available_range_strategy="no_time_coverage",
        freshness_label_vi="dữ liệu master hiện tại",
        coverage_enabled=False,
    ),
    "fern.dim_product": DataSourcePolicy(
        dataset="fern.dim_product",
        domain="lookup",
        source_system="Legacy product dimension",
        storage="clickhouse",
        preferred_for_metrics=("product_directory",),
        time_column=None,
        time_semantics_vi="danh mục sản phẩm legacy hiện tại, không phải chuỗi thời gian kinh doanh",
        available_range_strategy="no_time_coverage",
        freshness_label_vi="dữ liệu master hiện tại",
        coverage_enabled=False,
    ),
    "fern.events_sale_completed": DataSourcePolicy(
        dataset="fern.events_sale_completed",
        domain="sales",
        source_system="FERN sale event stream",
        storage="clickhouse",
        preferred_for_metrics=("sale_completed_amount", "sale_event_count"),
        time_column="businessDate",
        time_semantics_vi="ngày kinh doanh của sale-completed event; completedAt là thời điểm hoàn tất event",
        available_range_strategy="event_business_date",
        freshness_label_vi="sale-completed event mới nhất",
    ),
    "fern.events_stock_low": DataSourcePolicy(
        dataset="fern.events_stock_low",
        domain="inventory",
        source_system="FERN inventory event stream",
        storage="clickhouse",
        preferred_for_metrics=("stock_low_event",),
        time_column="detectedAt",
        time_semantics_vi="thời điểm phát hiện sự kiện tồn thấp",
        available_range_strategy="event_time",
        freshness_label_vi="sự kiện tồn thấp mới nhất",
        coverage_enabled=False,
    ),
    "fern.events_goods_receipt_posted": DataSourcePolicy(
        dataset="fern.events_goods_receipt_posted",
        domain="finance",
        source_system="FERN goods receipt event stream",
        storage="clickhouse",
        preferred_for_metrics=("goods_receipt",),
        time_column="businessDate",
        time_semantics_vi="ngày kinh doanh của phiếu nhập đã post; postedAt là thời điểm post",
        available_range_strategy="event_business_date",
        freshness_label_vi="goods receipt posted mới nhất",
        coverage_enabled=False,
    ),
    "fern.events_expense_created": DataSourcePolicy(
        dataset="fern.events_expense_created",
        domain="finance",
        source_system="FERN expense event stream",
        storage="clickhouse",
        preferred_for_metrics=("expense_breakdown",),
        time_column="createdAt",
        time_semantics_vi="thời điểm tạo expense event",
        available_range_strategy="event_time",
        freshness_label_vi="expense event mới nhất",
        coverage_enabled=False,
    ),
    "fern.events_invoice_issued": DataSourcePolicy(
        dataset="fern.events_invoice_issued",
        domain="finance",
        source_system="FERN invoice event stream",
        storage="clickhouse",
        preferred_for_metrics=("invoice_issued",),
        time_column="issuedAt",
        time_semantics_vi="thời điểm hóa đơn được phát hành",
        available_range_strategy="event_time",
        freshness_label_vi="invoice issued event mới nhất",
    ),
    "fern.events_invoice_approved": DataSourcePolicy(
        dataset="fern.events_invoice_approved",
        domain="finance",
        source_system="FERN supplier invoice event stream",
        storage="clickhouse",
        preferred_for_metrics=("supplier_invoice_approved", "invoice_total_amount"),
        time_column="invoiceDate",
        time_semantics_vi="ngày hóa đơn nhà cung cấp được ghi nhận; approvedAt là thời điểm duyệt",
        available_range_strategy="event_business_date",
        freshness_label_vi="supplier invoice approved mới nhất",
    ),
    "fern.events_payment_captured": DataSourcePolicy(
        dataset="fern.events_payment_captured",
        domain="payment",
        source_system="FERN payment event stream",
        storage="clickhouse",
        preferred_for_metrics=("payment_capture",),
        time_column="businessDate",
        time_semantics_vi="ngày kinh doanh của payment capture; capturedAt là thời điểm capture event",
        available_range_strategy="event_business_date",
        freshness_label_vi="payment capture event mới nhất",
        coverage_enabled=False,
    ),
    "fern.events_payroll_approved": DataSourcePolicy(
        dataset="fern.events_payroll_approved",
        domain="finance",
        source_system="FERN payroll event stream",
        storage="clickhouse",
        preferred_for_metrics=("payroll_cost",),
        time_column="approvedAt",
        time_semantics_vi="thời điểm payroll được duyệt, không phải kỳ lương HR",
        available_range_strategy="event_time",
        freshness_label_vi="payroll approval event mới nhất",
        coverage_enabled=False,
    ),
    "core.work_shift": DataSourcePolicy(
        dataset="core.work_shift",
        domain="hr",
        source_system="Postgres HR",
        storage="postgres",
        preferred_for_metrics=("work_hours", "attendance_top", "shift_attendance"),
        time_column="work_date",
        time_semantics_vi="ngày ca làm HR; tổng giờ dùng ca present/late trong kỳ",
        available_range_strategy="minmax_time_column",
        freshness_label_vi="ngày ca làm mới nhất",
        static_lane=True,
        external=True,
    ),
    "core.payroll_period": DataSourcePolicy(
        dataset="core.payroll_period",
        domain="hr",
        source_system="Postgres HR payroll",
        storage="postgres",
        preferred_for_metrics=("net_salary", "payroll_period_total"),
        time_column="start_date/end_date",
        time_semantics_vi="kỳ payroll giao với khoảng thời gian hỏi; không dùng created_at để suy kỳ lương",
        available_range_strategy="period_overlap",
        freshness_label_vi="kỳ payroll mới nhất",
        static_lane=True,
        external=True,
    ),
    "core.payroll_timesheet": DataSourcePolicy(
        dataset="core.payroll_timesheet",
        domain="hr",
        source_system="Postgres HR payroll",
        storage="postgres",
        preferred_for_metrics=("payroll_timesheet",),
        time_column="created_at",
        time_semantics_vi="ngày tạo timesheet payroll; chỉ dùng cho truy vấn timesheet nội bộ",
        available_range_strategy="created_at_date",
        freshness_label_vi="timesheet payroll mới nhất",
        static_lane=True,
        external=True,
    ),
    "core.payroll": DataSourcePolicy(
        dataset="core.payroll",
        domain="hr",
        source_system="Postgres HR payroll",
        storage="postgres",
        preferred_for_metrics=("payroll_record",),
        time_column="created_at",
        time_semantics_vi="ngày tạo payroll row; câu hỏi lương theo kỳ ưu tiên core.payroll_period",
        available_range_strategy="created_at_date",
        freshness_label_vi="payroll row mới nhất",
        static_lane=True,
        external=True,
    ),
    "core.employee_contract": DataSourcePolicy(
        dataset="core.employee_contract",
        domain="hr",
        source_system="Postgres HR",
        storage="postgres",
        preferred_for_metrics=("employee_tenure", "employment_contract"),
        time_column="hire_date/start_date/end_date",
        time_semantics_vi="ngày vào làm/ngày hiệu lực hợp đồng HR",
        available_range_strategy="contract_dates",
        freshness_label_vi="hợp đồng nhân viên mới nhất",
        static_lane=True,
        external=True,
        coverage_enabled=False,
    ),
    "postgres_core_hr.static_hr_lane": DataSourcePolicy(
        dataset="postgres_core_hr.static_hr_lane",
        domain="hr",
        source_system="Postgres HR controlled lane",
        storage="postgres",
        preferred_for_metrics=("work_hours", "attendance_top", "net_salary", "employee_tenure"),
        time_column="depends_on_hr_template",
        time_semantics_vi="HR dùng truy vấn static có kiểm soát; work hours dùng work_date, payroll dùng start_date/end_date",
        available_range_strategy="static_lane",
        freshness_label_vi="phụ thuộc truy vấn HR cụ thể",
        static_lane=True,
        external=True,
        coverage_enabled=False,
    ),
}

TEMPLATE_DATASETS: dict[str, str] = {
    # Sales / outlet ranking.
    "T01_daily_revenue": "analytics.ai_sales_daily",
    "T02_revenue_by_outlet": "analytics.ai_sales_daily",
    "T05_revenue_trend_7d": "analytics.ai_sales_daily",
    "T06_revenue_trend_30d": "analytics.ai_sales_daily",
    "T07_revenue_comparison_yoy": "analytics.ai_sales_daily",
    "T09_avg_basket_size": "analytics.ai_sales_daily",
    "T10_transaction_count": "analytics.ai_sales_daily",
    "T21_sales_heatmap": "analytics.ai_sales_daily",
    "T22_outlet_rank": "analytics.ai_sales_daily",
    "T30_sale_cancellation_rate": "analytics.ai_sales_daily",
    "T32_period_revenue_summary": "analytics.ai_sales_daily",
    "T33_zero_revenue_outlets": "analytics.ai_sales_daily",
    "T34_sales_detail_by_day": "cdc.sale_record",
    "T35_weekly_revenue_trend": "analytics.ai_sales_daily",
    "T36_revenue_period_driver_bridge": "analytics.ai_sales_daily",
    "T37_ai_sales_daily_outlets": "analytics.ai_sales_daily",
    "INS_SALES_DRIVER": "analytics.ai_sales_daily",
    "ANOM_SALES": "analytics.ai_sales_daily",
    "FORECAST_REVENUE": "analytics.ai_sales_daily",
    # Product/category.
    "T03_revenue_by_category": "analytics.fct_sales_by_category",
    "T04_top_products": "analytics.ai_product_daily",
    "T16_product_sales_mix": "analytics.ai_product_daily",
    "T17_category_contribution": "analytics.fct_sales_by_category",
    "T18_product_rank_by_outlet": "analytics.ai_product_daily",
    "T19_slow_moving_products": "analytics.ai_product_daily",
    "T20_product_discount_analysis": "cdc.fact_sale",
    # Payment / finance / inventory.
    "T08_revenue_by_payment_method": "analytics.ai_payment_daily",
    "T24_daily_pnl_summary": "analytics.ai_finance_daily",
    "T25_expense_breakdown": "fern.events_expense_created",
    "T26_goods_receipt_summary": "fern.events_goods_receipt_posted",
    "T27_payroll_cost_by_outlet": "fern.events_payroll_approved",
    "INS_FINANCE_DRIVER": "analytics.ai_finance_daily",
    "ANOM_FINANCE": "analytics.ai_finance_daily",
    "FORECAST_PROFIT": "analytics.ai_finance_daily",
    "T28_payment_capture_analysis": "fern.events_payment_captured",
    "T23_peak_hour_analysis": "cdc.sale_record",
    "T11_inventory_current_stock": "analytics.ai_inventory_on_hand_daily",
    "T12_inventory_low_stock": "analytics.ai_inventory_on_hand_daily",
    "T13_inventory_movement_summary": "analytics.ai_inventory_movement_daily",
    "T14_inventory_consumption_rate": "analytics.ai_inventory_movement_daily",
    "T15_inventory_reorder_alerts": "analytics.ai_inventory_on_hand_daily",
    "INS_INVENTORY_DRIVER": "analytics.ai_inventory_movement_daily",
    "ANOM_INVENTORY": "analytics.ai_inventory_movement_daily",
    "FORECAST_STOCK_COVER": "analytics.ai_inventory_on_hand_daily",
    "T29_stock_low_events": "fern.events_stock_low",
    # Lookup and controlled HR lane.
    "T31_outlet_directory": "cdc.outlet",
    "T38_product_directory": "analytics.ai_product_daily",
    "HR_employee_work_hours": "core.work_shift",
    "HR_work_hours_total": "core.work_shift",
    "HR_attendance_top": "core.work_shift",
    "HR_staff_list": "core.work_shift",
    "HR_staff_management_list": "core.work_shift",
    "HR_payroll_total": "core.payroll_period",
    "HR_employee_tenure": "core.employee_contract",
    "HR_tenure_headcount": "core.employee_contract",
    "HR_tenure_list": "core.employee_contract",
    "HR_new_contracts_list": "core.employee_contract",
    "HR_outlets_missing_staff": "core.outlet",
    "HR_employment_type_headcount": "core.employee_contract",
}

TEMPLATE_DATASET_GROUPS: dict[str, tuple[str, ...]] = {
    "FORECAST_STOCK_COVER": (
        "analytics.ai_inventory_on_hand_daily",
        "analytics.ai_inventory_movement_daily",
    ),
}

_INTENT_DOMAIN_PRIORITY: dict[str, tuple[str, ...]] = {
    "revenue": ("sales",),
    "outlet_compare": ("sales",),
    "trend": ("sales",),
    "lookup": ("lookup",),
    "inventory": ("inventory",),
    "product_mix": ("product",),
    "pnl": ("finance",),
    "export_request": ("sales", "product", "inventory"),
    "visualization_request": ("sales", "product", "payment"),
    "hr_staff": ("hr",),
    "unknown": ("sales",),
}

_DOMAIN_QUESTION_HINTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "payment",
        re.compile(
            r"\b(thanh\s*toan|phuong\s*thuc|payment|pay|cash|card|tien\s*mat|"
            r"the\s+tin\s+dung|the\s+ghi\s+no|thu\s*tien|hinh\s*thuc\s*thu\s*tien)\b"
        ),
    ),
    (
        "inventory",
        re.compile(r"\b(ton\s*kho|ton\s*am|ton\s*thap|inventory|stock|nguyen\s*lieu|het\s*hang|sap\s*het)\b"),
    ),
    (
        "product",
        re.compile(
            r"\b(san\s*pham|mat\s*hang|nhom\s*san\s*pham|nhom\s*mon|"
            r"product|category|danh\s*muc|ban\s*chay|best\s*seller)\b"
        ),
    ),
    (
        "finance",
        re.compile(
            r"\b(p&l|lai\s*lo|loi\s*nhuan|profit|margin|cogs|chi\s*phi|payroll\s*cost|"
            r"hoa\s*don|invoice|supplier|nha\s*cung\s*cap|phieu\s*nhap|goods\s*receipt|"
            r"expense|chi\s*tieu)\b"
        ),
    ),
    ("lookup", re.compile(r"\b(danh\s*sach|liet\s*ke|outlet\s*nao|cua\s*hang\s*nao|store\s*list|detail|profile)\b")),
)

_CASH_CONTROL_CONTEXT_RE = re.compile(
    r"\b(tien\s*mat|cash|kiem\s*quy|quy\s*tien)\b"
    r".*\b(variance|chenh\s*lech|expected|counted|cash\s*drop|cash\s*session|paid\s*in|paid\s*out|doi\s*soat|reconcile|ket\s*ca)\b"
    r"|"
    r"\b(variance|chenh\s*lech|expected|counted|cash\s*drop|cash\s*session|paid\s*in|paid\s*out|doi\s*soat|reconcile|ket\s*ca)\b"
    r".*\b(tien\s*mat|cash|kiem\s*quy|quy\s*tien)\b"
)

METRIC_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "canonical_name": "net_revenue",
        "aliases": ("doanh thu", "doanh thu ròng", "revenue", "sales", "gmv"),
        "definition_vi": "Doanh thu ròng sau giảm giá/điều chỉnh theo dữ liệu bán hàng đã đồng bộ.",
        "preferred_table": "analytics.ai_sales_daily",
    },
    {
        "canonical_name": "gross_revenue",
        "aliases": ("doanh thu gộp", "gross revenue", "subtotal"),
        "definition_vi": "Doanh thu gộp trước các khoản giảm giá.",
        "preferred_table": "analytics.ai_sales_daily",
    },
    {
        "canonical_name": "avg_basket_size",
        "aliases": ("aov", "giá trị đơn hàng trung bình", "basket size", "average order value"),
        "definition_vi": "Doanh thu ròng chia cho số giao dịch trong cùng phạm vi.",
        "preferred_table": "analytics.ai_sales_daily",
    },
    {
        "canonical_name": "cancellation_rate",
        "aliases": ("tỷ lệ hủy đơn", "ty le huy don", "cancel rate", "cancellation rate"),
        "definition_vi": "Số đơn hủy chia cho tổng số đơn hoàn tất và đơn hủy đã ghi nhận.",
        "preferred_table": "analytics.ai_sales_daily",
    },
    {
        "canonical_name": "price_bucket",
        "aliases": ("cấp giá", "cap gia", "price band", "price bucket", "low/mid/high", "low mid high"),
        "definition_vi": "Nhóm dòng bán theo unit_price để phân phối doanh thu vào các bucket giá.",
        "preferred_table": "cdc.fact_sale",
    },
    {
        "canonical_name": "discount_ratio",
        "aliases": ("tỷ lệ giảm giá", "ty le giam gia", "discount ratio", "discount rate", "discount percentage"),
        "definition_vi": "Tỷ lệ giảm giá từ discount_amount so với line_total/gross line amount trên sale-line detail.",
        "preferred_table": "cdc.fact_sale",
    },
    {
        "canonical_name": "operating_profit",
        "aliases": ("lợi nhuận", "loi nhuan", "profit", "operating profit", "lãi"),
        "definition_vi": (
            "Lợi nhuận vận hành theo finance mart. V1 trừ actual_or_theoretical_cogs, payroll_cost "
            "và expense_amount; goods_receipt_cost không được tự coi là COGS."
        ),
        "preferred_table": "analytics.ai_finance_daily",
        "role_group": "finance",
    },
    {
        "canonical_name": "payroll_cost",
        "aliases": ("chi phí lương", "luong", "labor cost", "payroll cost"),
        "definition_vi": "Chi phí lương đã ghi nhận trong P&L hoặc payroll.",
        "preferred_table": "analytics.ai_finance_daily",
        "role_group": "finance",
    },
    {
        "canonical_name": "goods_receipt_cost",
        "aliases": ("chi phí nhập hàng", "chi phi nhap hang", "goods receipt cost", "procurement intake"),
        "definition_vi": "Tổng giá trị phiếu nhập/nhận hàng; đây là procurement intake, không phải COGS mặc định.",
        "preferred_table": "analytics.ai_finance_daily",
        "role_group": "finance",
    },
    {
        "canonical_name": "qty_on_hand",
        "aliases": ("tồn kho", "ton kho", "stock", "inventory", "hàng còn"),
        "definition_vi": "Tồn kho on-hand theo running balance từ giao dịch kho, lấy snapshot mới nhất khi hỏi hiện tại.",
        "preferred_table": "analytics.ai_inventory_on_hand_daily",
    },
    {
        "canonical_name": "inventory_movement",
        "aliases": ("biến động kho", "bien dong kho", "movement tồn kho", "inventory movement", "churn tồn kho"),
        "definition_vi": "Biến động kho theo ngày/item/loại giao dịch; không phải số tồn hiện tại.",
        "preferred_table": "analytics.ai_inventory_movement_daily",
    },
    {
        "canonical_name": "work_hours",
        "aliases": (
            "giờ làm",
            "gio lam",
            "tổng giờ",
            "tong gio",
            "bao nhiêu giờ",
            "bao nhieu gio",
            "worked hours",
            "work hours",
            "total hours",
        ),
        "definition_vi": (
            "Tổng giờ làm HR tính từ ca present/late: ưu tiên actual_start_time/actual_end_time; "
            "nếu thiếu giờ thực tế thì dùng giờ ca kế hoạch trừ break_minutes. "
            "Dữ liệu này đi qua HR static Postgres lane, không dùng GenSQL."
        ),
        "preferred_table": "postgres_core_hr.static_hr_lane",
        "role_group": "hr",
    },
    {
        "canonical_name": "attendance_top",
        "aliases": (
            "đi làm nhiều nhất",
            "di lam nhieu nhat",
            "chấm công nhiều nhất",
            "cham cong nhieu nhat",
            "nhân viên nào làm nhiều nhất",
            "nhan vien nao lam nhieu nhat",
            "attendance ranking",
        ),
        "definition_vi": (
            "Xếp hạng nhân viên theo tổng giờ làm trong kỳ; chỉ tính ca attendance_status present/late "
            "và luôn lọc theo outlet scope của người dùng."
        ),
        "preferred_table": "postgres_core_hr.static_hr_lane",
        "role_group": "hr",
    },
    {
        "canonical_name": "net_salary",
        "aliases": (
            "lương đã nhận",
            "luong da nhan",
            "lương ròng",
            "luong rong",
            "net salary",
            "salary received",
            "payroll employee",
        ),
        "definition_vi": (
            "Tổng net_salary của payroll có trạng thái approved/paid giao với khoảng thời gian hỏi. "
            "Truy vấn qua HR static Postgres lane với quyền HR/finance."
        ),
        "preferred_table": "postgres_core_hr.static_hr_lane",
        "role_group": "hr_finance",
    },
    {
        "canonical_name": "employee_tenure",
        "aliases": (
            "thâm niên",
            "tham nien",
            "làm việc bao lâu",
            "lam viec bao lau",
            "ngày vào làm",
            "ngay vao lam",
            "hire date",
            "tenure",
        ),
        "definition_vi": (
            "Thâm niên nhân viên tính từ ngày bắt đầu/hire_date sớm nhất trong employee_contract, "
            "trả lời bằng ngày bắt đầu và thời lượng đến ngày hiện tại."
        ),
        "preferred_table": "postgres_core_hr.static_hr_lane",
        "role_group": "hr",
    },
    {
        "canonical_name": "supplier_invoice_approved",
        "aliases": (
            "hóa đơn nhà cung cấp",
            "hoa don nha cung cap",
            "invoice approved",
            "supplier invoice",
            "hóa đơn đã duyệt",
            "hoa don da duyet",
        ),
        "definition_vi": "Hóa đơn nhà cung cấp đã duyệt; invoiceDate là ngày nghiệp vụ, approvedAt là thời điểm duyệt.",
        "preferred_table": "fern.events_invoice_approved",
        "role_group": "finance",
    },
    {
        "canonical_name": "goods_receipt",
        "aliases": (
            "phiếu nhập",
            "phieu nhap",
            "nhập hàng",
            "nhap hang",
            "goods receipt",
            "gr posted",
        ),
        "definition_vi": "Phiếu nhập hàng đã post; businessDate là ngày nghiệp vụ, postedAt là thời điểm post.",
        "preferred_table": "fern.events_goods_receipt_posted",
        "role_group": "finance",
    },
    {
        "canonical_name": "expense_breakdown",
        "aliases": ("chi phí", "chi phi", "expense", "khoản chi", "khoan chi"),
        "definition_vi": "Expense event được tạo theo createdAt; đây là dữ liệu finance-sensitive.",
        "preferred_table": "fern.events_expense_created",
        "role_group": "finance",
    },
)

VALUE_ALIASES: tuple[dict[str, Any], ...] = (
    {
        "canonical_type": "payment_method",
        "canonical_name": "CASH",
        "aliases": ("tiền mặt", "tien mat", "cash"),
        "filter_expression": "payment_method = 'CASH'",
    },
    {
        "canonical_type": "payment_method",
        "canonical_name": "CARD",
        "aliases": ("thẻ", "the", "card", "credit card", "debit card"),
        "filter_expression": "payment_method = 'CARD'",
    },
    {
        "canonical_type": "attendance_status",
        "canonical_name": "present_or_late",
        "aliases": ("có mặt", "co mat", "đi trễ", "di tre", "present", "late"),
        "filter_expression": "attendance_status IN ('present', 'late')",
        "caveat_vi": "Dùng cho tính giờ làm; absent không cộng giờ làm.",
    },
    {
        "canonical_type": "attendance_status",
        "canonical_name": "absent",
        "aliases": ("vắng", "vang", "nghỉ", "nghi", "absent"),
        "filter_expression": "attendance_status = 'absent'",
    },
    {
        "canonical_type": "employment_type",
        "canonical_name": "part_time",
        "aliases": ("part-time", "parttime", "part time", "bán thời gian", "ban thoi gian"),
        "filter_expression": "employment_type = 'part_time'",
    },
    {
        "canonical_type": "employment_type",
        "canonical_name": "full_time",
        "aliases": ("full-time", "fulltime", "full time", "toàn thời gian", "toan thoi gian"),
        "filter_expression": "employment_type = 'full_time'",
    },
    {
        "canonical_type": "region",
        "canonical_name": "USNC",
        "aliases": ("usnc", "us north central", "north central"),
        "filter_expression": "region_code = 'USNC'",
        "caveat_vi": "Chỉ áp dụng nếu dữ liệu outlet có region_code/region_id tương ứng trong metadata.",
    },
    {
        "canonical_type": "region",
        "canonical_name": "GB",
        "aliases": ("gb", "great britain", "uk"),
        "filter_expression": "country_code = 'GB'",
        "caveat_vi": "Chỉ áp dụng nếu outlet metadata có country_code.",
    },
)

_RUNTIME_LOCK = threading.RLock()
_RUNTIME_VERSION: int | None = None


def _rebuild_policy_derived_state() -> None:
    ALLOWED_FULL_TABLES.clear()
    ALLOWED_FULL_TABLES.update(TABLE_POLICIES.keys())
    ALLOWED_SCHEMAS.clear()
    ALLOWED_SCHEMAS.update({x.split(".", 1)[0] for x in ALLOWED_FULL_TABLES})
    TABLE_OUTLET_COLUMNS.clear()
    TABLE_OUTLET_COLUMNS.update({k: v.outlet_column for k, v in TABLE_POLICIES.items()})
    LOOKUP_ONLY_TABLES.clear()
    LOOKUP_ONLY_TABLES.update({k for k, v in TABLE_POLICIES.items() if v.lookup_only})
    TABLE_TIME_COLUMNS.clear()
    TABLE_TIME_COLUMNS.update({k: v.time_column for k, v in TABLE_POLICIES.items()})
    CODEGEN_TIME_FILTER_REQUIRED_TABLES.clear()
    CODEGEN_TIME_FILTER_REQUIRED_TABLES.update(
        full
        for full, policy in TABLE_POLICIES.items()
        if policy.time_column and (full.startswith("cdc.") or full.startswith("fern.events_") or full.startswith("fern.fact_"))
    )
    LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET.clear()
    LOOKUP_SUBQUERY_TABLES_OK_WITHOUT_LOCAL_OUTLET.update(LOOKUP_ONLY_TABLES | {"cdc.sale_record"})


def _decode_table_policy(full_name: str, raw: object) -> TablePolicy | None:
    if not isinstance(raw, dict):
        return None
    metrics = raw.get("metrics") or ()
    if not isinstance(metrics, (list, tuple)):
        return None
    return TablePolicy(
        full_name=str(raw.get("full_name") or full_name).strip().lower(),
        outlet_column=str(raw.get("outlet_column")) if raw.get("outlet_column") is not None else None,
        time_column=str(raw.get("time_column")) if raw.get("time_column") is not None else None,
        grain=str(raw.get("grain") or ""),
        metrics=tuple(str(x) for x in metrics),
        role_group=str(raw.get("role_group")) if raw.get("role_group") is not None else None,
        lookup_only=bool(raw.get("lookup_only")),
        description_vi=str(raw.get("description_vi") or ""),
    )


def _decode_query_domain(key: str, raw: object) -> QueryDomain | None:
    if not isinstance(raw, dict):
        return None
    return QueryDomain(
        key=str(raw.get("key") or key),
        intents=tuple(str(x) for x in (raw.get("intents") or ())),
        description_vi=str(raw.get("description_vi") or ""),
        preferred_tables=tuple(str(x) for x in (raw.get("preferred_tables") or ())),
        lookup_tables=tuple(str(x) for x in (raw.get("lookup_tables") or ())),
        fallback_tables=tuple(str(x) for x in (raw.get("fallback_tables") or ())),
        verified_templates=tuple(str(x) for x in (raw.get("verified_templates") or ())),
        notes_vi=tuple(str(x) for x in (raw.get("notes_vi") or ())),
    )


def _decode_data_source_policy(dataset: str, raw: object) -> DataSourcePolicy | None:
    if not isinstance(raw, dict):
        return None
    return DataSourcePolicy(
        dataset=str(raw.get("dataset") or dataset),
        domain=str(raw.get("domain") or ""),
        source_system=str(raw.get("source_system") or ""),
        storage=str(raw.get("storage") or ""),
        preferred_for_metrics=tuple(str(x) for x in (raw.get("preferred_for_metrics") or ())),
        time_column=str(raw.get("time_column")) if raw.get("time_column") is not None else None,
        time_semantics_vi=str(raw.get("time_semantics_vi") or ""),
        available_range_strategy=str(raw.get("available_range_strategy") or ""),
        freshness_label_vi=str(raw.get("freshness_label_vi") or ""),
        coverage_severity_policy=str(raw.get("coverage_severity_policy") or "warn_partial"),
        static_lane=bool(raw.get("static_lane")),
        external=bool(raw.get("external")),
        coverage_enabled=bool(raw.get("coverage_enabled", True)),
    )


def ensure_runtime_query_policy_loaded(*, force: bool = False) -> None:
    global _RUNTIME_VERSION, METRIC_DEFINITIONS, VALUE_ALIASES
    with _RUNTIME_LOCK:
        version, section = get_runtime_catalog_section("query_policy", force=force)
        if not force and version == _RUNTIME_VERSION:
            return
        if isinstance(section, dict):
            if isinstance(section.get("table_policies"), dict):
                parsed_tables: dict[str, TablePolicy] = {}
                for key, raw in section["table_policies"].items():
                    policy = _decode_table_policy(str(key), raw)
                    if policy:
                        parsed_tables[policy.full_name] = policy
                if parsed_tables:
                    TABLE_POLICIES.clear()
                    TABLE_POLICIES.update(parsed_tables)
            if isinstance(section.get("query_domains"), dict):
                parsed_domains: dict[str, QueryDomain] = {}
                for key, raw in section["query_domains"].items():
                    domain = _decode_query_domain(str(key), raw)
                    if domain:
                        parsed_domains[str(key)] = domain
                if parsed_domains:
                    QUERY_DOMAINS.clear()
                    QUERY_DOMAINS.update(parsed_domains)
            if isinstance(section.get("data_source_policies"), dict):
                parsed_sources: dict[str, DataSourcePolicy] = {}
                for key, raw in section["data_source_policies"].items():
                    dsp = _decode_data_source_policy(str(key), raw)
                    if dsp:
                        parsed_sources[str(key)] = dsp
                if parsed_sources:
                    DATA_SOURCE_POLICIES.clear()
                    DATA_SOURCE_POLICIES.update(parsed_sources)
            if isinstance(section.get("template_datasets"), dict):
                TEMPLATE_DATASETS.clear()
                TEMPLATE_DATASETS.update({str(k): str(v) for k, v in section["template_datasets"].items()})
            if isinstance(section.get("template_dataset_groups"), dict):
                TEMPLATE_DATASET_GROUPS.clear()
                TEMPLATE_DATASET_GROUPS.update(
                    {str(k): tuple(str(x) for x in v) for k, v in section["template_dataset_groups"].items() if isinstance(v, (list, tuple))}
                )
            if isinstance(section.get("table_blocked_select_columns"), dict):
                TABLE_BLOCKED_SELECT_COLUMNS.clear()
                TABLE_BLOCKED_SELECT_COLUMNS.update(
                    {str(k): frozenset(str(x) for x in v) for k, v in section["table_blocked_select_columns"].items() if isinstance(v, (list, tuple, set))}
                )
            if isinstance(section.get("codegen_time_filter_required_tables"), (list, tuple, set)):
                CODEGEN_TIME_FILTER_REQUIRED_TABLES.clear()
                CODEGEN_TIME_FILTER_REQUIRED_TABLES.update(str(x) for x in section["codegen_time_filter_required_tables"])
            if isinstance(section.get("intent_table_priority"), dict):
                _INTENT_TABLE_PRIORITY.clear()
                _INTENT_TABLE_PRIORITY.update(
                    {str(k): tuple(str(x) for x in v) for k, v in section["intent_table_priority"].items() if isinstance(v, (list, tuple))}
                )
            if isinstance(section.get("intent_domain_priority"), dict):
                _INTENT_DOMAIN_PRIORITY.clear()
                _INTENT_DOMAIN_PRIORITY.update(
                    {str(k): tuple(str(x) for x in v) for k, v in section["intent_domain_priority"].items() if isinstance(v, (list, tuple))}
                )
            if isinstance(section.get("metric_definitions"), list):
                METRIC_DEFINITIONS = tuple(item for item in section["metric_definitions"] if isinstance(item, dict))
            if isinstance(section.get("value_aliases"), list):
                VALUE_ALIASES = tuple(item for item in section["value_aliases"] if isinstance(item, dict))
            _rebuild_policy_derived_state()
        _RUNTIME_VERSION = version


def get_table_policy(full_name: str) -> TablePolicy | None:
    ensure_runtime_query_policy_loaded()
    return TABLE_POLICIES.get(full_name.strip().lower())


def get_data_source_policy(dataset: str) -> DataSourcePolicy | None:
    ensure_runtime_query_policy_loaded()
    return DATA_SOURCE_POLICIES.get(dataset.strip())


def dataset_for_template(template_key: str | None) -> str | None:
    ensure_runtime_query_policy_loaded()
    key = (template_key or "").strip()
    if not key:
        return None
    return TEMPLATE_DATASETS.get(key)


def datasets_for_template(template_key: str | None) -> tuple[str, ...]:
    ensure_runtime_query_policy_loaded()
    key = (template_key or "").strip()
    if not key:
        return ()
    grouped = TEMPLATE_DATASET_GROUPS.get(key)
    if grouped:
        return grouped
    dataset = TEMPLATE_DATASETS.get(key)
    return (dataset,) if dataset else ()


def finance_sensitive_tables() -> frozenset[str]:
    ensure_runtime_query_policy_loaded()
    return frozenset(k for k, v in TABLE_POLICIES.items() if v.role_group == "finance")


def tables_for_intent(intent: str | None, *, max_tables: int) -> list[str]:
    ensure_runtime_query_policy_loaded()
    intent_key = (intent or "unknown").strip().lower()
    chain = _INTENT_TABLE_PRIORITY.get(intent_key) or _INTENT_TABLE_PRIORITY["unknown"]
    out: list[str] = []
    for full in chain:
        if full in TABLE_POLICIES and full not in out:
            out.append(full)
        if len(out) >= max_tables:
            break
    return out


def _append_unique(out: list[str], values: tuple[str, ...]) -> None:
    for full in values:
        if full in TABLE_POLICIES and full not in out:
            out.append(full)


def domain_keys_for_question(intent: str | None, question: str | None = None) -> list[str]:
    ensure_runtime_query_policy_loaded()
    """Return ordered semantic domains for a question.

    Question hints can override a broad supervisor intent. Example: supervisor
    may label "doanh thu theo phương thức thanh toán" as revenue, but the prompt
    should expose the payment mart first, not the whole sales/raw schema.
    """

    q = _fold(question or "")
    keys: list[str] = []
    for key, pattern in _DOMAIN_QUESTION_HINTS:
        if key == "payment" and _CASH_CONTROL_CONTEXT_RE.search(q):
            continue
        if pattern.search(q) and key not in keys:
            keys.append(key)

    intent_key = (intent or "unknown").strip().lower()
    for key in _INTENT_DOMAIN_PRIORITY.get(intent_key, _INTENT_DOMAIN_PRIORITY["unknown"]):
        if key not in keys:
            keys.append(key)

    return keys or ["sales"]


def candidate_tables_for_prompt(
    intent: str | None,
    *,
    question: str | None = None,
    max_tables: int = 8,
    include_fallbacks: bool = False,
) -> list[str]:
    ensure_runtime_query_policy_loaded()
    """Small curated table pack for LLM prompts.

    This is intentionally narrower than ALLOWED_FULL_TABLES. The hard guard
    keeps the full allow-list; planner/generator prompts get only the tables
    relevant to the selected semantic domain so they do not hallucinate joins
    across many unrelated operational tables.
    """

    cap = max(1, min(int(max_tables), 16))
    out: list[str] = []
    for key in domain_keys_for_question(intent, question):
        domain = QUERY_DOMAINS.get(key)
        if not domain:
            continue
        _append_unique(out, domain.preferred_tables)
        _append_unique(out, domain.lookup_tables)
        if include_fallbacks:
            _append_unique(out, domain.fallback_tables)
        if len(out) >= cap:
            return out[:cap]
    return out[:cap]


def format_domain_contract(
    *,
    intent: str | None,
    question: str | None = None,
    max_tables: int = 8,
    include_fallbacks: bool = False,
) -> str:
    ensure_runtime_query_policy_loaded()
    keys = domain_keys_for_question(intent, question)
    tables = candidate_tables_for_prompt(
        intent,
        question=question,
        max_tables=max_tables,
        include_fallbacks=include_fallbacks,
    )
    lines: list[str] = ["Semantic domain contract:"]
    for key in keys:
        domain = QUERY_DOMAINS.get(key)
        if not domain:
            continue
        lines.append(f"- domain `{domain.key}`: {domain.description_vi}")
        if domain.notes_vi:
            lines.append("  notes: " + " ".join(domain.notes_vi[:2]))
    if tables:
        lines.append("Candidate tables exposed to LLM:")
        for full in tables:
            p = TABLE_POLICIES[full]
            bits = [f"`{full}`", f"grain={p.grain}"]
            if p.time_column:
                bits.append(f"time={p.time_column}")
            if p.outlet_column:
                bits.append(f"outlet={p.outlet_column}")
            if p.metrics:
                bits.append("metrics=" + ", ".join(p.metrics[:8]))
            if p.lookup_only:
                bits.append("lookup_only=true")
            if p.role_group:
                bits.append(f"role_group={p.role_group}")
            lines.append("  - " + "; ".join(bits))
    return "\n".join(lines)


def allowed_tables_for_prompt() -> list[str]:
    ensure_runtime_query_policy_loaded()
    return sorted(ALLOWED_FULL_TABLES)


def table_policy_rows() -> list[dict[str, Any]]:
    ensure_runtime_query_policy_loaded()
    return [
        {
            "full_table": p.full_name,
            "outlet_column": p.outlet_column,
            "time_column": p.time_column,
            "grain": p.grain,
            "metrics": list(p.metrics),
            "role_group": p.role_group,
            "lookup_only": p.lookup_only,
            "description_vi": p.description_vi,
        }
        for p in TABLE_POLICIES.values()
    ]


def data_source_policy_rows() -> list[dict[str, Any]]:
    ensure_runtime_query_policy_loaded()
    return [
        {
            "dataset": p.dataset,
            "domain": p.domain,
            "source_system": p.source_system,
            "storage": p.storage,
            "preferred_for_metrics": list(p.preferred_for_metrics),
            "time_column": p.time_column,
            "time_semantics_vi": p.time_semantics_vi,
            "available_range_strategy": p.available_range_strategy,
            "freshness_label_vi": p.freshness_label_vi,
            "coverage_severity_policy": p.coverage_severity_policy,
            "static_lane": p.static_lane,
            "external": p.external,
            "coverage_enabled": p.coverage_enabled,
        }
        for p in DATA_SOURCE_POLICIES.values()
    ]


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _alias_hit(question_folded: str, aliases: tuple[str, ...]) -> bool:
    for alias in aliases:
        a = _fold(alias)
        if not a:
            continue
        if re.search(rf"(?<!\w){re.escape(a)}(?!\w)", question_folded):
            return True
    return False


_PAYMENT_CONTEXT_RE = re.compile(
    r"\b(thanh\s*toan|phuong\s*thuc|payment|pay|cash|card|tien\s*mat|"
    r"theo\s+the|bang\s+the|qua\s+the|the\s+tin\s+dung|the\s+ghi\s+no)\b"
)


def find_semantic_matches(question: str, *, max_items: int = 8) -> list[dict[str, Any]]:
    """Deterministic local semantic matches; complements OpenSearch when unavailable."""
    ensure_runtime_query_policy_loaded()
    q = _fold(question)
    cash_control_context = bool(_CASH_CONTROL_CONTEXT_RE.search(q))
    out: list[dict[str, Any]] = []
    for metric in METRIC_DEFINITIONS:
        if _alias_hit(q, tuple(metric["aliases"])):
            out.append({"kind": "metric", **metric})
    for alias in VALUE_ALIASES:
        if alias.get("canonical_type") == "payment_method":
            if cash_control_context or not _PAYMENT_CONTEXT_RE.search(q):
                continue
        if _alias_hit(q, tuple(alias["aliases"])):
            out.append({"kind": "value_alias", **alias})
    return out[:max_items]


def format_metadata_context(
    *,
    question: str,
    intent: str | None,
    os_hits: list[dict[str, Any]] | None = None,
    max_chars: int = 2400,
    include_fallbacks: bool = False,
) -> str:
    """Build prompt-safe semantic context from query policy + optional OpenSearch hits."""
    ensure_runtime_query_policy_loaded()
    lines: list[str] = []
    domain_contract = format_domain_contract(
        intent=intent,
        question=question,
        max_tables=6,
        include_fallbacks=include_fallbacks,
    )
    if domain_contract:
        lines.append(domain_contract)

    local = find_semantic_matches(question)
    if local:
        lines.append("Alias/metric đã nhận diện:")
        for item in local:
            if item["kind"] == "metric":
                lines.append(
                    f"- metric `{item['canonical_name']}`: {item['definition_vi']} "
                    f"(preferred_table={item['preferred_table']})"
                )
            else:
                caveat = f"; lưu ý: {item.get('caveat_vi')}" if item.get("caveat_vi") else ""
                lines.append(
                    f"- value `{item['canonical_type']}` → {item['canonical_name']} "
                    f"({item['filter_expression']}{caveat})"
                )

    if os_hits:
        cleaned: list[str] = []
        for hit in os_hits[:6]:
            title = str(hit.get("canonical_name") or hit.get("full_table") or hit.get("title") or "").strip()
            summary = str(hit.get("definition_vi") or hit.get("summary_vi") or hit.get("description_vi") or "").strip()
            if title or summary:
                cleaned.append(f"- {title}: {summary[:260]}")
        if cleaned:
            lines.append("OpenSearch metadata hits:")
            lines.extend(cleaned)

    text = "\n".join(lines).strip()
    if len(text) > max_chars:
        return text[: max_chars - 20] + "\n...(đã cắt)"
    return text
