from app.graph.nodes.doc_reader import doc_reader
from app.graph.nodes.visualizer import visualizer
import pytest


@pytest.mark.asyncio
async def test_doc_reader_answers_metric_definition_without_db():
    state = {
        "normalized_question": "doanh thu ròng là gì?",
        "intent": "lookup",
        "agent_route": "docs_question",
        "trace": [],
    }
    out = await doc_reader(state)
    assert out["response_kind"] == "answer"
    assert "net_revenue" in out["answer_text"]
    assert out["skip_answer_formatter_llm"] is True


def test_visualizer_builds_chart_spec_from_rows():
    state = {
        "normalized_question": "Vẽ biểu đồ doanh thu theo ngày",
        "raw_result": [
            {"business_date": "2026-05-01", "gross_revenue": 90, "net_revenue": 100, "txn_count": 12},
            {"business_date": "2026-05-02", "gross_revenue": 140, "net_revenue": 150, "txn_count": 18},
        ],
        "trace": [],
    }
    out = visualizer(state)
    assert out["chart_spec"]["type"] == "line"
    assert out["chart_spec"]["x"] == "business_date"
    assert out["chart_spec"]["y"] == "net_revenue"
    assert out["chart_spec"]["metric_label"] == "doanh thu ròng"


def test_visualizer_uses_transaction_metric_when_requested():
    state = {
        "normalized_question": "Vẽ biểu đồ số giao dịch theo ngày",
        "raw_result": [
            {"business_date": "2026-05-01", "net_revenue": 100, "txn_count": 12},
            {"business_date": "2026-05-02", "net_revenue": 150, "txn_count": 18},
        ],
        "trace": [],
    }
    out = visualizer(state)
    assert out["chart_spec"]["y"] == "txn_count"
