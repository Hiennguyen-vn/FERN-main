from unittest.mock import patch

from app.graph.tools import clickhouse_catalog as cc


def test_parse_allowed_rejects_unknown():
    assert cc.parse_allowed_full_table("system.tables") is None
    assert cc.parse_allowed_full_table("analytics.unknown_tbl") is None


def test_parse_allowed_accepts():
    assert cc.parse_allowed_full_table("analytics.fct_sales_daily") == ("analytics", "fct_sales_daily")


def test_tables_for_intent_respects_cap():
    assert cc.tables_for_intent("revenue", max_tables=1) == ["analytics.ai_sales_daily"]


@patch.object(cc, "execute_query")
def test_format_catalog_digest_uses_clickhouse(mock_eq):
    mock_eq.return_value = [{"name": "outlet_id", "type": "Int64"}, {"name": "revenue", "type": "Decimal(18,2)"}]
    text = cc.format_catalog_digest(
        "revenue",
        max_tables=1,
        max_columns_per_table=10,
        max_chars=8000,
    )
    assert "analytics.ai_sales_daily" in text
    assert "outlet_id" in text
    assert mock_eq.called


@patch.object(cc, "execute_query")
def test_format_catalog_digest_uses_question_domain_pack(mock_eq):
    mock_eq.return_value = [{"name": "payment_method", "type": "String"}, {"name": "revenue", "type": "Decimal(18,2)"}]

    text = cc.format_catalog_digest(
        "revenue",
        question="doanh thu theo phương thức thanh toán tháng này",
        max_tables=1,
        max_columns_per_table=10,
        max_chars=8000,
    )

    assert "analytics.ai_payment_daily" in text
    assert "analytics.ai_sales_daily" not in text
