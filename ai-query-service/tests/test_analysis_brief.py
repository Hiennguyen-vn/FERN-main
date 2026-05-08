"""Analysis brief derives grounded findings from raw query results."""

from app.graph.nodes.analysis_brief import analysis_brief


def test_analysis_brief_for_top_products_preserves_top_selling_subject():
    state = {
        "raw_question": "Top 10 sản phẩm bán chạy nhất tháng này?",
        "normalized_question": "Top 10 sản phẩm bán chạy nhất tháng này?",
        "intent": "product_mix",
        "template_key": "T04_top_products",
        "response_kind": "answer",
        "time_range": {"from_date": "2026-05-01", "to_date": "2026-05-02"},
        "raw_result": [
            {"product_name": "Com Chay", "qty": 91, "revenue": 2871000},
            {"product_name": "Com Bo Luc Lac", "qty": 51, "revenue": 3646500},
        ],
        "trace": [],
    }

    out = analysis_brief(state)
    brief = out["analysis_brief"]

    assert brief["subject"]["type"] == "top_selling_products"
    assert brief["subject"]["entities"][:2] == ["Com Chay", "Com Bo Luc Lac"]
    assert "bán chậm" in brief["guardrails"]["avoid_terms"]
    assert any("Com Chay" in item["claim"] for item in brief["findings"])
    assert any(item["metric"] == "qty" for item in brief["key_numbers"])


def test_analysis_brief_skips_clarification():
    state = {
        "response_kind": "clarification",
        "raw_result": [{"product_name": "Com Chay", "qty": 91}],
    }

    out = analysis_brief(state)

    assert "analysis_brief" not in out
