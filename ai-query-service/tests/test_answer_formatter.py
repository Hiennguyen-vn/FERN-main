import pytest

from app.graph.nodes import answer_formatter as af


def test_safe_answer_facts_includes_all_rows_when_under_cap():
    state = {
        "normalized_question": "Top sản phẩm",
        "guard_passed": True,
        "raw_result": [],
        "trace": [],
    }
    rows = [{"rank": i, "sku": f"S{i}", "qty": (i + 1) * 5} for i in range(10)]
    facts = af._safe_answer_facts(state, rows)
    assert facts["rows_summary"]["full_row_count"] == 10
    assert facts["rows_summary"]["preview_includes_all_rows"] is True
    assert len(facts["preview_rows"]) == 10


@pytest.mark.asyncio
async def test_answer_formatter_standardizes_unsupported_answer():
    state = {
        "response_kind": "unsupported",
        "clarification_question": "Hiện ai-query chưa bật mart cash-control.",
        "response_hints": ["unsupported:cash_control_not_enabled"],
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert out["response_kind"] == "unsupported"
    assert "Hiện ai-query chưa bật mart cash-control." in out["answer_text"]
    assert "sales, finance, inventory" in out["answer_text"]
    assert "data_source_context" not in out
    assert out["trace"][-1]["source"] == "direct_unsupported"


async def test_answer_formatter_falls_back_when_llm_fails(monkeypatch):
    async def fail_llm(**_kwargs):
        raise TimeoutError("slow")

    monkeypatch.setattr(af, "llm_call_text", fail_llm)

    state = {
        "normalized_question": "Doanh thu theo cửa hàng",
        "guard_passed": True,
        "raw_result": [{"outlet_id": 1, "net_revenue": 120000, "txn_count": 12}],
        "template_key": None,
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert out["response_kind"] == "answer"
    assert "1 dòng dữ liệu" in out["answer_text"]
    assert "net_revenue=120,000" in out["answer_text"]
    assert out["citations"] == [{"row_count": 1, "template": None}]
    assert out["trace"][-1]["fallback"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("template_key", "question", "expected"),
    [
        ("T03_revenue_by_category", "Outlet VN-HN-1 mạnh/yếu ở nhóm sản phẩm nào?", "nhóm mạnh nhất là Đồ uống"),
        ("T17_category_contribution", "Nhóm sản phẩm nào đóng góp doanh thu cao nhất tuần này?", "chiếm 50,00%"),
    ],
)
async def test_answer_formatter_uses_deterministic_category_mix(monkeypatch, template_key, question, expected):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for deterministic category mix")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": question,
        "time_range": {"from_date": "2026-05-13", "to_date": "2026-05-19"},
        "allowed_outlet_ids": [3491812500481523713],
        "guard_passed": True,
        "raw_result": [
            {"category_code": "BEV", "category_name": "Đồ uống", "revenue": 5000000, "qty": 100, "revenue_share": 0.5},
            {"category_code": "FOOD", "category_name": "Món chính", "revenue": 3200000, "qty": 55, "revenue_share": 0.32},
            {"category_code": "SIDE", "category_name": "Ăn nhẹ", "revenue": 1800000, "qty": 40, "revenue_share": 0.18},
        ],
        "template_key": template_key,
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert expected in out["answer_text"]
    assert "10.000.000 đ" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_category_mix"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_revenue_by_outlet(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng này theo cửa hàng",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "allowed_outlet_ids": [1, 2, 3],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 2, "outlet_name": "Outlet 2", "net_revenue": 2200000, "txn_count": 22},
            {"outlet_id": 1, "outlet_name": "Outlet 1", "net_revenue": 1100000, "txn_count": 11},
        ],
        "template_key": "T02_revenue_by_outlet",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "2/3 cửa hàng" in out["answer_text"]
    assert "3.300.000 đ" in out["answer_text"]
    assert "Outlet 2" in out["answer_text"]
    assert "Cửa hàng dẫn đầu là Outlet 2" in out["answer_text"]
    assert "2:" not in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_revenue_by_outlet"


@pytest.mark.asyncio
async def test_answer_formatter_adds_data_coverage_caveat(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng này theo cửa hàng",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "allowed_outlet_ids": [1],
        "guard_passed": True,
        "raw_result": [
            {"business_date": "2026-05-02", "outlet_id": 1, "outlet_name": "Outlet 1", "net_revenue": 1100000, "txn_count": 11},
        ],
        "template_key": "T02_revenue_by_outlet",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                }
            ],
            "errors": [],
        },
        "sql_logical_check": {
            "consistent": False,
            "mismatch_risk": "high",
            "notes_vi": "SQL đang xếp hạng ở grain outlet + item_id.",
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Nguồn thời gian: business_date trong analytics.ai_sales_daily" in out["answer_text"]
    assert "dữ liệu hiện có 2025-07-02 đến 2026-05-02" in out["answer_text"]
    assert "bạn hỏi đến 2026-05-04" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_actual_range_when_rows_have_no_date_and_coverage_partial_after(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu 7 ngày gần nhất theo cửa hàng",
        "time_range": {"from_date": "2026-04-30", "to_date": "2026-05-06"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 1, "outlet_name": "Outlet 1", "net_revenue": 1100000, "txn_count": 11},
            {"outlet_id": 2, "outlet_name": "Outlet 2", "net_revenue": 900000, "txn_count": 9},
        ],
        "template_key": "T02_revenue_by_outlet",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    first_line = out["answer_text"].splitlines()[0]
    assert first_line.startswith("_Lưu ý:")
    assert "bạn hỏi đến 2026-05-06" in first_line
    assert "2026-04-30 đến 2026-05-02" in out["answer_text"]
    assert "bạn hỏi đến 2026-05-06" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_stock_cover_uses_snapshot_and_consumption_window(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for stock cover forecast")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "Tồn kho hiện tại đủ bán được bao lâu?",
        "time_range": {"from_date": "2026-04-21", "to_date": "2026-05-02"},
        "template_params": {"from_date": "2026-04-21", "to_date": "2026-05-02"},
        "allowed_outlet_ids": [1, 2, 3, 4],
        "guard_passed": True,
        "raw_result": [
            {
                "outlet_id": 1,
                "item_id": 101,
                "snapshot_date": "2026-05-02",
                "qty_on_hand": -54,
                "avg_daily_consumption": 0.1428,
                "days_of_cover": -378.1512,
            },
            {
                "outlet_id": 2,
                "item_id": 102,
                "snapshot_date": "2026-05-02",
                "qty_on_hand": 12,
                "avg_daily_consumption": 3,
                "days_of_cover": 4,
            },
        ],
        "template_key": "FORECAST_STOCK_COVER",
        "data_coverage_context": {
            "datasets": [
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
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "tồn âm 54 đơn vị" in out["answer_text"]
    assert "cover -378" not in out["answer_text"]
    assert "days-of-cover âm là dấu hiệu tồn âm/thiếu hàng" in out["answer_text"]
    assert "snapshot tồn kho 2026-05-02" in out["answer_text"]
    assert "cửa sổ tiêu thụ 2026-04-05 đến 2026-05-02" in out["answer_text"]
    assert "2026-04-21 đến 2026-05-02" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_sanitizes_internal_review_terms(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng này theo cửa hàng",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "allowed_outlet_ids": [1],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 1, "outlet_name": "Outlet 1", "net_revenue": 1100000, "txn_count": 11},
        ],
        "template_key": "T02_revenue_by_outlet",
        "sql_logical_check": {
            "consistent": True,
            "mismatch_risk": "medium",
            "notes_vi": "SQL đúng mục tiêu. Rủi ro là group theo outlet_id cần đối chiếu với template_key.",
        },
        "data_coverage_context": {
            "datasets": [
                {
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2026-01-01",
                    "max_date": "2026-12-31",
                    "row_count": 1,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "SQL" not in out["answer_text"]
    assert "template_key" not in out["answer_text"]
    assert "truy vấn đúng" not in out["answer_text"]
    assert "đối chiếu lại với báo cáo chuẩn" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_suppresses_spurious_monthly_grain_review_for_period_summary(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for period summary")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng 1 và 2 năm nay",
        "time_range": {"from_date": "2026-01-01", "to_date": "2026-02-28"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {
                "gross_revenue": 1507026000,
                "net_revenue": 1656466790,
                "txn_count": 25390,
                "total_discount": 1147100,
                "first_business_date": "2026-01-01",
                "last_business_date": "2026-02-28",
                "business_days": 59,
                "outlet_count": 2,
            }
        ],
        "template_key": "T32_period_revenue_summary",
        "sql_logical_check": {
            "consistent": False,
            "mismatch_risk": "high",
            "notes_vi": "Câu hỏi hàm ý tách theo từng tháng, nhưng truy vấn đang cộng gộp toàn bộ 2 tháng thành một dòng nên sai grain thời gian.",
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "1.656.466.790 đ" in out["answer_text"]
    assert "sai grain" not in out["answer_text"].lower()
    assert "tách theo từng tháng" not in out["answer_text"].lower()


@pytest.mark.asyncio
async def test_answer_formatter_suppresses_reviewer_noise_when_empty_due_coverage(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for empty result")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tuần này của outlet 2",
        "time_range": {"from_date": "2026-05-04", "to_date": "2026-05-04"},
        "allowed_outlet_ids": [2],
        "guard_passed": True,
        "raw_result": [],
        "template_key": "T02_revenue_by_outlet",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                }
            ],
            "errors": [],
        },
        "sql_logical_check": {
            "consistent": False,
            "mismatch_risk": "high",
            "notes_vi": "Reviewer cho rằng thời gian tuần này bị lệch.",
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Nguồn analytics.ai_sales_daily hiện chưa có dữ liệu" in out["answer_text"]
    assert "2026-05-04 đến 2026-05-04" in out["answer_text"]
    assert "Kiểm tra logic" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_top_products(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for top products")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "top sản phẩm tháng này",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "guard_passed": True,
        "raw_result": [
            {"product_id": 1, "product_name": "Trà sữa", "revenue": 100000, "qty": 10},
            {"product_id": 2, "product_name": "Cà phê", "revenue": 60000, "qty": 6},
        ],
        "template_key": "T04_top_products",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Top sản phẩm" in out["answer_text"]
    assert "16 đơn vị" in out["answer_text"]
    assert "Trà sữa" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_top_products"


@pytest.mark.asyncio
async def test_answer_formatter_product_directory_uses_total_products(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for product directory")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "có bao nhiêu sản phẩm trong hệ thống",
        "guard_passed": True,
        "raw_result": [
            {"product_id": 1, "product_name": "Cà phê sữa", "category_code": "DRINK", "outlet_count": 3, "total_products": 128},
            {"product_id": 2, "product_name": "Trà đào", "category_code": "DRINK", "outlet_count": 2, "total_products": 128},
        ],
        "template_key": "T38_product_directory",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Có 128 sản phẩm" in out["answer_text"]
    assert "Cà phê sữa" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_product_directory"


@pytest.mark.asyncio
async def test_answer_formatter_top_products_revenue_sort_uses_revenue_wording(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for top product revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "sản phẩm nào tháng 4 có doanh thu cao nhất",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "guard_passed": True,
        "raw_result": [
            {"product_id": 1, "product_name": "Chao Long", "revenue": 54700360, "qty": 1233},
        ],
        "template_key": "T04_top_products",
        "template_params": {"from_date": "2026-04-01", "to_date": "2026-04-30", "limit": 1, "sort_by": "revenue"},
        "analysis_brief": {
            "findings": [
                {
                    "claim": "Chao Long tạo doanh thu cao nhất trong kết quả.",
                    "evidence": ["Chao Long: 54.700.360 đ", "Số lượng bán: 1.233 đơn vị"],
                }
            ]
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Sản phẩm có doanh thu cao nhất" in out["answer_text"]
    assert "Chao Long tạo doanh thu cao nhất" in out["answer_text"]
    assert "bán chạy" not in out["answer_text"]
    assert "dẫn đầu theo số lượng" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_formats_codegen_product_revenue_by_outlet(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for codegen product outlet revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu Com Tam Bi tháng 5 năm nay của các cửa hàng",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-19"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "executed_sql_source": "codegen",
        "sql_writer_contract": {"output_shape": "product_revenue_by_outlet_table"},
        "raw_result": [
            {
                "outlet_id": 3491812036998348800,
                "outlet_name": "Outlet VN-HCM-5",
                "product_id": 3491811094513074249,
                "product_name": "Com Tam Bi",
                "revenue": 2772000,
                "qty": 56,
            },
            {
                "outlet_id": 3491812500481523713,
                "outlet_name": "Outlet VN-DN-1",
                "product_id": 3491811094513074249,
                "product_name": "Com Tam Bi",
                "revenue": 1930500,
                "qty": 39,
            },
        ],
        "template_key": None,
        "trace": [],
    }

    out = await af.answer_formatter(state)

    text = out["answer_text"]
    assert "Doanh thu Com Tam Bi" in text
    assert "theo 2 cửa hàng" in text
    assert "4.702.500 đ" in text
    assert "| # | Cửa hàng | Doanh thu | Số lượng bán |" in text
    assert "|---|---|---|---|" in text
    assert "| 1 | Outlet VN-HCM-5 | 2.772.000 đ | 56 |" in text
    assert "outlet_id" not in text
    assert "product_id" not in text
    assert "Có 2 dòng dữ liệu phù hợp" not in text
    assert out["trace"][-1]["source"] == "deterministic_codegen_product_revenue_by_outlet"


@pytest.mark.asyncio
async def test_answer_formatter_formats_codegen_product_revenue_summary(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for codegen product revenue summary")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu Ca Phe Den tháng 5",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-19"},
        "guard_passed": True,
        "executed_sql_source": "codegen",
        "sql_writer_contract": {"output_shape": "product_metric_summary"},
        "raw_result": [
            {
                "product_id": 1,
                "product_name": "Ca Phe Den",
                "revenue": 892336260,
                "qty": 13453,
                "outlet_count": 12,
            }
        ],
        "template_key": None,
        "trace": [],
    }

    out = await af.answer_formatter(state)

    text = out["answer_text"]
    assert "Doanh thu Ca Phe Den" in text
    assert "892.336.260 đ" in text
    assert "13.453 đơn vị" in text
    assert "12 cửa hàng" in text
    assert "product_id" not in text
    assert out["trace"][-1]["source"] == "deterministic_codegen_product_revenue_summary"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_outlet_directory(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet directory")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "có các cửa hàng nào trong hệ thống",
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 1, "outlet_code": "SIM-SMALL-OUT-0001", "outlet_name": "Outlet 1 - VN-HCM", "outlet_status": "active"},
            {"outlet_id": 2, "outlet_code": "SIM-SMALL-OUT-0002", "outlet_name": "Outlet VN-HCM-2", "outlet_status": "active"},
        ],
        "template_key": "T31_outlet_directory",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Có 2 cửa hàng" in out["answer_text"]
    assert "Outlet 1 - VN-HCM" in out["answer_text"]
    assert "khoảng hỏi" not in out["answer_text"]
    assert "danh mục cửa hàng master" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_outlet_directory"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_ai_sales_daily_outlets(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for ai_sales_daily outlet list")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "Nguồn dữ liệu analytics.ai_sales_daily có những cửa hàng nào",
        "time_range": {"from_date": "", "to_date": ""},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {
                "outlet_id": 1,
                "outlet_code": "VN-HN-1",
                "outlet_name": "Outlet VN-HN-1",
                "outlet_status": "active",
                "first_business_date": "2025-07-02",
                "last_business_date": "2026-05-19",
                "business_days": 322,
            },
            {
                "outlet_id": 2,
                "outlet_code": "VN-HCM-1",
                "outlet_name": "Outlet VN-HCM-1",
                "outlet_status": "active",
                "first_business_date": "2025-07-02",
                "last_business_date": "2026-05-19",
                "business_days": 322,
            },
        ],
        "template_key": "T37_ai_sales_daily_outlets",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-19",
                    "row_count": 3864,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Có 2 cửa hàng có dữ liệu trong analytics.ai_sales_daily" in out["answer_text"]
    assert "Dải dữ liệu theo business_date: 2025-07-02 đến 2026-05-19" in out["answer_text"]
    assert "Outlet VN-HN-1" in out["answer_text"]
    assert "Nguồn thời gian: business_date trong analytics.ai_sales_daily" in out["answer_text"]
    assert "2026-05-20" not in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_ai_sales_daily_outlets"


@pytest.mark.asyncio
async def test_answer_formatter_outlet_directory_single_row_is_detail(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet detail")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "tôi muốn thông tin chi tiết của Outlet 1 - VN-HCM (SIM-SMALL-OUT-0001) - active",
        "allowed_outlet_ids": [3485603532616777729],
        "guard_passed": True,
        "raw_result": [
            {
                "outlet_id": 3485603532616777729,
                "outlet_code": "SIM-SMALL-OUT-0001",
                "outlet_name": "Outlet 1 - VN-HCM",
                "outlet_status": "active",
                "region_id": 3485603532612583424,
                "address": None,
                "phone": None,
                "created_at": "2026-05-02 17:24:01.631",
                "updated_at": "2026-05-02 17:24:01.631",
            },
        ],
        "template_key": "T31_outlet_directory",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Thông tin cửa hàng Outlet 1 - VN-HCM" in out["answer_text"]
    assert "SIM-SMALL-OUT-0001" in out["answer_text"]
    assert "Region ID: 3485603532612583424" in out["answer_text"]
    assert "Test Outlet" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_chart_answer(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for chart specs")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "Vẽ biểu đồ doanh thu theo ngày",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-02"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {"business_date": "2026-04-02", "net_revenue": 150, "txn_count": 18},
            {"business_date": "2026-04-01", "net_revenue": 100, "txn_count": 12},
        ],
        "template_key": "T01_daily_revenue",
        "chart_spec": {
            "type": "line",
            "title": "doanh thu ròng theo business_date",
            "x": "business_date",
            "y": "net_revenue",
            "metric_label": "doanh thu ròng",
            "row_count": 2,
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert out["response_kind"] == "answer"
    assert "2 điểm dữ liệu" in out["answer_text"]
    assert "2026-04-01 đến 2026-04-02" in out["answer_text"]
    assert "net_revenue" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_visualization"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_period_summary(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for period summary")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tất cả cửa hàng tháng trước",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {
                "gross_revenue": 1000000,
                "net_revenue": 1100000,
                "txn_count": 42,
                "total_discount": 5000,
                "first_business_date": "2026-04-01",
                "last_business_date": "2026-04-30",
                "business_days": 30,
                "outlet_count": 2,
            }
        ],
        "template_key": "T32_period_revenue_summary",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Doanh thu 2 cửa hàng" in out["answer_text"]
    assert "1.100.000 đ" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_period_summary"


@pytest.mark.asyncio
async def test_answer_formatter_outside_coverage_does_not_present_aggregate_default_date(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outside coverage")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng 4 năm ngoái",
        "time_range": {"from_date": "2025-04-01", "to_date": "2025-04-30"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {
                "gross_revenue": 0,
                "net_revenue": 0,
                "txn_count": 0,
                "total_discount": 0,
                "first_business_date": "1970-01-01",
                "last_business_date": "1970-01-01",
                "business_days": 0,
                "outlet_count": 0,
            }
        ],
        "template_key": "T32_period_revenue_summary",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "hiện chưa có đủ dữ liệu cho 2025-04-01 đến 2025-04-30" in out["answer_text"]
    assert "tự động thu hẹp" not in out["answer_text"]
    assert "không dùng số liệu của kỳ khác" in out["answer_text"]
    assert "1970" not in out["answer_text"]
    assert out["trace"][-1]["source"] == "coverage_outside"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_outlet_rank(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet rank")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "cửa hàng nào doanh thu cao nhất",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 2, "outlet_name": "Outlet 2", "net_revenue": 2200000, "rank": 1},
            {"outlet_id": 1, "outlet_name": "Outlet 1", "net_revenue": 1100000, "rank": 2},
        ],
        "template_key": "T22_outlet_rank",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Outlet 2" in out["answer_text"]
    assert "2.200.000 đ" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_outlet_rank"


@pytest.mark.asyncio
async def test_answer_formatter_uses_lowest_copy_for_ascending_outlet_rank(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for outlet rank")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "Outlet nào đang có doanh thu yếu nhất?",
        "time_range": {"from_date": "2026-04-26", "to_date": "2026-05-02"},
        "template_params": {"from_date": "2026-04-26", "to_date": "2026-05-02", "rank_direction": "asc"},
        "allowed_outlet_ids": [1, 2],
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 1, "outlet_name": "Outlet yếu", "net_revenue": 1100000, "rank": 1},
            {"outlet_id": 2, "outlet_name": "Outlet mạnh", "net_revenue": 2200000, "rank": 2},
        ],
        "template_key": "T22_outlet_rank",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "doanh thu thấp nhất" in out["answer_text"]
    assert "Outlet yếu" in out["answer_text"]
    assert "đang dẫn đầu" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_yoy_revenue(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for YoY revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng này so với cùng kỳ năm ngoái",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "time_context": {"comparison_from_date": "2025-05-01", "comparison_to_date": "2025-05-04"},
        "guard_passed": True,
        "raw_result": [
            {
                "revenue_current": 1200000,
                "revenue_last_year": 1000000,
                "txn_current": 12,
                "txn_last_year": 10,
            }
        ],
        "template_key": "T07_revenue_comparison_yoy",
        "data_coverage_context": {
            "datasets": [
                {
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-01-01",
                    "max_date": "2026-12-31",
                    "row_count": 1,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "tăng 200.000 đ" in out["answer_text"]
    assert "20,00%" in out["answer_text"]
    assert "2025-05-01 đến 2025-05-04" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_yoy_revenue"


@pytest.mark.asyncio
async def test_answer_formatter_yoy_does_not_claim_growth_when_comparison_outside_coverage(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for YoY revenue")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu tháng này so với cùng kỳ năm ngoái",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "time_context": {"comparison_from_date": "2025-05-01", "comparison_to_date": "2025-05-04"},
        "guard_passed": True,
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_sales_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1506,
                }
            ],
            "errors": [],
        },
        "raw_result": [
            {
                "revenue_current": 1200000,
                "revenue_last_year": 0,
                "txn_current": 12,
                "txn_last_year": 0,
            }
        ],
        "template_key": "T07_revenue_comparison_yoy",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "Chưa đủ dữ liệu cùng kỳ năm ngoái" in out["answer_text"]
    assert "tăng" not in out["answer_text"].splitlines()[0].lower()
    assert "2025-07-02" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_payment_method(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for payment method")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu theo phương thức thanh toán tháng này",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "guard_passed": True,
        "raw_result": [
            {"payment_method": "CARD", "revenue": 300000, "txn_count": 3},
            {"payment_method": "CASH", "revenue": 100000, "txn_count": 1},
        ],
        "template_key": "T08_revenue_by_payment_method",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "CARD" in out["answer_text"]
    assert "400.000 đ" in out["answer_text"]
    assert "75,00%" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_payment_method"


@pytest.mark.asyncio
async def test_answer_formatter_payment_method_warns_single_day_source_for_multi_day_range(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for payment method")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "doanh thu theo phương thức thanh toán tháng này",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-04"},
        "guard_passed": True,
        "raw_result": [
            {"payment_method": "bank_transfer", "revenue": 2308001309, "txn_count": 34717},
            {"payment_method": "cash", "revenue": 2305469371, "txn_count": 34672},
            {"payment_method": "ewallet", "revenue": 2302905746, "txn_count": 34620},
        ],
        "template_key": "T08_revenue_by_payment_method",
        "data_coverage_context": {
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
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "nguồn thanh toán hiện chỉ có dữ liệu ngày 2026-05-02" in out["answer_text"]
    assert "không nên xem là đủ toàn bộ kỳ" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_peak_hour(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for peak hour")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "Giờ cao điểm bán hàng trong tuần trước",
        "time_range": {"from_date": "2026-04-27", "to_date": "2026-05-03"},
        "guard_passed": True,
        "raw_result": [
            {"hour_of_day": 9, "txn_count": 10, "revenue": 1000000},
            {"hour_of_day": 12, "txn_count": 25, "revenue": 3000000},
            {"hour_of_day": 18, "txn_count": 20, "revenue": 4000000},
        ],
        "template_key": "T23_peak_hour_analysis",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "cdc.sale_record",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 1000,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "12:00-12:59" in out["answer_text"]
    assert "25 giao dịch" in out["answer_text"]
    assert "8.000.000 đ" in out["answer_text"]
    assert "Nguồn thời gian: business_date trong cdc.sale_record" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_peak_hour"


@pytest.mark.asyncio
async def test_answer_formatter_daily_pnl_warns_when_cost_columns_are_zero(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for P&L")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "lợi nhuận tháng 4 là bao nhiêu",
        "time_range": {"from_date": "2026-04-01", "to_date": "2026-04-30"},
        "guard_passed": True,
        "raw_result": [
            {
                "business_date": "2026-04-01",
                "outlet_id": 1,
                "revenue": 1000000,
                "actual_or_theoretical_cogs": 0,
                "goods_receipt_cost": 250000,
                "payroll_cost": 0,
                "expense_amount": 0,
                "operating_profit": 1000000,
            },
            {
                "business_date": "2026-04-02",
                "outlet_id": 1,
                "revenue": 2000000,
                "actual_or_theoretical_cogs": 0,
                "goods_receipt_cost": 0,
                "payroll_cost": 0,
                "expense_amount": 0,
                "operating_profit": 2000000,
            },
        ],
        "template_key": "T24_daily_pnl_summary",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "P&L" in out["answer_text"]
    assert "không được tự xem là COGS" in out["answer_text"]
    assert "actual/theoretical COGS" in out["answer_text"]
    assert "chưa đủ tin cậy" in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_inventory_low_stock_does_not_hallucinate_product_name(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for current stock")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "mặt hàng nào tồn âm nhiều nhất hiện tại",
        "guard_passed": True,
        "raw_result": [
            {"outlet_id": 6, "item_id": 3485603532637749262, "qty_on_hand": -8752},
            {"outlet_id": 6, "item_id": 3485603532637749254, "qty_on_hand": -5065},
        ],
        "template_key": "T12_inventory_low_stock",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_inventory_on_hand_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 89877,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "3485603532637749262" in out["answer_text"]
    assert "tồn âm" in out["answer_text"]
    assert "cặp outlet-item" in out["answer_text"]
    assert "không tự suy diễn tên sản phẩm" in out["answer_text"].lower()
    assert "Kiểm tra logic" not in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_inventory_stock"


@pytest.mark.asyncio
async def test_answer_formatter_inventory_current_latest_snapshot_has_no_today_gap_caveat(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for current stock")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "tồn kho hiện tại",
        "time_range": {"from_date": "2026-05-05", "to_date": "2026-05-05"},
        "guard_passed": True,
        "raw_result": [
            {"business_date": "2026-05-02", "outlet_id": 6, "item_id": 123, "qty_on_hand": -10},
        ],
        "template_key": "T11_inventory_current_stock",
        "data_coverage_context": {
            "datasets": [
                {
                    "source": "clickhouse",
                    "dataset": "analytics.ai_inventory_on_hand_daily",
                    "min_date": "2025-07-02",
                    "max_date": "2026-05-02",
                    "row_count": 89877,
                }
            ],
            "errors": [],
        },
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "snapshot 2026-05-02" in out["answer_text"]
    assert "bạn hỏi đến 2026-05-05" not in out["answer_text"]


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_zero_revenue_outlets(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for zero-revenue outlets")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "cửa hàng không phát sinh doanh thu trong tháng 3",
        "time_range": {"from_date": "2026-03-01", "to_date": "2026-03-31"},
        "allowed_outlet_ids": [1, 2, 3],
        "guard_passed": True,
        "raw_result": [
            {
                "outlet_id": 2,
                "outlet_code": "SIM-SMALL-OUT-0002",
                "outlet_name": "Outlet 2",
                "outlet_status": "active",
                "net_revenue": 0,
                "txn_count": 0,
            }
        ],
        "template_key": "T33_zero_revenue_outlets",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "1/3 cửa hàng không phát sinh doanh thu" in out["answer_text"]
    assert "Outlet 2" in out["answer_text"]
    assert "SIM-SMALL-OUT-0002" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_zero_revenue_outlets"


@pytest.mark.asyncio
async def test_answer_formatter_uses_deterministic_sales_detail(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("formatter LLM should not be called for sales detail")

    monkeypatch.setattr(af, "llm_call_text", fail_if_called)

    state = {
        "normalized_question": "chi tiết bán hàng ngày 5/4/2026 tất cả cửa hàng",
        "time_range": {"from_date": "2026-04-05", "to_date": "2026-04-05"},
        "guard_passed": True,
        "raw_result": [
            {
                "sale_id": 1001,
                "business_date": "2026-04-05",
                "outlet_id": 2,
                "outlet_code": "SIM-SMALL-OUT-0002",
                "outlet_name": "Outlet 2",
                "sale_status": "completed",
                "sale_total_amount": 120000,
                "product_id": 10,
                "product_name": "Cà phê sữa",
                "qty": 2,
                "line_total": 120000,
            },
            {
                "sale_id": 1002,
                "business_date": "2026-04-05",
                "outlet_id": 2,
                "outlet_code": "SIM-SMALL-OUT-0002",
                "outlet_name": "Outlet 2",
                "sale_status": "completed",
                "sale_total_amount": 50000,
                "product_id": 11,
                "product_name": "Trà đào",
                "qty": 1,
                "line_total": 50000,
            },
        ],
        "template_key": "T34_sales_detail_by_day",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    assert "2 đơn bán hàng" in out["answer_text"]
    assert "2 dòng chi tiết" in out["answer_text"]
    assert "170.000 đ" in out["answer_text"]
    assert "Cà phê sữa" in out["answer_text"]
    assert out["trace"][-1]["source"] == "deterministic_sales_detail"


@pytest.mark.asyncio
async def test_answer_formatter_llm_prompt_uses_answer_facts_not_template_or_sql(monkeypatch):
    captured = {}

    async def fake_llm(**kwargs):
        captured.update(kwargs)
        return "Dựa trên dữ liệu, kết quả là 123.", {"node": "answer_formatter", "latency_ms": 1}

    monkeypatch.setattr(af, "llm_call_text", fake_llm)

    state = {
        "normalized_question": "báo cáo tùy chỉnh",
        "guard_passed": True,
        "raw_result": [{"category": "A", "value": 123}],
        "template_key": None,
        "final_sql": "SELECT * FROM analytics.ai_sales_daily",
        "trace": [],
    }

    out = await af.answer_formatter(state)

    prompt = captured["user_prompt"]
    assert out["response_kind"] == "answer"
    assert "Answer facts JSON" in prompt
    assert "T03_revenue_by_category" not in prompt
    assert "SELECT *" not in prompt
    assert "Mẫu dữ liệu" not in prompt
