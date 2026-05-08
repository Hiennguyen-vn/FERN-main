from pathlib import Path

from app.query_policy import (
    ALLOWED_FULL_TABLES,
    CODEGEN_TIME_FILTER_REQUIRED_TABLES,
    DATA_SOURCE_POLICIES,
    TABLE_POLICIES,
    TABLE_BLOCKED_SELECT_COLUMNS,
    TABLE_OUTLET_COLUMNS,
    candidate_tables_for_prompt,
    data_source_policy_rows,
    dataset_for_template,
    domain_keys_for_question,
    find_semantic_matches,
    format_domain_contract,
    format_metadata_context,
    select_verified_query,
    tables_for_intent,
)


def test_ai_metric_tables_are_allowlisted_and_scoped():
    for full in (
        "analytics.ai_sales_daily",
        "analytics.ai_product_daily",
        "analytics.ai_pnl_daily",
        "analytics.ai_payment_daily",
    ):
        assert full in ALLOWED_FULL_TABLES
        assert TABLE_OUTLET_COLUMNS[full] == "outlet_id"


def test_curated_clickhouse_surface_includes_raw_and_event_sources():
    for full in (
        "cdc.payment",
        "fern.fact_sale",
        "fern.fact_inventory_movement",
        "fern.events_sale_completed",
        "fern.events_invoice_issued",
        "fern.events_invoice_approved",
    ):
        assert full in ALLOWED_FULL_TABLES
        assert full in DATA_SOURCE_POLICIES

    assert TABLE_OUTLET_COLUMNS["cdc.payment"] == "outlet_id"
    assert TABLE_OUTLET_COLUMNS["fern.events_stock_low"] == "outletId"
    assert DATA_SOURCE_POLICIES["fern.events_stock_low"].time_column == "detectedAt"
    assert DATA_SOURCE_POLICIES["fern.events_expense_created"].time_column == "createdAt"


def test_policy_declares_codegen_safety_constraints():
    assert "cdc.fact_sale" in CODEGEN_TIME_FILTER_REQUIRED_TABLES
    assert "cdc.payment" in CODEGEN_TIME_FILTER_REQUIRED_TABLES
    assert "fern.events_invoice_approved" in CODEGEN_TIME_FILTER_REQUIRED_TABLES
    assert "analytics.ai_sales_daily" not in CODEGEN_TIME_FILTER_REQUIRED_TABLES
    assert "address" in TABLE_BLOCKED_SELECT_COLUMNS["cdc.outlet"]
    assert "phone" in TABLE_BLOCKED_SELECT_COLUMNS["cdc.outlet"]


def test_data_source_policy_registry_matches_allowlist_or_static_lanes():
    bad: list[str] = []
    for dataset, policy in DATA_SOURCE_POLICIES.items():
        if dataset not in TABLE_POLICIES and not (policy.external or policy.static_lane):
            bad.append(dataset)
    assert bad == []

    rows = data_source_policy_rows()
    assert any(row["dataset"] == "analytics.ai_sales_daily" and row["time_column"] == "business_date" for row in rows)


def test_template_dataset_mapping_covers_time_source_templates():
    assert dataset_for_template("T08_revenue_by_payment_method") == "analytics.ai_payment_daily"
    assert dataset_for_template("T33_zero_revenue_outlets") == "analytics.ai_sales_daily"
    assert dataset_for_template("T34_sales_detail_by_day") == "cdc.sale_record"
    assert dataset_for_template("T23_peak_hour_analysis") == "cdc.fact_sale"
    assert dataset_for_template("T29_stock_low_events") == "fern.events_stock_low"
    assert dataset_for_template("HR_payroll_total") == "core.payroll_period"
    assert dataset_for_template("HR_new_contracts_list") == "core.employee_contract"


def test_policy_prefers_flattened_metric_tables():
    assert tables_for_intent("revenue", max_tables=2)[0] == "analytics.ai_sales_daily"
    assert tables_for_intent("product_mix", max_tables=1) == ["analytics.ai_product_daily"]
    assert tables_for_intent("pnl", max_tables=1) == ["analytics.ai_pnl_daily"]


def test_line_level_price_and_discount_questions_expose_cdc_fact_sale():
    price_tables = candidate_tables_for_prompt(
        "revenue",
        question="phân phối doanh thu theo cấp giá low/mid/high tháng này",
        max_tables=8,
        include_fallbacks=True,
    )
    discount_tables = candidate_tables_for_prompt(
        "revenue",
        question="tỷ lệ giảm giá trung bình theo outlet tuần này",
        max_tables=8,
        include_fallbacks=True,
    )

    assert "cdc.fact_sale" in price_tables
    assert "cdc.fact_sale" in discount_tables
    assert "price_bucket" in DATA_SOURCE_POLICIES["cdc.fact_sale"].preferred_for_metrics


def test_semantic_domain_pack_keeps_prompt_schema_small():
    tables = candidate_tables_for_prompt(
        "revenue",
        question="doanh thu tháng này",
        max_tables=4,
        include_fallbacks=False,
    )

    assert tables == ["analytics.ai_sales_daily", "cdc.outlet"]
    assert "cdc.fact_sale" not in tables
    assert "fern.events_expense_created" not in tables


def test_semantic_domain_pack_routes_broad_revenue_payment_question_to_payment_mart():
    tables = candidate_tables_for_prompt(
        "revenue",
        question="doanh thu theo phương thức thanh toán tháng này",
        max_tables=4,
        include_fallbacks=False,
    )

    assert tables[0] == "analytics.ai_payment_daily"
    assert "analytics.ai_sales_daily" in tables
    assert domain_keys_for_question("revenue", "doanh thu theo phương thức thanh toán")[0] == "payment"
    assert domain_keys_for_question("revenue", "doanh thu chia theo hình thức thu tiền tháng này")[0] == "payment"


def test_finance_domain_expands_invoice_and_goods_receipt_event_tables():
    tables = candidate_tables_for_prompt(
        "pnl",
        question="hóa đơn nhà cung cấp đã duyệt và phiếu nhập tháng này",
        max_tables=10,
        include_fallbacks=True,
    )

    assert domain_keys_for_question("unknown", "hóa đơn nhà cung cấp đã duyệt tháng này")[0] == "finance"
    assert "fern.events_invoice_approved" in tables
    assert "fern.events_invoice_issued" in tables
    assert "fern.events_goods_receipt_posted" in tables


def test_semantic_domain_pack_keeps_inventory_ahead_of_product_terms():
    keys = domain_keys_for_question("inventory", "tồn kho hiện tại mặt hàng nào tồn âm nhiều nhất")

    assert keys[:2] == ["inventory", "product"]


def test_domain_contract_and_metadata_context_are_prompt_safe():
    contract = format_domain_contract(
        intent="product_mix",
        question="top sản phẩm bán chạy tháng này",
        max_tables=3,
    )
    assert "Semantic domain contract" in contract
    assert "analytics.ai_product_daily" in contract
    assert "- `cdc.fact_sale`" not in contract

    meta = format_metadata_context(
        question="top sản phẩm bán chạy tháng này",
        intent="product_mix",
        max_chars=4000,
    )
    assert "Candidate tables exposed to LLM" in meta
    assert "analytics.ai_product_daily" in meta


def test_semantic_aliases_match_metrics_and_values():
    hits = find_semantic_matches("doanh thu ròng theo thẻ")
    names = {h.get("canonical_name") for h in hits}
    assert "net_revenue" in names
    assert "CARD" in names


def test_semantic_aliases_match_hr_concepts():
    hits = find_semantic_matches("nhân viên nào đi làm nhiều nhất và tổng giờ làm tháng này")
    names = {h.get("canonical_name") for h in hits}
    assert "attendance_top" in names
    assert "work_hours" in names


def test_semantic_aliases_match_finance_event_concepts():
    hits = find_semantic_matches("hóa đơn nhà cung cấp đã duyệt và phiếu nhập tháng này")
    names = {h.get("canonical_name") for h in hits}
    assert "supplier_invoice_approved" in names
    assert "goods_receipt" in names


def test_payment_alias_does_not_match_the_in_the_nao():
    hits = find_semantic_matches("giờ làm được tính như thế nào?")
    names = {h.get("canonical_name") for h in hits}
    assert "work_hours" in names
    assert "CARD" not in names


def test_metric_views_migration_contains_required_columns():
    sql = Path("../infra/clickhouse/migrations/V003__ai_metric_views.sql")
    text = sql.read_text(encoding="utf-8")
    for view in ("ai_sales_daily", "ai_product_daily", "ai_pnl_daily", "ai_payment_daily"):
        assert f"analytics.{view}" in text
    assert "outlet_id" in text
    assert "business_date" in text


def test_cdc_fact_views_alias_joined_columns_for_clickhouse():
    text = Path("../infra/clickhouse/migrations/V002__cdc_schema.sql").read_text(encoding="utf-8")
    assert "fs.outlet_id      AS outlet_id" in text
    assert "fs.business_date  AS business_date" in text
    assert "fs.product_id     AS product_id" in text


def test_verified_query_selector_picks_common_assets():
    time_range = {"from_date": "2026-04-15", "to_date": "2026-05-04"}

    top = select_verified_query(
        question="20 ngày gần nhất doanh thu cửa hàng nào cao nhất",
        intent="outlet_compare",
        time_range=time_range,
    )
    assert top is not None
    assert top.template_key == "T22_outlet_rank"
    assert top.params == time_range

    yoy = select_verified_query(
        question="doanh thu tháng này so với cùng kỳ năm ngoái",
        intent="revenue",
        time_range={"from_date": "2026-05-01", "to_date": "2026-05-04"},
    )
    assert yoy is not None
    assert yoy.template_key == "T07_revenue_comparison_yoy"

    zero = select_verified_query(
        question="còn 2 cửa hàng không phát sinh doanh thu là cửa hàng nào trong tháng 3",
        intent="revenue",
        time_range={"from_date": "2026-03-01", "to_date": "2026-03-31"},
    )
    assert zero is not None
    assert zero.template_key == "T33_zero_revenue_outlets"

    detail = select_verified_query(
        question="chi tiết bán hàng ngày 5/4/2026 tất cả cửa hàng, các đơn mua hàng",
        intent="revenue",
        time_range={"from_date": "2026-04-05", "to_date": "2026-04-05"},
    )
    assert detail is not None
    assert detail.template_key == "T34_sales_detail_by_day"

    peak = select_verified_query(
        question="Giờ cao điểm bán hàng trong tuần trước",
        intent="revenue",
        time_range={"from_date": "2026-04-27", "to_date": "2026-05-03"},
    )
    assert peak is not None
    assert peak.template_key == "T23_peak_hour_analysis"
    assert peak.params == {"from_date": "2026-04-27", "to_date": "2026-05-03"}

    peak_q3 = select_verified_query(
        question="Cao điểm bán hàng quý 3 năm 2025",
        intent="revenue",
        time_range={"from_date": "2025-07-01", "to_date": "2025-09-30"},
    )
    assert peak_q3 is not None
    assert peak_q3.template_key == "T23_peak_hour_analysis"
    assert peak_q3.params == {"from_date": "2025-07-01", "to_date": "2025-09-30"}


def test_verified_query_selector_requires_time_slots():
    assert (
        select_verified_query(
            question="doanh thu cửa hàng nào cao nhất",
            intent="outlet_compare",
            time_range={},
        )
        is None
    )


def test_verified_query_skips_cdc_schema_table_requests():
    tr = {"from_date": "2026-05-01", "to_date": "2026-05-07"}
    assert (
        select_verified_query(
            question="lấy bảng cdc.payment toàn bộ",
            intent="revenue",
            time_range=tr,
        )
        is None
    )


def test_verified_query_t32_matches_toan_bo_with_revenue_nearby():
    tr = {"from_date": "2026-05-01", "to_date": "2026-05-31"}
    m = select_verified_query(question="doanh thu toàn bộ tháng này", intent="revenue", time_range=tr)
    assert m is not None
    assert m.template_key == "T32_period_revenue_summary"
