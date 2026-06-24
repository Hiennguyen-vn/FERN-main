from app.graph.nodes.data_coverage import (
    build_data_source_context,
    coverage_context_for_source,
    coverage_max_date_for_template,
    coverage_status_for_range,
    coverage_window_for_template,
    data_coverage,
    executed_datasets_for_state,
    format_data_coverage_for_prompt,
    _clickhouse_coverage_sql,
)


def _coverage():
    return {
        "datasets": [
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_sales_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-02",
                "row_count": 1506,
            },
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_inventory_on_hand_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-02",
                "row_count": 89877,
            },
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_inventory_movement_daily",
                "min_date": "2025-07-02",
                "max_date": "2026-05-02",
                "row_count": 157346,
            },
            {
                "source": "postgres",
                "dataset": "core.payroll_period",
                "min_date": "2025-07-01",
                "max_date": "2026-03-31",
                "row_count": 9,
            },
        ],
        "errors": [],
    }


def test_format_data_coverage_for_prompt_is_compact():
    text = format_data_coverage_for_prompt(_coverage())

    assert "Data coverage from DB" in text
    assert "analytics.ai_sales_daily: 2025-07-02" in text
    assert "core.payroll_period: 2025-07-01" in text


def test_coverage_window_uses_template_specific_dataset():
    state = {"template_key": "HR_payroll_total", "data_coverage_context": _coverage()}

    assert coverage_max_date_for_template(state) == "2026-03-31"
    assert coverage_window_for_template(state)["dataset"] == "core.payroll_period"


def test_coverage_window_uses_inventory_dataset_for_stock_templates():
    state = {"template_key": "T12_inventory_low_stock", "data_coverage_context": _coverage()}

    assert coverage_window_for_template(state)["dataset"] == "analytics.ai_inventory_on_hand_daily"
    assert coverage_max_date_for_template(state) == "2026-05-02"


def test_clickhouse_coverage_uses_cdc_base_for_inventory_and_payment_views():
    sql = _clickhouse_coverage_sql(
        [
            "analytics.ai_inventory_on_hand_daily",
            "analytics.ai_inventory_movement_daily",
            "analytics.ai_payment_daily",
        ]
    )

    assert "FROM cdc.inventory_transaction" in sql
    assert "FROM cdc.payment" in sql
    assert "analytics.ai_inventory_on_hand_daily" in sql
    assert "analytics.ai_inventory_movement_daily" in sql
    assert "analytics.ai_payment_daily" in sql


def test_coverage_status_for_requested_range():
    assert coverage_status_for_range("2025-07-02", "2026-05-02", "2025-08-01", "2025-08-31") == "full"
    assert coverage_status_for_range("2025-07-02", "2026-05-02", "2025-05-01", "2025-08-31") == "partial_before"
    assert coverage_status_for_range("2025-07-02", "2026-05-02", "2026-05-01", "2026-05-31") == "partial_after"
    assert coverage_status_for_range("2025-07-02", "2026-05-02", "2025-05-01", "2025-06-01") == "outside"
    assert coverage_status_for_range("", "", "2026-01-01", "2026-01-31") == "unknown"


def test_source_context_uses_payment_policy_and_caveat():
    coverage = {
        "datasets": [
            {
                "source": "clickhouse",
                "dataset": "analytics.ai_payment_daily",
                "min_date": "2026-05-02",
                "max_date": "2026-05-02",
                "row_count": 27,
            }
        ],
        "errors": [],
    }
    ctx = coverage_context_for_source(
        coverage,
        "analytics.ai_payment_daily",
        requested_range={"from_date": "2026-05-01", "to_date": "2026-05-04"},
    )

    assert ctx["coverage_status"] == "partial_before"
    assert ctx["time_column"] == "business_date"
    assert "payment split" in ctx["time_semantics"]
    assert ctx["actual_data_range"] == {"from_date": "2026-05-02", "to_date": "2026-05-02"}


def test_build_data_source_context_uses_template_mapping():
    state = {
        "template_key": "T29_stock_low_events",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "fern.events_stock_low",
                    "min_date": "",
                    "max_date": "",
                    "row_count": 0,
                }
            ],
            "errors": [],
        },
    }

    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "fern.events_stock_low"
    assert ctx["time_column"] == "detectedAt"
    assert ctx["coverage_status"] == "outside"


def test_build_data_source_context_prefers_metric_specific_finance_event_source():
    state = {
        "intent": "revenue",
        "raw_question": "hóa đơn nhà cung cấp đã duyệt tháng này",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "planning_frame": {
            "domain": "finance",
            "metric_ids": ["supplier_invoice_approved"],
        },
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "fern.events_invoice_approved",
                    "min_date": "2026-05-01",
                    "max_date": "2026-05-02",
                    "row_count": 2,
                },
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_pnl_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                },
            ],
            "errors": [],
        },
    }

    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "fern.events_invoice_approved"
    assert ctx["time_column"] == "invoiceDate"
    assert ctx["coverage_status"] == "partial_after"


def test_build_data_source_context_prefers_executed_codegen_tables_over_intent_default():
    state = {
        "intent": "product_mix",
        "executed_sql_source": "codegen",
        "codegen_tables_used": ["analytics.fct_sales_by_category"],
        "raw_question": "nhóm món tăng trưởng thế nào",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.fct_sales_by_category",
                    "min_date": "2026-05-01",
                    "max_date": "2026-05-04",
                    "row_count": 12,
                },
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_product_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                },
            ],
            "errors": [],
        },
    }

    assert executed_datasets_for_state(state) == ["analytics.fct_sales_by_category"]
    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "analytics.fct_sales_by_category"
    assert ctx["coverage_status"] == "full"


def test_inventory_current_source_context_uses_latest_snapshot():
    state = {
        "template_key": "T11_inventory_current_stock",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-05"},
        "data_coverage_context": _coverage(),
    }

    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "analytics.ai_inventory_on_hand_daily"
    assert ctx["requested_range"] == {"from_date": "2026-05-02", "to_date": "2026-05-02"}
    assert ctx["coverage_status"] == "full"


def test_multi_source_template_context_lists_all_executed_template_datasets():
    state = {
        "template_key": "FORECAST_STOCK_COVER",
        "executed_sql_source": "template",
        "time_range": {"from_date": "2026-05-02", "to_date": "2026-05-02"},
        "data_coverage_context": _coverage(),
    }

    assert executed_datasets_for_state(state) == [
        "analytics.ai_inventory_on_hand_daily",
        "analytics.ai_inventory_movement_daily",
    ]
    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "analytics.ai_inventory_on_hand_daily"
    selected = ctx.get("selected_data_sources") or []
    assert [row.get("dataset") for row in selected] == [
        "analytics.ai_inventory_on_hand_daily",
        "analytics.ai_inventory_movement_daily",
    ]


def test_data_coverage_clamps_partial_after_range_to_available_max(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "T32_period_revenue_summary",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-08"},
        "template_params": {"from_date": "2026-05-01", "to_date": "2026-05-08"},
        "trace": [],
    }
    out = data_coverage(state)
    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"]["from_date"] == "2026-05-01"
    assert out["time_range"]["to_date"] == "2026-05-02"
    assert out["template_params"]["from_date"] == "2026-05-01"
    assert out["template_params"]["to_date"] == "2026-05-02"
    assert any("thu hẹp" in (c or "") for c in (out.get("data_source_context") or {}).get("caveats") or [])


def test_data_coverage_keeps_explicit_fully_outside_future_range(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "T32_period_revenue_summary",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-11"},
        "template_params": {"from_date": "2026-05-05", "to_date": "2026-05-11"},
        "trace": [],
    }
    out = data_coverage(state)
    assert out.get("coverage_time_clamp_applied") is not True
    assert out["time_range"] == {"from_date": "2026-05-05", "to_date": "2026-05-11"}
    assert out["template_params"] == {"from_date": "2026-05-05", "to_date": "2026-05-11"}
    assert (out.get("data_source_context") or {}).get("coverage_status") == "outside"
    caveats = (out.get("data_source_context") or {}).get("caveats") or []
    assert any("không tự động dùng số liệu của kỳ khác" in (c or "") for c in caveats)


def test_data_coverage_uses_latest_available_for_implicit_default_date(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "T32_period_revenue_summary",
        "time_range": {"from_date": "2026-05-03", "to_date": "2026-05-03"},
        "template_params": {"from_date": "2026-05-03", "to_date": "2026-05-03"},
        "time_context": {
            "current_has_time_expression": False,
            "time_source_text": "Outlet nào đang có doanh thu yếu nhất?",
        },
        "trace": [],
    }
    out = data_coverage(state)

    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"] == {"from_date": "2026-05-02", "to_date": "2026-05-02"}
    assert out["template_params"] == {"from_date": "2026-05-02", "to_date": "2026-05-02"}
    caveats = (out.get("data_source_context") or {}).get("caveats") or []
    assert any("không nêu kỳ cụ thể" in (c or "") for c in caveats)


def test_data_coverage_clamps_forecast_revenue_to_available_month_to_date(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "FORECAST_REVENUE",
        "time_range": {"from_date": "2026-05-18", "to_date": "2026-05-18"},
        "template_params": {"from_date": "2026-05-18", "to_date": "2026-05-18"},
        "trace": [],
    }
    out = data_coverage(state)

    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"]["from_date"] == "2026-05-01"
    assert out["time_range"]["to_date"] == "2026-05-02"
    assert out["template_params"]["from_date"] == "2026-05-01"
    assert out["template_params"]["to_date"] == "2026-05-02"
    assert (out.get("data_source_context") or {}).get("requested_range") == {
        "from_date": "2026-05-01",
        "to_date": "2026-05-02",
    }


def test_data_coverage_clamps_stock_cover_to_available_rolling_window(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "FORECAST_STOCK_COVER",
        "time_range": {"from_date": "2026-05-18", "to_date": "2026-05-18"},
        "template_params": {"from_date": "2026-05-18", "to_date": "2026-05-18"},
        "trace": [],
    }
    out = data_coverage(state)

    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"]["from_date"] == "2026-04-05"
    assert out["time_range"]["to_date"] == "2026-05-02"
    assert out["template_params"]["from_date"] == "2026-04-05"
    assert out["template_params"]["to_date"] == "2026-05-02"
    assert (out.get("data_source_context") or {}).get("requested_range") == {
        "from_date": "2026-04-05",
        "to_date": "2026-05-02",
    }
