"""Grading harness for the agent pipeline.

Each case is run through ``app.agents.build_agent_graph`` (or, for the
local mode, just the supervisor + sql_writer dispatch) and compared
against ``GoldenCase`` expectations. Results are aggregated into a
report payload that doubles as an OpenAI Evals artifact:

    {
      "case_id": "...",
      "passed": true,
      "axes": {"route": true, "template_key": true, ...},
      "actual": {"route": "...", "template_key": "...", ...},
      "diagnostics": {"trace_tail": [...], "error": null}
    }

Axis catalogue
--------------
route           — supervisor lane decision matches expectation.
intent          — supervisor intent label matches.
template_key    — when expected, the same template fires.
tables_subset   — generated SQL only touches expected tables (superset check).
sql_presence    — bool(final_sql) == expects_sql.
no_execute_error — execution did not raise.
rows_equiv      — (full mode only) executed result row-count matches golden_sql
                  within ``case.tolerance`` (default ±1%). Requires
                  ``case.golden_sql`` to be set AND ClickHouse to be reachable.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from app.evals.golden_cases import GoldenCase

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class GradeResult:
    case_id: str
    passed: bool
    axes: dict[str, bool] = field(default_factory=dict)
    actual: dict[str, Any] = field(default_factory=dict)
    expected: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0
    tokens: dict[str, int] = field(default_factory=dict)
    sprint_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _tables_used_from_state(state: dict[str, Any]) -> list[str]:
    """Return tables touched by the executed SQL, lowercase + sorted."""
    tables = state.get("codegen_tables_used") or []
    if not tables and state.get("template_key"):
        # Best-effort: we don't have AST here without re-parsing; trust the
        # supervisor's expected_tables_subset to cover template lane.
        return []
    return [str(t).lower() for t in tables]


def _accumulate_tokens(state: dict[str, Any]) -> dict[str, int]:
    out = {"in": 0, "out": 0, "cached": 0}
    for entry in state.get("trace") or []:
        if isinstance(entry, dict):
            out["in"] += int(entry.get("tokens_in") or 0)
            out["out"] += int(entry.get("tokens_out") or 0)
            out["cached"] += int(entry.get("tokens_cached") or 0)
    return out


def _rows_equiv(
    actual_rows: list[Any],
    golden_sql: str,
    tolerance: float,
) -> tuple[bool, str]:
    """Execute ``golden_sql`` against ClickHouse and compare row counts.

    Returns ``(passed, reason_string)``.  Never raises — any connection error
    returns ``(False, reason)`` so the axis fails gracefully.
    """
    try:
        from app.clients.clickhouse import execute_query

        golden_rows = execute_query(golden_sql)
        n_actual = len(actual_rows)
        n_golden = len(golden_rows)
        if n_golden == 0:
            ok = n_actual == 0
            return ok, f"golden=0 actual={n_actual}"
        delta = abs(n_actual - n_golden) / n_golden
        ok = delta <= tolerance
        return ok, f"golden={n_golden} actual={n_actual} delta={delta:.2%} tol={tolerance:.2%}"
    except Exception as exc:  # noqa: BLE001
        return False, f"rows_equiv error: {exc}"


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------


def grade_case(
    case: GoldenCase,
    state: dict[str, Any],
    duration_ms: int,
    *,
    enable_rows_equiv: bool = False,
) -> GradeResult:
    """Compare the final ``state`` against ``case`` expectations.

    Args:
        case: the golden test case.
        state: final graph state dict returned by the agent.
        duration_ms: wall-clock time for the agent invocation.
        enable_rows_equiv: when True and ``case.golden_sql`` is set, run the
            ``rows_equiv`` axis by executing the golden SQL against ClickHouse.
    """
    actual_route = state.get("agent_route") or state.get("social_kind") or "unknown"
    actual_intent = state.get("intent")
    actual_response_kind = state.get("response_kind")
    actual_template = state.get("template_key")
    actual_tables = _tables_used_from_state(state)
    has_sql = bool(state.get("final_sql"))
    exec_error = state.get("execution_error")
    actual_rows = state.get("raw_result") or []

    axes: dict[str, bool] = {}
    axes["route"] = actual_route == case.expected_route
    if case.expected_intent:
        axes["intent"] = actual_intent == case.expected_intent
    if case.expected_response_kind:
        axes["response_kind"] = actual_response_kind == case.expected_response_kind
    if case.expected_template_key is not None:
        axes["template_key"] = actual_template == case.expected_template_key
    if case.expected_tables_subset:
        expected_set = {t.lower() for t in case.expected_tables_subset}
        axes["tables_subset"] = (
            (set(actual_tables) >= expected_set) if actual_tables else True
        )
    axes["sql_presence"] = has_sql == case.expects_sql
    if case.expects_sql:
        axes["no_execute_error"] = not exec_error
    if "codegen" in case.tags and case.expects_sql:
        trace = state.get("trace") or []
        saw_sql_writer = any(
            isinstance(entry, dict)
            and entry.get("node") == "sql_writer_agent"
            and not entry.get("skipped")
            for entry in trace
        )
        axes["codegen_path"] = (
            actual_template is None
            and (
                state.get("executed_sql_source") == "codegen"
                or state.get("sql_source") == "codegen"
                or saw_sql_writer
            )
        )

    rows_equiv_note: str = ""
    if enable_rows_equiv and case.golden_sql and has_sql:
        ok, rows_equiv_note = _rows_equiv(actual_rows, case.golden_sql, case.tolerance)
        axes["rows_equiv"] = ok

    passed = all(axes.values())

    # Collect tags that look like sprint labels (e.g. "L0", "L4", "sprint2")
    sprint_tags = [t for t in case.tags if t.startswith(("L", "sprint"))]

    diagnostics: dict[str, Any] = {
        "trace_tail": (state.get("trace") or [])[-5:],
        "clarification_question": state.get("clarification_question"),
        "final_sql_snippet": (state.get("final_sql") or "")[:400] if has_sql else None,
    }
    if rows_equiv_note:
        diagnostics["rows_equiv_detail"] = rows_equiv_note
    if exec_error:
        diagnostics["execution_error"] = exec_error

    return GradeResult(
        case_id=case.id,
        passed=passed,
        axes=axes,
        actual={
            "route": actual_route,
            "intent": actual_intent,
            "response_kind": actual_response_kind,
            "template_key": actual_template,
            "tables_used": actual_tables,
            "has_sql": has_sql,
            "execution_error": exec_error,
            "rows_count": len(actual_rows),
        },
        expected={
            "route": case.expected_route,
            "intent": case.expected_intent,
            "response_kind": case.expected_response_kind,
            "template_key": case.expected_template_key,
            "tables_subset": list(case.expected_tables_subset),
            "expects_sql": case.expects_sql,
            "has_golden_sql": bool(case.golden_sql),
        },
        diagnostics=diagnostics,
        duration_ms=duration_ms,
        tokens=_accumulate_tokens(state),
        sprint_tags=list(sprint_tags),
    )


# ---------------------------------------------------------------------------
# Suite runner
# ---------------------------------------------------------------------------


async def run_eval_suite(
    cases: list[GoldenCase] | tuple[GoldenCase, ...],
    *,
    invoke_agent: Callable[[GoldenCase], Any],
    enable_rows_equiv: bool = False,
) -> dict[str, Any]:
    """Run every case via ``invoke_agent`` (an async coroutine factory).

    ``invoke_agent(case)`` must return the final graph ``state`` dict.
    Returns an OpenAI-Evals-compatible report with per-case results plus
    aggregated pass rate per axis, layer breakdown, and token usage totals.

    Args:
        cases: list or tuple of GoldenCase to run.
        invoke_agent: async callable that runs the agent and returns state.
        enable_rows_equiv: forward to grade_case; activates ClickHouse comparison.
    """
    results: list[GradeResult] = []
    for case in cases:
        t0 = time.time()
        try:
            state = await invoke_agent(case)
        except Exception as exc:  # noqa: BLE001
            logger.exception("eval crash on case %s: %s", case.id, exc)
            state = {
                "trace": [{"node": "harness", "error": str(exc)[:200]}],
                "agent_route": "error",
                "execution_error": f"{type(exc).__name__}: {exc}",
            }
        dur = int((time.time() - t0) * 1000)
        results.append(grade_case(case, state, dur, enable_rows_equiv=enable_rows_equiv))

    total = len(results)
    passed_count = sum(1 for r in results if r.passed)

    # Per-axis pass rates
    axis_totals: dict[str, list[int]] = {}
    for r in results:
        for axis, ok in r.axes.items():
            seen, hit = axis_totals.setdefault(axis, [0, 0])
            seen += 1
            if ok:
                hit += 1
            axis_totals[axis] = [seen, hit]
    axis_pass_rates = {
        axis: round(hit / seen, 4) if seen else 0.0
        for axis, (seen, hit) in axis_totals.items()
    }

    # Per-layer breakdown (by sprint_tags)
    layer_totals: dict[str, list[int]] = {}
    for r in results:
        for tag in r.sprint_tags:
            seen, hit = layer_totals.setdefault(tag, [0, 0])
            seen += 1
            if r.passed:
                hit += 1
            layer_totals[tag] = [seen, hit]
    layer_pass_rates = {
        layer: round(hit / seen, 4) if seen else 0.0
        for layer, (seen, hit) in layer_totals.items()
    }

    # Aggregate token usage
    total_tokens = {"in": 0, "out": 0, "cached": 0}
    for r in results:
        for k in total_tokens:
            total_tokens[k] += r.tokens.get(k, 0)
    cache_hit_rate = (
        round(total_tokens["cached"] / total_tokens["in"], 4)
        if total_tokens["in"] > 0
        else 0.0
    )

    return {
        "summary": {
            "total": total,
            "passed": passed_count,
            "pass_rate": round(passed_count / total, 4) if total else 0.0,
            "axis_pass_rates": axis_pass_rates,
            "layer_pass_rates": layer_pass_rates,
            "p50_latency_ms": _percentile([r.duration_ms for r in results], 0.5),
            "p95_latency_ms": _percentile([r.duration_ms for r in results], 0.95),
            "total_tokens": total_tokens,
            "cache_hit_rate": cache_hit_rate,
        },
        "results": [r.to_dict() for r in results],
    }


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))
    return s[idx]


def report_to_jsonl(report: dict[str, Any]) -> str:
    """OpenAI Evals JSONL: one record per item, plus a leading summary line."""
    lines: list[str] = []
    lines.append(json.dumps({"type": "summary", **report["summary"]}, ensure_ascii=False))
    for r in report["results"]:
        lines.append(
            json.dumps(
                {
                    "type": "result",
                    "item": {"id": r["case_id"]},
                    "expected": r["expected"],
                    "output": r["actual"],
                    "passed": r["passed"],
                    "axes": r["axes"],
                    "duration_ms": r["duration_ms"],
                    "tokens": r["tokens"],
                    "sprint_tags": r.get("sprint_tags", []),
                    "diagnostics": r["diagnostics"],
                },
                ensure_ascii=False,
            )
        )
    return "\n".join(lines) + "\n"
