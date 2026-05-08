"""Deterministic tools exposed to SQL Writer Agent via OpenAI function calling.

Each tool is a pure function (or thin wrapper around existing modules) that
returns JSON-serializable output. No LLM inside any tool — they are the
trust boundary the agent must use to access schema, policy, validation, and
execution.

Tools intentionally mirror the diagram (Finch-style):

- ``search_schema_tool``     ↔ OpenSearch metadata + catalog snapshot.
- ``get_table_policy_tool``  ↔ Flat Table Schema & Rules (TABLE_POLICIES).
- ``list_columns_tool``      ↔ ClickHouse system.columns (cached).
- ``validate_and_inject_tool`` ↔ AST guard + RBAC inject + EXPLAIN.
- ``execute_query_tool``     ↔ ClickHouse readonly with bounded settings.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import re
from typing import Any, Callable

import sqlglot
import yaml

from app.codegen.limit_clamp import clamp_outer_limit
from app.codegen.policy import check_codegen_finance_access
from app.codegen.rbac_inject import inject_outlet_filter
from app.codegen.rbac_policy import verify_outlet_in_clause
from app.config import get_settings
from app.guard.sql_ast import (
    extract_qualified_table_names,
    validate_sql,
    validate_sql_phase1,
)
from app.query_policy import (
    ALLOWED_FULL_TABLES,
    CODEGEN_TIME_FILTER_REQUIRED_TABLES,
    METRIC_DEFINITIONS,
    TABLE_POLICIES,
    candidate_tables_for_prompt,
    get_table_policy,
)
from app.rbac.policy import compute_allowed_outlets

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Tool:
    """OpenAI-compatible function tool descriptor.

    ``execute`` is the pure-Python implementation; ``schema`` is the
    JSON-schema fed to OpenAI for function calling.
    """

    name: str
    schema: dict[str, Any]
    execute: Callable[..., dict[str, Any]]


# -- search_schema -----------------------------------------------------------


def _search_schema(
    query: str,
    *,
    intent: str | None = None,
    max_tables: int = 8,
) -> dict[str, Any]:
    """Find candidate tables + metric definitions for a question slice.

    Reads from ``query_policy`` (single source of truth) plus a deterministic
    metric/value alias scan. Does not hit OpenSearch directly to keep the
    tool fast; OpenSearch metadata enrichment can be layered in later if
    measured useful.
    """

    candidates = candidate_tables_for_prompt(
        intent or "",
        question=query,
        max_tables=max_tables,
        include_fallbacks=True,
    )
    out_tables: list[dict[str, Any]] = []
    for full in candidates:
        policy = TABLE_POLICIES.get(full)
        if not policy:
            continue
        out_tables.append(
            {
                "name": full,
                "outlet_column": policy.outlet_column,
                "time_column": policy.time_column,
                "grain": policy.grain,
                "metrics": list(policy.metrics),
                "lookup_only": policy.lookup_only,
                "role_group": policy.role_group,
                "description_vi": policy.description_vi,
            }
        )

    # Match metric definitions by simple substring / synonym hits.
    q_low = query.lower()
    q_tokens = [t for t in q_low.split() if len(t) >= 3]
    metric_hits: list[dict[str, Any]] = []
    for metric in METRIC_DEFINITIONS:
        canonical = str(metric.get("canonical_name", ""))
        aliases = metric.get("aliases", ()) or ()
        haystack = " ".join([canonical, *aliases]).lower()
        if any(token and token in haystack for token in q_tokens):
            metric_hits.append(
                {
                    "canonical_name": canonical,
                    "aliases": list(aliases),
                    "preferred_table": metric.get("preferred_table"),
                    "definition_vi": metric.get("definition_vi", ""),
                    "role_group": metric.get("role_group"),
                }
            )
        if len(metric_hits) >= 6:
            break

    return {"tables": out_tables, "metrics": metric_hits}


search_schema_tool = Tool(
    name="search_schema",
    schema={
        "type": "function",
        "function": {
            "name": "search_schema",
            "description": (
                "Find candidate ClickHouse tables and metric definitions for a "
                "natural-language slice. Returns a curated list constrained to "
                "the allow-list. Use BEFORE writing SQL to discover relevant "
                "tables, time columns, and metric IDs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Free-text question slice or metric phrase.",
                    },
                    "intent": {
                        "type": "string",
                        "description": "Optional intent hint (revenue, inventory, pnl, ...).",
                    },
                    "max_tables": {"type": "integer", "minimum": 1, "maximum": 16, "default": 8},
                },
                "required": ["query"],
            },
        },
    },
    execute=_search_schema,
)


# -- get_table_policy --------------------------------------------------------


def _get_table_policy(table_name: str) -> dict[str, Any]:
    """Return the policy contract for a single table."""

    policy = get_table_policy(table_name)
    if not policy:
        return {
            "ok": False,
            "error": f"table {table_name!r} is not in ALLOWED_FULL_TABLES",
            "allow_listed": False,
        }
    return {
        "ok": True,
        "allow_listed": True,
        "name": policy.full_name,
        "outlet_column": policy.outlet_column,
        "time_column": policy.time_column,
        "grain": policy.grain,
        "metrics": list(policy.metrics),
        "lookup_only": policy.lookup_only,
        "role_group": policy.role_group,
        "description_vi": policy.description_vi,
        "time_filter_required": policy.full_name in CODEGEN_TIME_FILTER_REQUIRED_TABLES,
    }


get_table_policy_tool = Tool(
    name="get_table_policy",
    schema={
        "type": "function",
        "function": {
            "name": "get_table_policy",
            "description": (
                "Look up the AI-facing contract for a single allow-listed "
                "ClickHouse table: outlet_column, time_column, grain, metrics, "
                "role_group, lookup_only flag. Use to confirm a table is safe "
                "and to discover the correct time/scope columns before writing "
                "WHERE clauses."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {
                        "type": "string",
                        "description": "Fully-qualified table name (schema.table), lowercase.",
                    }
                },
                "required": ["table_name"],
            },
        },
    },
    execute=_get_table_policy,
)


# -- list_columns ------------------------------------------------------------


@lru_cache(maxsize=1)
def _catalog_snapshot_columns() -> dict[str, list[dict[str, str]]]:
    """Columns parsed from the checked-in catalog snapshot for shadow runs."""

    path = Path(__file__).resolve().parents[2] / "knowledge" / "catalog_snapshot.yaml"
    if not path.exists():
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("catalog snapshot fallback unavailable: %s", exc)
        return {}

    if isinstance(raw, dict):
        rows = raw.get("snapshots") or []
    else:
        rows = raw

    out: dict[str, list[dict[str, str]]] = {}
    for item in rows:
        if not isinstance(item, dict):
            continue
        table = str(item.get("full_table") or "").strip()
        summary = str(item.get("summary_vi") or "")
        if not table:
            continue
        cols: list[dict[str, str]] = []
        for line in summary.splitlines():
            match = re.match(r"\s*-\s+([A-Za-z_][\w]*)\s*:\s*(.+?)\s*$", line)
            if match:
                cols.append({"name": match.group(1), "type": match.group(2).strip()})
        if cols:
            out[table] = cols
    return out


def _list_columns(table_name: str) -> dict[str, Any]:
    """Return ClickHouse columns for a table from system.columns (cached).

    Falls back to a static empty list if ClickHouse is unreachable so the
    agent can keep going on the policy contract alone.
    """

    if table_name not in ALLOWED_FULL_TABLES:
        return {"ok": False, "error": f"table {table_name!r} not allow-listed", "columns": []}

    try:
        from app.clients.clickhouse import execute_query

        db, _, name = table_name.partition(".")
        rows = execute_query(
            "SELECT name, type FROM system.columns "
            f"WHERE database = '{db}' AND table = '{name}' "
            "ORDER BY position LIMIT 200"
        )
        cols = [{"name": str(r["name"]), "type": str(r["type"])} for r in rows]
        return {"ok": True, "columns": cols}
    except Exception as exc:  # noqa: BLE001
        logger.warning("list_columns failed for %s: %s", table_name, exc)
        cols = _catalog_snapshot_columns().get(table_name, [])
        if cols:
            return {
                "ok": True,
                "source": "catalog_snapshot",
                "warning": f"clickhouse unavailable: {exc}",
                "columns": cols,
            }
        return {"ok": False, "error": f"clickhouse: {exc}", "columns": []}


list_columns_tool = Tool(
    name="list_columns",
    schema={
        "type": "function",
        "function": {
            "name": "list_columns",
            "description": (
                "List columns and types for an allow-listed ClickHouse table "
                "(system.columns). Use only when policy/grain doesn't tell you "
                "which column to project — keep calls cheap."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string", "description": "schema.table"}
                },
                "required": ["table_name"],
            },
        },
    },
    execute=_list_columns,
)


# -- validate_and_inject -----------------------------------------------------


@dataclass
class ValidateContext:
    """Context the agent can't see but the tool needs (auth, candidate pack)."""

    auth_outlet_ids: frozenset[int]
    auth_roles: frozenset[str]
    candidate_tables: frozenset[str]
    requested_outlet_ids: list[int]
    all_outlet_ids_provider: Callable[[], list[int]] | None


def make_validate_and_inject_tool(ctx: ValidateContext) -> Tool:
    """Bind validation context (auth/candidate pack) into a Tool instance."""

    def _validate_and_inject(sql: str) -> dict[str, Any]:
        sql = (sql or "").strip().rstrip(";")
        errors: list[str] = []
        if not sql:
            return {"ok": False, "errors": ["empty SQL"], "final_sql": None}

        # Phase 1: structure + allow-list + time-filter requirements
        r1 = validate_sql_phase1(
            sql,
            allowed_tables=ALLOWED_FULL_TABLES,
            require_time_filter_tables=CODEGEN_TIME_FILTER_REQUIRED_TABLES,
        )
        if not r1.passed:
            errors.extend(r1.violations)

        # Tables must be inside the candidate pack the supervisor selected.
        try:
            ast = sqlglot.parse_one(sql, dialect="clickhouse")
            qt = extract_qualified_table_names(ast)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "errors": [*errors, f"AST parse failed: {exc}"], "final_sql": None}

        if ctx.candidate_tables and not qt.issubset(ctx.candidate_tables):
            outside = sorted(qt - ctx.candidate_tables)
            errors.append(
                f"Tables outside candidate pack: {outside}. "
                f"Allowed: {sorted(ctx.candidate_tables)[:8]}"
            )

        # Finance role gate
        ok_fin, fin_msg = check_codegen_finance_access(qt, ctx.auth_roles)
        if not ok_fin and fin_msg:
            errors.append(fin_msg)

        if errors:
            return {"ok": False, "errors": errors, "final_sql": None}

        # RBAC inject
        try:
            allowed = compute_allowed_outlets(
                auth_outlet_ids=ctx.auth_outlet_ids,
                requested_outlet_ids=ctx.requested_outlet_ids,
                roles=ctx.auth_roles,
                all_outlet_ids_provider=ctx.all_outlet_ids_provider,
            )
        except ValueError as exc:
            return {"ok": False, "errors": [f"RBAC: {exc}"], "final_sql": None}

        try:
            injected = inject_outlet_filter(sql, allowed)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "errors": [f"RBAC inject: {exc}"], "final_sql": None}

        s = get_settings()
        cap = min(s.codegen_max_outer_limit, s.max_rows_per_query)
        injected = clamp_outer_limit(injected, cap)

        ok_in, why = verify_outlet_in_clause(injected, allowed)
        if not ok_in:
            return {"ok": False, "errors": [f"RBAC verify: {why}"], "final_sql": None}

        # Phase 2: full guard (subqueries, lookup-only rules, etc.)
        r2 = validate_sql(injected, allowed_tables=ALLOWED_FULL_TABLES)
        if not r2.passed:
            return {"ok": False, "errors": list(r2.violations), "final_sql": None}

        # EXPLAIN PIPELINE — bounded; failure surfaces here for self-correction.
        try:
            from app.clients.clickhouse import explain_pipeline, explain_syntax

            ok_syn, syn_err = explain_syntax(injected)
            if not ok_syn:
                return {"ok": False, "errors": [f"EXPLAIN SYNTAX: {syn_err}"], "final_sql": None}
            ok_pipe, pipe_err = explain_pipeline(injected, max_execution_seconds=5.0)
            if not ok_pipe:
                return {"ok": False, "errors": [f"EXPLAIN PIPELINE: {pipe_err}"], "final_sql": None}
        except Exception as exc:  # noqa: BLE001
            logger.warning("EXPLAIN unavailable, skipping (dev/test): %s", exc)

        return {
            "ok": True,
            "errors": [],
            "final_sql": injected,
            "allowed_outlet_ids": allowed,
            "tables_used": sorted(qt),
        }

    return Tool(
        name="validate_and_inject",
        schema={
            "type": "function",
            "function": {
                "name": "validate_and_inject",
                "description": (
                    "Validate a candidate SELECT against AST allow-list, finance "
                    "role policy, candidate-table pack, and time-filter rules; "
                    "then programmatically inject the user's RBAC outlet filter, "
                    "clamp LIMIT, and run EXPLAIN PIPELINE. Returns ok=true with "
                    "final_sql ready to execute, or ok=false with error messages "
                    "to fix in the next attempt. Always call this before "
                    "execute_query."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string", "description": "Single SELECT, no CTE/UNION."}
                    },
                    "required": ["sql"],
                },
            },
        },
        execute=_validate_and_inject,
    )


# Sentinel exposed for type checkers / __init__ — replaced at runtime by
# ``make_validate_and_inject_tool``.
validate_and_inject_tool = Tool(
    name="validate_and_inject",
    schema={"type": "function", "function": {"name": "validate_and_inject"}},
    execute=lambda sql: {"ok": False, "errors": ["context not bound"], "final_sql": None},
)


# -- execute_query -----------------------------------------------------------


@dataclass
class ExecuteContext:
    """Per-call execution context (kept tiny so the LLM can't override caps)."""

    max_rows: int
    max_execution_seconds: float


def make_execute_query_tool(ctx: ExecuteContext) -> Tool:
    def _execute_query(sql: str) -> dict[str, Any]:
        try:
            from app.clients.clickhouse import execute_query_with_settings

            rows = execute_query_with_settings(
                sql,
                settings={
                    "max_result_rows": ctx.max_rows,
                    "max_execution_time": ctx.max_execution_seconds,
                    "result_overflow_mode": "break",
                },
            )
            return {"ok": True, "row_count": len(rows), "rows": rows}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)[:400], "rows": []}

    return Tool(
        name="execute_query",
        schema={
            "type": "function",
            "function": {
                "name": "execute_query",
                "description": (
                    "Run the validated SQL on ClickHouse readonly with bounded "
                    "row/time caps. Only call AFTER validate_and_inject returns "
                    "ok=true; pass its final_sql verbatim."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"sql": {"type": "string"}},
                    "required": ["sql"],
                },
            },
        },
        execute=_execute_query,
    )


execute_query_tool = Tool(
    name="execute_query",
    schema={"type": "function", "function": {"name": "execute_query"}},
    execute=lambda sql: {"ok": False, "error": "context not bound", "rows": []},
)
