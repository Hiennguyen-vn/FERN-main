from app.graph.nodes.data_coverage import (
    build_data_source_context,
    coverage_context_for_source,
    coverage_max_date_for_template,
    coverage_status_for_range,
    coverage_window_for_template,
    data_coverage,
    format_data_coverage_for_prompt,
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
                "dataset": "analytics.fct_inventory_snapshot",
                "min_date": "2025-07-02",
                "max_date": "2026-05-02",
                "row_count": 89877,
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

    assert coverage_window_for_template(state)["dataset"] == "analytics.fct_inventory_snapshot"
    assert coverage_max_date_for_template(state) == "2026-05-02"


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


def test_inventory_current_source_context_uses_latest_snapshot():
    state = {
        "template_key": "T11_inventory_current_stock",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-05"},
        "data_coverage_context": _coverage(),
    }

    ctx = build_data_source_context(state)

    assert ctx is not None
    assert ctx["primary_dataset"] == "analytics.fct_inventory_snapshot"
    assert ctx["requested_range"] == {"from_date": "2026-05-02", "to_date": "2026-05-02"}
    assert ctx["coverage_status"] == "full"


def test_data_coverage_clamps_partial_after_range_to_available_max(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "T32_period_revenue_summary",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-08"},
        "trace": [],
    }
    out = data_coverage(state)
    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"]["from_date"] == "2026-05-01"
    assert out["time_range"]["to_date"] == "2026-05-02"
    assert any("thu hẹp" in (c or "") for c in (out.get("data_source_context") or {}).get("caveats") or [])


def test_data_coverage_clamps_fully_outside_future_to_last_week(monkeypatch):
    def fake_cache(ds):
        return _coverage()

    monkeypatch.setattr("app.graph.nodes.data_coverage._cached_coverage_for_datasets", fake_cache)
    state = {
        "template_key": "T32_period_revenue_summary",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-11"},
        "trace": [],
    }
    out = data_coverage(state)
    assert out["coverage_time_clamp_applied"] is True
    assert out["time_range"]["to_date"] == "2026-05-02"
    assert out["time_range"]["from_date"] == "2026-04-26"
    assert any("7 ngày" in (c or "") for c in (out.get("data_source_context") or {}).get("caveats") or [])
