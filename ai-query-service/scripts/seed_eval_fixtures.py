"""Seed minimal ClickHouse data for Sprint 3 full-mode eval (rows_equiv axis).

This script inserts deterministic fixture rows into a **test** ClickHouse
namespace so that ``--mode full`` can compare agent SQL results against
``golden_sql`` values in ``GoldenCase``.

IMPORTANT: never run against production. The script checks that
``CLICKHOUSE_DB`` ends with ``_test`` or ``_eval`` before inserting.

Usage::

    # Assumes ClickHouse is reachable via env vars
    python scripts/seed_eval_fixtures.py

    # Or override DB:
    CLICKHOUSE_HOST=localhost CLICKHOUSE_DB=fern_eval python scripts/seed_eval_fixtures.py

Tables seeded
-------------
- analytics.ai_sales_daily         (15 rows: outlets 1-3, dates 2026-04-01..05)
- analytics.ai_product_daily       (30 rows: 2 products × outlets 1-3 × 5 dates)
- analytics.ai_payment_daily       (15 rows: cash+card split for outlets 1-3 × 5 dates)
- analytics.ai_pnl_daily           (15 rows: pnl for outlets 1-3 × 5 dates)
- analytics.fct_inventory_snapshot (15 rows: 3 items × 5 dates for outlet 1)
- cdc.outlet                       (3 rows: outlet 1-3)
- cdc.product                      (2 rows: products)
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Validate we're not touching prod
_DB = os.getenv("CLICKHOUSE_DB", "fern")
if not (_DB.endswith("_test") or _DB.endswith("_eval")):
    print(
        f"[seed] ABORT: CLICKHOUSE_DB={_DB!r} does not end with _test or _eval.\n"
        "  Set CLICKHOUSE_DB=fern_eval to proceed.",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from app.clients.clickhouse import get_client
except ImportError as exc:
    print(f"[seed] cannot import clickhouse client: {exc}", file=sys.stderr)
    sys.exit(1)


# ── date range ────────────────────────────────────────────────────────────────
_START = date(2026, 4, 1)
_DATES = [_START + timedelta(days=i) for i in range(5)]  # 2026-04-01 .. 2026-04-05
_OUTLETS = [1, 2, 3]
_PRODUCTS = [101, 102]
_PAYMENT_METHODS = ["cash", "card"]


# ── helpers ───────────────────────────────────────────────────────────────────
def _insert(client, table: str, rows: list[dict]) -> None:
    client.insert(table, rows)
    print(f"  [seed] {table}: inserted {len(rows)} rows")


def _d(d: date) -> str:
    return d.isoformat()


# ── fixtures ──────────────────────────────────────────────────────────────────
def seed_ai_sales_daily(client) -> None:
    rows = []
    for outlet_id in _OUTLETS:
        for day in _DATES:
            rows.append(
                {
                    "business_date": _d(day),
                    "outlet_id": outlet_id,
                    "gross_revenue": 1_000_000.0 * outlet_id * (1 + _DATES.index(day) * 0.05),
                    "net_revenue": 950_000.0 * outlet_id * (1 + _DATES.index(day) * 0.05),
                    "txn_count": 100 * outlet_id + _DATES.index(day),
                    "avg_basket_size": 9_500.0,
                    "cancellation_rate": 0.02,
                }
            )
    _insert(client, "analytics.ai_sales_daily", rows)


def seed_ai_product_daily(client) -> None:
    rows = []
    for outlet_id in _OUTLETS:
        for product_id in _PRODUCTS:
            for day in _DATES:
                rows.append(
                    {
                        "business_date": _d(day),
                        "outlet_id": outlet_id,
                        "product_id": product_id,
                        "revenue": 250_000.0 * product_id,
                        "qty": 50 * product_id,
                        "txn_count": 25,
                    }
                )
    _insert(client, "analytics.ai_product_daily", rows)


def seed_ai_payment_daily(client) -> None:
    rows = []
    for outlet_id in _OUTLETS:
        for day in _DATES:
            for method in _PAYMENT_METHODS:
                rows.append(
                    {
                        "business_date": _d(day),
                        "outlet_id": outlet_id,
                        "payment_method": method,
                        "revenue": 475_000.0 * outlet_id,
                        "txn_count": 50 * outlet_id,
                    }
                )
    _insert(client, "analytics.ai_payment_daily", rows)


def seed_ai_pnl_daily(client) -> None:
    rows = []
    for outlet_id in _OUTLETS:
        for day in _DATES:
            net_rev = 950_000.0 * outlet_id
            cogs = net_rev * 0.45
            payroll = net_rev * 0.15
            rows.append(
                {
                    "business_date": _d(day),
                    "outlet_id": outlet_id,
                    "revenue": net_rev,
                    "cogs": cogs,
                    "payroll_cost": payroll,
                    "operating_profit": net_rev - cogs - payroll,
                    "operating_margin": (net_rev - cogs - payroll) / net_rev,
                }
            )
    _insert(client, "analytics.ai_pnl_daily", rows)


def seed_fct_inventory_snapshot(client) -> None:
    items = [1001, 1002, 1003]
    rows = []
    for item_id in items:
        for day in _DATES:
            rows.append(
                {
                    "business_date": _d(day),
                    "outlet_id": 1,
                    "item_id": item_id,
                    "qty_on_hand": max(0, 100 - 5 * _DATES.index(day)),
                }
            )
    _insert(client, "analytics.fct_inventory_snapshot", rows)


def seed_cdc_outlet(client) -> None:
    rows = [
        {"outlet_id": 1, "outlet_code": "OTL-001", "name": "Hà Nội 1", "status": "active"},
        {"outlet_id": 2, "outlet_code": "OTL-002", "name": "Hà Nội 2", "status": "active"},
        {"outlet_id": 3, "outlet_code": "OTL-003", "name": "HCM 1", "status": "active"},
    ]
    _insert(client, "cdc.outlet", rows)


def seed_cdc_product(client) -> None:
    rows = [
        {"product_id": 101, "product_code": "PRD-101", "name": "Cà phê sữa", "category_code": "DRINK"},
        {"product_id": 102, "product_code": "PRD-102", "name": "Bánh mì", "category_code": "FOOD"},
    ]
    _insert(client, "cdc.product", rows)


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    print(f"[seed] target DB: {_DB}  host: {os.getenv('CLICKHOUSE_HOST', 'localhost')}")
    client = get_client()
    seed_ai_sales_daily(client)
    seed_ai_product_daily(client)
    seed_ai_payment_daily(client)
    seed_ai_pnl_daily(client)
    seed_fct_inventory_snapshot(client)
    seed_cdc_outlet(client)
    seed_cdc_product(client)
    print("[seed] done. Run: RUN_GOLDEN=1 AGENT_MODE_ENABLED=true python -m scripts.run_openai_evals --mode full")


if __name__ == "__main__":
    main()
