"""Optional golden-result checks.

Run with RUN_GOLDEN=1 when ClickHouse has seeded/demo data. These tests compare
executed results, not SQL text, so equivalent query formulations can pass.
"""

from __future__ import annotations

import os

import pytest

from app.clients.clickhouse import execute_query

pytestmark = pytest.mark.golden


GOLDEN_CASES = [
    {
        "name": "ai_sales_daily_required_columns",
        "ai_sql": """
            SELECT outlet_id, business_date, sum(net_revenue) AS net_revenue
            FROM analytics.ai_sales_daily
            WHERE outlet_id IN (2000)
            GROUP BY outlet_id, business_date
            ORDER BY business_date
            LIMIT 10
        """,
        "golden_sql": """
            SELECT outlet_id, business_date, sum(net_revenue) AS net_revenue
            FROM analytics.fct_sales_daily
            WHERE outlet_id IN (2000)
            GROUP BY outlet_id, business_date
            ORDER BY business_date
            LIMIT 10
        """,
        "tolerance": 0.01,
    }
]


def _rows_close(a: list[dict], b: list[dict], tolerance: float) -> bool:
    if len(a) != len(b):
        return False
    for ra, rb in zip(a, b, strict=True):
        if set(ra) != set(rb):
            return False
        for key in ra:
            va, vb = ra[key], rb[key]
            if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
                if abs(float(va) - float(vb)) > tolerance:
                    return False
            elif str(va) != str(vb):
                return False
    return True


@pytest.mark.skipif(os.getenv("RUN_GOLDEN") != "1", reason="set RUN_GOLDEN=1 to run ClickHouse golden tests")
@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["name"] for c in GOLDEN_CASES])
def test_golden_query_results(case):
    ai_rows = execute_query(case["ai_sql"])
    golden_rows = execute_query(case["golden_sql"])
    assert _rows_close(ai_rows, golden_rows, float(case["tolerance"]))
