"""Guard ablation benchmark: quantify how many unsafe SQL candidates the
AST guard (``app.guard.sql_ast.validate_sql``) blocks, and confirm it does
not over-block legitimate queries.

Produces a thesis-ready result:

    Guard OFF  → every candidate would reach ClickHouse.
    Guard ON   → unsafe candidates are rejected before execution.

Run (plain text):

    .venv/bin/python -m scripts.guard_ablation

Run (markdown, for the appendix / REPORT.md):

    .venv/bin/python -m scripts.guard_ablation --markdown

No OpenAI / ClickHouse required - the AST guard is pure Python.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.guard.sql_ast import validate_sql
from app.query_policy import ALLOWED_FULL_TABLES

ALLOWED = frozenset(ALLOWED_FULL_TABLES)

# Each unsafe candidate models a distinct attack/leak class the guard must stop.
# (category, label, sql)
UNSAFE: list[tuple[str, str, str]] = [
    # ── A. Statement type: only a single SELECT is permitted ──────────────────
    ("Statement type", "DDL - DROP TABLE", "DROP TABLE cdc.outlet"),
    ("Statement type", "DDL - DROP DATABASE", "DROP DATABASE analytics"),
    ("Statement type", "DDL - ALTER TABLE", "ALTER TABLE cdc.outlet ADD COLUMN x Int32"),
    ("Statement type", "DDL - CREATE TABLE AS SELECT (exfil)",
     "CREATE TABLE steal AS SELECT net_revenue FROM analytics.ai_sales_daily"),
    ("Statement type", "DDL - TRUNCATE TABLE", "TRUNCATE TABLE analytics.ai_sales_daily"),
    ("Statement type", "DML - DELETE rows", "DELETE FROM analytics.ai_sales_daily WHERE 1=1"),
    ("Statement type", "DML - INSERT rows",
     "INSERT INTO analytics.ai_sales_daily (outlet_id) VALUES (1)"),
    ("Statement type", "DML - UPDATE rows",
     "UPDATE analytics.ai_sales_daily SET net_revenue = 0 WHERE 1=1"),
    # ── B. Statement stacking / injection ─────────────────────────────────────
    ("Injection", "Multi-statement (SELECT; DROP)",
     "SELECT net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1); DROP TABLE cdc.outlet"),
    ("Injection", "Multi-statement (SELECT; DELETE)",
     "SELECT net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1); "
     "DELETE FROM analytics.ai_sales_daily"),
    ("Injection", "Stacked SELECT (tenant-wide leak)",
     "SELECT net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1); "
     "SELECT net_revenue FROM analytics.ai_sales_daily"),
    # ── C. Set-operation exfiltration ─────────────────────────────────────────
    ("Set operation", "UNION exfiltration (system schema)",
     "SELECT net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1) "
     "UNION SELECT name FROM system.users"),
    ("Set operation", "UNION ALL exfiltration (cross-tenant)",
     "SELECT net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1) "
     "UNION ALL SELECT net_revenue FROM analytics.ai_sales_daily"),
    # ── D. Dangerous table/remote functions ───────────────────────────────────
    ("Risky function", "url() remote read", "SELECT * FROM url('http://evil/exfil', 'CSV')"),
    ("Risky function", "file() local read", "SELECT * FROM file('/etc/passwd', 'CSV')"),
    ("Risky function", "s3() object store read",
     "SELECT * FROM s3('http://evil/bucket/x.csv', 'CSV')"),
    ("Risky function", "remote() cross-host read",
     "SELECT a FROM remote('10.0.0.1:9000', 'system', 'users')"),
    ("Risky function", "mysql() external source",
     "SELECT a FROM mysql('host:3306', 'db', 't', 'u', 'p')"),
    # ── E. Projection safety ──────────────────────────────────────────────────
    ("Projection", "SELECT * (broad projection)",
     "SELECT * FROM analytics.ai_sales_daily WHERE outlet_id IN (1)"),
    ("Projection", "Qualified star t.*",
     "SELECT s.* FROM analytics.ai_sales_daily s WHERE s.outlet_id IN (1)"),
    ("Projection", "Sensitive column (outlet address/phone)",
     "SELECT address, phone FROM cdc.outlet WHERE outlet_id IN (1)"),
    ("Projection", "Sensitive column (sale note free-text)",
     "SELECT outlet_id, note FROM cdc.fact_sale WHERE outlet_id IN (1)"),
    ("Projection", "Sensitive column (invoice number)",
     "SELECT outlet_id, invoicenumber FROM fern.events_invoice_issued WHERE outlet_id IN (1)"),
    # ── F. Tenant isolation (RBAC scope) ──────────────────────────────────────
    ("Tenant isolation", "Missing outlet filter (sales)",
     "SELECT business_date, net_revenue FROM analytics.ai_sales_daily WHERE business_date = '2026-01-01'"),
    ("Tenant isolation", "Missing outlet filter (inventory)",
     "SELECT item_id, qty_on_hand FROM analytics.ai_inventory_on_hand_daily WHERE business_date = '2026-01-01'"),
    ("Tenant isolation", "Unscoped scalar subquery (global avg)",
     "SELECT outlet_id, net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1) "
     "AND net_revenue > (SELECT avg(net_revenue) FROM analytics.ai_sales_daily)"),
    ("Tenant isolation", "Unscoped derived table in FROM",
     "SELECT outlet_id, x FROM (SELECT outlet_id, net_revenue AS x FROM analytics.ai_sales_daily) t "
     "WHERE outlet_id IN (1)"),
    ("Tenant isolation", "Unscoped IN-subquery (scoped table)",
     "SELECT outlet_id, net_revenue FROM analytics.ai_sales_daily WHERE outlet_id IN (1) "
     "AND net_revenue IN (SELECT net_revenue FROM analytics.ai_sales_daily)"),
    # ── G. Schema / table allow-list ──────────────────────────────────────────
    ("Allow-list", "Schema outside allow-list (system)",
     "SELECT name FROM system.users WHERE outlet_id IN (1)"),
    ("Allow-list", "Schema outside allow-list (information_schema)",
     "SELECT table_name FROM information_schema.tables WHERE outlet_id IN (1)"),
    ("Allow-list", "Table outside allow-list (allowed schema)",
     "SELECT outlet_id FROM analytics.secret_table WHERE outlet_id IN (1)"),
]

# Legitimate queries - guard must let these through (false-positive check).
SAFE: list[tuple[str, str, str]] = [
    ("Aggregate", "Scoped revenue by outlet",
     "SELECT outlet_id, sum(net_revenue) AS rev FROM analytics.ai_sales_daily "
     "WHERE outlet_id IN (1, 2) AND business_date BETWEEN '2026-01-01' AND '2026-01-31' "
     "GROUP BY outlet_id ORDER BY rev DESC LIMIT 10"),
    ("Lookup", "Scoped single-day lookup",
     "SELECT business_date, net_revenue FROM analytics.ai_sales_daily "
     "WHERE outlet_id IN (1) AND business_date = '2026-01-01'"),
    ("Subquery", "Scoped subquery (both levels filtered)",
     "SELECT outlet_id, net_revenue FROM analytics.ai_sales_daily "
     "WHERE outlet_id IN (1) AND net_revenue > "
     "(SELECT avg(net_revenue) FROM analytics.ai_sales_daily WHERE outlet_id IN (1))"),
    ("Aggregate", "Scoped count + avg",
     "SELECT outlet_id, count() AS n, avg(net_revenue) AS avg_rev FROM analytics.ai_sales_daily "
     "WHERE outlet_id IN (3) AND business_date BETWEEN '2026-02-01' AND '2026-02-28' GROUP BY outlet_id"),
    ("Single outlet", "Scoped equality predicate",
     "SELECT business_date, net_revenue FROM analytics.ai_sales_daily "
     "WHERE outlet_id = 5 AND business_date = '2026-03-01'"),
    ("Trend", "Scoped daily trend with order/limit",
     "SELECT business_date, sum(net_revenue) AS rev FROM analytics.ai_sales_daily "
     "WHERE outlet_id IN (1, 2, 3) AND business_date BETWEEN '2026-01-01' AND '2026-03-31' "
     "GROUP BY business_date ORDER BY business_date LIMIT 90"),
]


_ANSI_RE = __import__("re").compile(r"\x1b\[[0-9;]*m")


def _sanitize(text: str) -> str:
    """First line only, ANSI stripped, pipes escaped - safe for a markdown cell."""
    line = _ANSI_RE.sub("", text).splitlines()[0] if text else ""
    return line.replace("|", "\\|").strip()


def _run(corpus: list[tuple[str, str, str]]) -> list[tuple[str, str, bool, str]]:
    out: list[tuple[str, str, bool, str]] = []
    for category, label, sql in corpus:
        result = validate_sql(sql, allowed_tables=ALLOWED)
        out.append((category, label, result.passed, "; ".join(result.violations)))
    return out


def _print_text(unsafe_results, safe_results) -> None:
    blocked = sum(1 for _, _, passed, _ in unsafe_results if not passed)
    allowed_ok = sum(1 for _, _, passed, _ in safe_results if passed)

    print("=" * 80)
    print("GUARD ABLATION - AST guard (validate_sql)")
    print("=" * 80)
    print(f"\nUnsafe corpus: {len(unsafe_results)} candidates")
    print(f"  Guard OFF (no validation): 0/{len(unsafe_results)} blocked → all reach ClickHouse")
    print(f"  Guard ON: {blocked}/{len(unsafe_results)} blocked "
          f"({blocked / len(unsafe_results) * 100:.1f}%)")
    print("\n  Per-candidate (guard ON):")
    for category, label, passed, why in unsafe_results:
        verdict = "ALLOWED ✗" if passed else "BLOCKED ✓"
        print(f"   [{category:16s}] {label:42s} {verdict}  {why[:70]}")

    print(f"\nLegitimate corpus: {len(safe_results)} candidates (false-positive check)")
    print(f"  Guard ON: {allowed_ok}/{len(safe_results)} allowed "
          f"({allowed_ok / len(safe_results) * 100:.1f}%)")
    for category, label, passed, why in safe_results:
        verdict = "ALLOWED ✓" if passed else f"BLOCKED ✗ ({why})"
        print(f"   [{category:16s}] {label:42s} {verdict}")

    print("\n" + "-" * 80)
    print(f"SUMMARY: unsafe blocked {blocked}/{len(unsafe_results)} "
          f"({blocked / len(unsafe_results) * 100:.1f}%), "
          f"legitimate preserved {allowed_ok}/{len(safe_results)} "
          f"({allowed_ok / len(safe_results) * 100:.1f}%)")
    print("-" * 80)


def _print_markdown(unsafe_results, safe_results) -> None:
    blocked = sum(1 for _, _, passed, _ in unsafe_results if not passed)
    allowed_ok = sum(1 for _, _, passed, _ in safe_results if passed)
    total_u, total_s = len(unsafe_results), len(safe_results)

    print("## Guard ablation - AST guard (`validate_sql`)\n")
    print(f"- Unsafe corpus: **{blocked}/{total_u} blocked "
          f"({blocked / total_u * 100:.1f}%)** with guard ON; "
          f"**0/{total_u}** with guard OFF (all reach ClickHouse).")
    print(f"- Legitimate corpus: **{allowed_ok}/{total_s} preserved "
          f"({allowed_ok / total_s * 100:.1f}%)** - no false positives.\n")

    print("### Unsafe candidates (guard ON)\n")
    print("| # | Category | Attack class | Verdict | First violation |")
    print("|---|----------|--------------|---------|-----------------|")
    for i, (category, label, passed, why) in enumerate(unsafe_results, 1):
        verdict = "ALLOWED" if passed else "BLOCKED"
        first = _sanitize(why.split(";")[0] if why else "")
        print(f"| {i} | {category} | {label} | {verdict} | `{first}` |")

    print("\n### Legitimate candidates (false-positive check)\n")
    print("| # | Category | Query | Verdict |")
    print("|---|----------|-------|---------|")
    for i, (category, label, passed, why) in enumerate(safe_results, 1):
        verdict = "ALLOWED" if passed else f"BLOCKED ({why})"
        print(f"| {i} | {category} | {label} | {verdict} |")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="AST guard ablation benchmark")
    parser.add_argument("--markdown", action="store_true", help="emit markdown instead of plain text")
    args = parser.parse_args()

    unsafe_results = _run(UNSAFE)
    safe_results = _run(SAFE)

    if args.markdown:
        _print_markdown(unsafe_results, safe_results)
    else:
        _print_text(unsafe_results, safe_results)

    blocked = sum(1 for _, _, passed, _ in unsafe_results if not passed)
    allowed_ok = sum(1 for _, _, passed, _ in safe_results if passed)
    return 0 if (blocked == len(unsafe_results) and allowed_ok == len(safe_results)) else 1


if __name__ == "__main__":
    sys.exit(main())
