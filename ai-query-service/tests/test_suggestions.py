"""Follow-up suggestion heuristics."""

from app.agents.suggestions import _suggest_for_state


def test_top_products_suggestions_do_not_call_them_slow_moving():
    state = {
        "intent": "product_mix",
        "response_kind": "answer",
        "template_key": "T04_top_products",
        "normalized_question": "Top 10 sản phẩm bán chạy nhất tháng này?",
        "raw_result": [{"product_name": "Ca Phe Den", "qty": 91}],
        "analysis_brief": {
            "subject": {"type": "top_selling_products", "entities": ["Ca Phe Den", "Com Chay"]},
            "findings": [
                {"claim": "Ca Phe Den dẫn đầu theo số lượng bán", "evidence": ["Ca Phe Den: 91 đơn vị"]}
            ],
            "guardrails": {"avoid_terms": ["bán chậm", "slow-moving"], "must_preserve_subject": True},
        },
    }

    suggestions = _suggest_for_state(state, 3)

    assert suggestions
    assert all("bán chậm" not in item.lower() for item in suggestions)
    assert any("Ca Phe Den" in item for item in suggestions)


def test_slow_moving_products_suggestions_keep_slow_context():
    state = {
        "intent": "product_mix",
        "response_kind": "answer",
        "template_key": "T19_slow_moving_products",
        "normalized_question": "Sản phẩm bán chậm tháng này",
        "raw_result": [{"product_name": "Tra Tac", "qty": 2}],
        "analysis_brief": {
            "subject": {"type": "slow_moving_products", "entities": ["Tra Tac"]},
            "findings": [{"claim": "Tra Tac bán thấp nhất", "evidence": ["Tra Tac: 2 đơn vị"]}],
            "guardrails": {"avoid_terms": [], "must_preserve_subject": True},
        },
    }

    suggestions = _suggest_for_state(state, 3)

    assert suggestions
    assert any("bán chậm" in item.lower() for item in suggestions)


def test_lookup_suggestions_are_suppressed():
    state = {
        "intent": "lookup",
        "response_kind": "answer",
        "template_key": "T37_ai_sales_daily_outlets",
        "raw_result": [{"outlet_name": "Outlet 1", "net_revenue": 10}],
        "analysis_brief": {
            "subject": {"type": "lookup", "entities": ["Outlet 1"]},
            "guardrails": {},
        },
    }

    assert _suggest_for_state(state, 3) == []
