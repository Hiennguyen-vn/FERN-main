"""Unit tests for JSON-safe rows_preview helpers and query response shaping."""

from datetime import date, datetime
from decimal import Decimal

from app.main import QueryResponse, _jsonify_preview_value, _rows_preview_from_result


def test_query_response_model_roundtrip_optional_fields():
    r = QueryResponse(
        answer="OK",
        template_key="T01_daily_revenue",
        confidence=1.0,
        row_count=10,
        citations=[],
        correlation_id="c1",
        latency_ms=5,
        supervisor_intent="export_request",
        preview_max_rows=50,
        rows_preview=[{"a": 1}],
    )
    dumped = r.model_dump()
    assert dumped["supervisor_intent"] == "export_request"
    assert dumped["preview_max_rows"] == 50


def test_jsonify_scalar_and_collections():
    assert _jsonify_preview_value(None) is None
    assert _jsonify_preview_value("x") == "x"
    assert _jsonify_preview_value(3) == 3
    assert _jsonify_preview_value(True) is True
    d = datetime(2026, 5, 1, 14, 30, 0)
    assert _jsonify_preview_value(d) == "2026-05-01T14:30:00"
    assert _jsonify_preview_value(date(2026, 5, 1)) == "2026-05-01"
    assert _jsonify_preview_value(Decimal("12.34")) == 12.34
    assert _jsonify_preview_value(b"x") == "<binary>"


def test_jsonify_nested_dict_list():
    out = _jsonify_preview_value({"n": Decimal("1.5"), "d": [{"x": datetime(2026, 1, 1, 12, 0, 0)}]})
    assert out == {"n": 1.5, "d": [{"x": "2026-01-01T12:00:00"}]}


def test_jsonify_list_truncation():
    lst = list(range(100))
    truncated = _jsonify_preview_value(lst)
    assert len(truncated) == 80
    assert truncated[0] == 0
    assert truncated[-1] == 79


def test_rows_preview_respects_cap_and_returns_none_when_disabled():
    rows = [{"a": 1, "b": "x"}, {"a": Decimal("2.0"), "c": bytes([1])}]
    assert _rows_preview_from_result(rows, max_rows=0) is None
    assert _rows_preview_from_result(None, max_rows=5) is None
    assert _rows_preview_from_result([], max_rows=5) is None

    two = _rows_preview_from_result(rows, max_rows=5)
    assert two is not None
    assert len(two) == 2
    assert two[0] == {"a": 1, "b": "x"}
    assert two[1] == {"a": 2.0, "c": "<binary>"}

    one = _rows_preview_from_result(rows, max_rows=1)
    assert one == [{"a": 1, "b": "x"}]
