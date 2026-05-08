"""Registry-driven DB coverage snapshot for time-aware answers/prompts."""

from __future__ import annotations

from datetime import date, timedelta
import logging
import re
import time
from typing import Any

from app.clients import postgres as pg
from app.clients.clickhouse import execute_query
from app.graph.state import GraphState
from app.query_policy import (
    DATA_SOURCE_POLICIES,
    QUERY_DOMAINS,
    TABLE_POLICIES,
    DataSourcePolicy,
    dataset_for_template,
    domain_keys_for_question,
    get_data_source_policy,
)

logger = logging.getLogger(__name__)

_TTL_SECONDS = 300
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_METRIC_DATASET_HINTS: dict[str, tuple[str, ...]] = {
    "supplier_invoice_approved": ("fern.events_invoice_approved",),
    "invoice_issued": ("fern.events_invoice_issued",),
    "goods_receipt": ("fern.events_goods_receipt_posted",),
    "expense_breakdown": ("fern.events_expense_created",),
    "payment_capture": ("fern.events_payment_captured",),
    "payroll_cost": ("analytics.ai_pnl_daily", "fern.events_payroll_approved"),
    "operating_profit": ("analytics.ai_pnl_daily",),
    "negative_stock": ("analytics.fct_inventory_snapshot",),
    "low_stock": ("analytics.fct_inventory_snapshot", "fern.events_stock_low"),
}


def _quote_clickhouse_identifier(identifier: str) -> str:
    if re.fullmatch(r"[a-z_][a-z0-9_]*", identifier):
        return identifier
    return "`" + identifier.replace("`", "``") + "`"


def _clickhouse_coverage_sql(datasets: list[str] | tuple[str, ...] | set[str] | None = None) -> str:
    selected = {str(x).strip() for x in (datasets or []) if str(x).strip()}
    parts: list[str] = []
    for policy in DATA_SOURCE_POLICIES.values():
        if selected and policy.dataset not in selected:
            continue
        if policy.storage != "clickhouse" or not policy.time_column:
            continue
        if "/" in policy.time_column or policy.dataset not in TABLE_POLICIES:
            continue
        col = _quote_clickhouse_identifier(policy.time_column)
        parts.append(
            "SELECT "
            f"'{policy.dataset}' AS dataset, "
            f"if(count() = 0, CAST(NULL, 'Nullable(Date)'), min(toDate({col}))) AS min_date, "
            f"if(count() = 0, CAST(NULL, 'Nullable(Date)'), max(toDate({col}))) AS max_date, "
            "count() AS row_count "
            f"FROM {policy.dataset}"
        )
    return "\nUNION ALL\n".join(parts)


_CLICKHOUSE_COVERAGE_SQL = _clickhouse_coverage_sql()

_POSTGRES_COVERAGE_SQL = """
SELECT 'core.work_shift' AS dataset, MIN(work_date)::text AS min_date, MAX(work_date)::text AS max_date, COUNT(*)::bigint AS row_count
FROM core.work_shift
UNION ALL
SELECT 'core.payroll_period', MIN(start_date)::text, MAX(end_date)::text, COUNT(*)::bigint
FROM core.payroll_period
UNION ALL
SELECT 'core.payroll_timesheet', MIN(created_at::date)::text, MAX(created_at::date)::text, COUNT(*)::bigint
FROM core.payroll_timesheet
UNION ALL
SELECT 'core.payroll', MIN(created_at::date)::text, MAX(created_at::date)::text, COUNT(*)::bigint
FROM core.payroll
"""


def _normalize_rows(rows: list[dict[str, Any]], *, source: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        dataset = str(row.get("dataset") or "")
        policy = get_data_source_policy(dataset)
        out.append(
            {
                "source": source,
                "dataset": dataset,
                "min_date": str(row.get("min_date") or ""),
                "max_date": str(row.get("max_date") or ""),
                "row_count": int(row.get("row_count") or 0),
                "time_column": policy.time_column if policy else None,
                "time_semantics_vi": policy.time_semantics_vi if policy else "",
                "source_system": policy.source_system if policy else source,
                "storage": policy.storage if policy else source,
                "freshness_label_vi": policy.freshness_label_vi if policy else "",
            }
        )
    return out


def _fetch_clickhouse_coverage_for_datasets(datasets: list[str] | tuple[str, ...] | set[str] | None = None) -> list[dict[str, Any]]:
    sql = _clickhouse_coverage_sql(datasets)
    if not sql.strip():
        return []
    return _normalize_rows(execute_query(sql), source="clickhouse")


def _fetch_coverage(datasets: list[str] | tuple[str, ...] | set[str] | None = None) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        rows.extend(_fetch_clickhouse_coverage_for_datasets(datasets))
    except Exception as exc:  # noqa: BLE001
        logger.warning("ClickHouse coverage failed: %s", exc)
        errors.append(f"clickhouse:{type(exc).__name__}")
    try:
        rows.extend(_normalize_rows(pg.execute_readonly(_POSTGRES_COVERAGE_SQL), source="postgres"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Postgres coverage failed: %s", exc)
        errors.append(f"postgres:{type(exc).__name__}")
    return {"datasets": rows, "errors": errors}


def _cached_coverage(datasets: list[str] | tuple[str, ...] | set[str] | None = None) -> dict[str, Any]:
    now = time.time()
    key = ",".join(sorted(str(x).strip() for x in (datasets or []) if str(x).strip())) or "*"
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _TTL_SECONDS:
        return cached[1]
    value = _fetch_coverage(datasets)
    _CACHE[key] = (now, value)
    return value


def _cached_coverage_for_datasets(datasets: list[str]) -> dict[str, Any]:
    """Call the cache helper while preserving older tests that monkeypatch it as a zero-arg function."""
    try:
        return _cached_coverage(datasets)
    except TypeError as exc:
        msg = str(exc)
        if "positional" in msg or "argument" in msg:
            return _cached_coverage()
        raise


def _parse_iso_date(value: object) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _requested_range(state: GraphState) -> dict[str, str]:
    tr = state.get("time_range") or {}
    if not isinstance(tr, dict):
        tr = {}
    tk = state.get("template_key")
    tp = state.get("template_params") or {}
    if tk == "T36_revenue_period_driver_bridge" and isinstance(tp, dict):
        parts: list[str] = []
        for key in ("from_date_a", "to_date_a", "from_date_b", "to_date_b"):
            v = str(tp.get(key) or "").strip()
            if v:
                parts.append(v[:10])
        if len(parts) >= 2:
            return {"from_date": min(parts), "to_date": max(parts)}
    fd = str(tr.get("from_date") or "").strip()
    td = str(tr.get("to_date") or "").strip()
    out: dict[str, str] = {}
    if fd:
        out["from_date"] = fd
    if td:
        out["to_date"] = td
    return out


def coverage_status_for_range(
    min_date: object,
    max_date: object,
    requested_from: object,
    requested_to: object,
) -> str:
    """Classify requested range against source coverage.

    Supported statuses are intentionally small and public-safe:
    full, partial_before, partial_after, outside, unknown.
    """

    mn = _parse_iso_date(min_date)
    mx = _parse_iso_date(max_date)
    rf = _parse_iso_date(requested_from)
    rt = _parse_iso_date(requested_to)
    if not (mn and mx and rf and rt):
        return "unknown"
    if rt < mn or rf > mx:
        return "outside"
    if rf < mn:
        return "partial_before"
    if rt > mx:
        return "partial_after"
    return "full"


def _range_intersection(
    min_date: object,
    max_date: object,
    requested_from: object,
    requested_to: object,
) -> dict[str, str]:
    mn = _parse_iso_date(min_date)
    mx = _parse_iso_date(max_date)
    rf = _parse_iso_date(requested_from)
    rt = _parse_iso_date(requested_to)
    if not (mn and mx and rf and rt):
        return {}
    start = max(mn, rf)
    end = min(mx, rt)
    if start > end:
        return {}
    return {"from_date": start.isoformat(), "to_date": end.isoformat()}


def _fallback_window_fully_after_available(mn: date, mx: date, *, span_days: int = 7) -> dict[str, str]:
    """Use the last `span_days` days inside [mn, mx] when the user range is entirely after max_date."""
    span = max(1, int(span_days))
    end = mx
    start = mx - timedelta(days=span - 1)
    if start < mn:
        start = mn
    return {"from_date": start.isoformat(), "to_date": end.isoformat()}


def _fallback_window_fully_before_available(mn: date, mx: date, *, span_days: int = 7) -> dict[str, str]:
    """Use the first `span_days` days inside [mn, mx] when the user range ends before min_date."""
    span = max(1, int(span_days))
    start = mn
    end = min(mx, mn + timedelta(days=span - 1))
    return {"from_date": start.isoformat(), "to_date": end.isoformat()}


def _maybe_clamp_time_range_to_available_coverage(state: GraphState, ctx: dict[str, Any]) -> list[str]:
    """Shrink or shift ``state['time_range']`` so queries run on real coverage.

    When the requested range is `partial_before` / `partial_after`, intersect with
    available [min_date, max_date]. When it is fully `outside` (no intersection),
    answer using the nearest week-shaped window inside available data and add a caveat.

    Returns human-readable caveat lines (Vietnamese) to prepend to ``data_source_context``.
    """
    caveats: list[str] = []
    status = str(ctx.get("coverage_status") or "")
    if status not in {"outside", "partial_before", "partial_after"}:
        return caveats

    ar = ctx.get("available_range") if isinstance(ctx.get("available_range"), dict) else {}
    mn_s = str(ar.get("min_date") or "").strip()
    mx_s = str(ar.get("max_date") or "").strip()
    mn = _parse_iso_date(mn_s)
    mx = _parse_iso_date(mx_s)
    if not mn or not mx:
        return caveats

    req = _requested_range(state)
    rf_s = str(req.get("from_date") or "").strip()
    rt_s = str(req.get("to_date") or "").strip()
    rf = _parse_iso_date(rf_s)
    rt = _parse_iso_date(rt_s)
    if not rf or not rt:
        return caveats

    intersect = _range_intersection(mn_s, mx_s, rf_s, rt_s)
    if intersect:
        new_from, new_to = intersect["from_date"], intersect["to_date"]
        if new_from == rf_s and new_to == rt_s:
            return caveats
        caveats.append(
            f"Kỳ bạn hỏi ({rf_s}–{rt_s}) chỉ trùng một phần (hoặc vượt) khoảng dữ liệu hiện có "
            f"({mn_s}–{mx_s}). Hệ thống đã tự động thu hẹp kỳ truy vấn thành {new_from}–{new_to} "
            "để trả lời dựa trên dữ liệu thực tế trong kho dữ liệu."
        )
    else:
        if rf > mx:
            window = _fallback_window_fully_after_available(mn, mx)
            hint = "sau ngày dữ liệu mới nhất trong hệ thống"
        elif rt < mn:
            window = _fallback_window_fully_before_available(mn, mx)
            hint = "trước khoảng thời gian có dữ liệu"
        else:
            return caveats
        new_from, new_to = window["from_date"], window["to_date"]
        caveats.append(
            f"Kỳ bạn hỏi ({rf_s}–{rt_s}) không giao với dữ liệu khả dụng ({mn_s}–{mx_s}). "
            f"Để vẫn phân tích được theo lịch sử trong kho dữ liệu, em dùng cửa sổ 7 ngày gần nhất {hint} "
            f"({new_from}–{new_to})."
        )

    tr = dict(state.get("time_range") or {})
    tr["from_date"] = new_from
    tr["to_date"] = new_to
    state["time_range"] = tr
    tc = dict(state.get("time_context") or {})
    tc["from_date"] = new_from
    tc["to_date"] = new_to
    state["time_context"] = tc
    state["coverage_time_clamp_applied"] = True
    return caveats


def _policy_public(policy: DataSourcePolicy | None, dataset: str) -> dict[str, Any]:
    if not policy:
        return {
            "dataset": dataset,
            "source_system": "",
            "storage": "",
            "time_column": None,
            "time_semantics": "",
            "freshness_label": "",
        }
    return {
        "dataset": policy.dataset,
        "source_system": policy.source_system,
        "storage": policy.storage,
        "time_column": policy.time_column,
        "time_semantics": policy.time_semantics_vi,
        "freshness_label": policy.freshness_label_vi,
    }


def _coverage_row(coverage: dict[str, Any] | None, dataset: str) -> dict[str, Any] | None:
    rows = coverage.get("datasets") if isinstance(coverage, dict) else []
    for row in rows or []:
        if isinstance(row, dict) and row.get("dataset") == dataset:
            return row
    policy = get_data_source_policy(dataset)
    if policy and policy.storage == "clickhouse" and dataset in TABLE_POLICIES:
        try:
            fetched = _fetch_clickhouse_coverage_for_datasets([dataset])
            if fetched:
                row = fetched[0]
                if isinstance(coverage, dict):
                    coverage.setdefault("datasets", []).append(row)
                return row
        except Exception as exc:  # noqa: BLE001
            logger.warning("ClickHouse coverage fallback failed for %s: %s", dataset, exc)
    return None


def _context_caveats(
    *,
    dataset: str,
    time_semantics: str,
    min_date: str,
    max_date: str,
    requested_from: str,
    requested_to: str,
    status: str,
) -> list[str]:
    if status == "full":
        return []
    if status == "unknown":
        return []
    if status == "outside":
        if not min_date and not max_date:
            return [f"Nguồn {dataset} hiện chưa có dữ liệu nào để trả lời kỳ {requested_from} đến {requested_to}."]
        return [
            f"Nguồn {dataset} hiện chưa có dữ liệu cho kỳ {requested_from} đến {requested_to}; "
            f"coverage hiện có là {min_date or '?'} đến {max_date or '?'} theo {time_semantics or 'cột thời gian nguồn'}."
        ]
    notes: list[str] = []
    rf = _parse_iso_date(requested_from)
    rt = _parse_iso_date(requested_to)
    mn = _parse_iso_date(min_date)
    mx = _parse_iso_date(max_date)
    if rf and mn and rf < mn:
        notes.append(f"bạn hỏi từ {rf.isoformat()}, nhưng {dataset} hiện bắt đầu từ {mn.isoformat()}")
    if rt and mx and rt > mx:
        notes.append(f"bạn hỏi đến {rt.isoformat()}, nhưng {dataset} hiện chỉ cập nhật đến {mx.isoformat()}")
    if not notes:
        return []
    return ["; ".join(notes) + "."]


def coverage_context_for_source(
    coverage: dict[str, Any] | None,
    dataset: str,
    *,
    requested_range: dict[str, str] | None = None,
) -> dict[str, Any]:
    policy = get_data_source_policy(dataset)
    row = _coverage_row(coverage, dataset)
    requested = requested_range or {}
    requested_from = str(requested.get("from_date") or "")
    requested_to = str(requested.get("to_date") or "")
    min_date = str((row or {}).get("min_date") or "")
    max_date = str((row or {}).get("max_date") or "")
    row_count = int((row or {}).get("row_count") or 0)
    status = coverage_status_for_range(min_date, max_date, requested_from, requested_to)
    if row is not None and row_count == 0 and (requested_from or requested_to):
        status = "outside"
    public = _policy_public(policy, dataset)
    time_semantics = str(public.get("time_semantics") or "")
    caveats = _context_caveats(
        dataset=dataset,
        time_semantics=time_semantics,
        min_date=min_date,
        max_date=max_date,
        requested_from=requested_from,
        requested_to=requested_to,
        status=status,
    )
    return {
        **public,
        "primary_dataset": dataset,
        "min_date": min_date,
        "max_date": max_date,
        "row_count": row_count,
        "source": str((row or {}).get("source") or public.get("storage") or ""),
        "freshness_as_of": max_date,
        "requested_range": requested,
        "available_range": {"min_date": min_date, "max_date": max_date},
        "actual_data_range": _range_intersection(min_date, max_date, requested_from, requested_to),
        "coverage_status": status,
        "caveats": caveats,
    }


def _question_for_selection(state: GraphState) -> str:
    frame = state.get("question_frame")
    if isinstance(frame, dict):
        for key in ("effective_question", "current_question"):
            value = str(frame.get(key) or "").strip()
            if value:
                return value
    for key in ("contextualized_question", "normalized_question", "raw_question"):
        value = str(state.get(key) or "").strip()
        if value:
            return value
    return ""


def _hr_dataset_for_question(state: GraphState, question: str) -> str:
    template = dataset_for_template(str(state.get("template_key") or ""))
    if template:
        return template
    kind = str(state.get("hr_query_kind") or "").lower()
    q = question.lower()
    if "payroll" in kind or "lương" in q or "luong" in q or "salary" in q:
        return "core.payroll_period"
    if "tenure" in kind or "thâm niên" in q or "tham nien" in q or "hợp đồng" in q or "hop dong" in q:
        return "core.employee_contract"
    return "core.work_shift"


def _metric_hint_datasets(state: GraphState, question: str) -> list[str]:
    out: list[str] = []
    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    decision = state.get("planning_decision") if isinstance(state.get("planning_decision"), dict) else {}
    metric_ids = [
        str(x).strip()
        for x in [
            *(frame.get("metric_ids") or []),
            *(decision.get("selected_metric_ids") or []),
        ]
        if str(x).strip()
    ]
    folded = question.lower()
    if "hóa đơn" in folded or "hoa don" in folded or "supplier invoice" in folded:
        metric_ids.append("supplier_invoice_approved")
    if "phiếu nhập" in folded or "phieu nhap" in folded or "goods receipt" in folded:
        metric_ids.append("goods_receipt")
    if "expense" in folded or "chi phí" in folded or "chi phi" in folded or "chi tiêu" in folded or "chi tieu" in folded:
        metric_ids.append("expense_breakdown")
    for metric in metric_ids:
        for dataset in _METRIC_DATASET_HINTS.get(metric, ()):
            if dataset in DATA_SOURCE_POLICIES and dataset not in out:
                out.append(dataset)
    return out


def selected_datasets_for_state(state: GraphState) -> list[str]:
    template_dataset = dataset_for_template(str(state.get("template_key") or ""))
    if template_dataset:
        return [template_dataset]

    question = _question_for_selection(state)
    if state.get("agent_route") == "hr_staff" or state.get("intent") == "hr_staff" or state.get("hr_query_kind"):
        return [_hr_dataset_for_question(state, question)]

    out: list[str] = []
    for dataset in _metric_hint_datasets(state, question):
        if dataset not in out:
            out.append(dataset)
    for key in domain_keys_for_question(str(state.get("intent") or ""), question):
        domain = QUERY_DOMAINS.get(key)
        if not domain:
            continue
        for dataset in domain.preferred_tables:
            if dataset in DATA_SOURCE_POLICIES and dataset not in out:
                out.append(dataset)
    return out or ["analytics.ai_sales_daily"]


def build_data_source_context(state: GraphState) -> dict[str, Any] | None:
    if state.get("social_kind") or state.get("agent_route") == "docs_question":
        return None
    coverage = state.get("data_coverage_context")
    if not isinstance(coverage, dict):
        coverage = {"datasets": [], "errors": []}
    requested = _requested_range(state)
    datasets = selected_datasets_for_state(state)
    contexts: list[dict[str, Any]] = []
    for dataset in datasets:
        source_requested = requested
        policy = get_data_source_policy(dataset)
        if (
            policy
            and policy.available_range_strategy == "latest_snapshot"
            and state.get("template_key") in {"T11_inventory_current_stock", "T12_inventory_low_stock", "T15_inventory_reorder_alerts"}
        ):
            row = _coverage_row(coverage, dataset)
            max_date = str((row or {}).get("max_date") or "").strip()
            if max_date:
                source_requested = {"from_date": max_date, "to_date": max_date}
        contexts.append(coverage_context_for_source(coverage, dataset, requested_range=source_requested))
    contexts = [ctx for ctx in contexts if ctx.get("dataset")]
    if not contexts:
        return None
    primary = contexts[0]
    return {
        "primary_dataset": primary.get("dataset"),
        "source_system": primary.get("source_system"),
        "storage": primary.get("storage"),
        "time_column": primary.get("time_column"),
        "time_semantics": primary.get("time_semantics"),
        "requested_range": primary.get("requested_range") or requested,
        "available_range": primary.get("available_range") or {},
        "actual_data_range": primary.get("actual_data_range") or {},
        "coverage_status": primary.get("coverage_status"),
        "freshness_as_of": primary.get("freshness_as_of"),
        "caveats": primary.get("caveats") or [],
        "selected_data_sources": contexts,
    }


def ensure_data_source_context(state: GraphState) -> dict[str, Any] | None:
    ctx = build_data_source_context(state)
    if ctx:
        state["data_source_context"] = ctx
    return ctx or state.get("data_source_context")


def data_coverage(state: GraphState) -> GraphState:
    if state.get("social_kind") or state.get("agent_route") == "docs_question":
        state.setdefault("trace", []).append({"node": "data_coverage", "skipped": True})
        return state
    datasets = selected_datasets_for_state(state)
    coverage = _cached_coverage_for_datasets(datasets)
    state["data_coverage_context"] = coverage
    ctx = ensure_data_source_context(state)
    clamp_caveats: list[str] = []
    if ctx:
        clamp_caveats = _maybe_clamp_time_range_to_available_coverage(state, ctx)
        if clamp_caveats:
            ctx = ensure_data_source_context(state)
            if ctx:
                ctx["caveats"] = [*clamp_caveats, *(ctx.get("caveats") or [])]
                state["data_source_context"] = ctx
    rows = coverage.get("datasets") or []
    trace_row: dict[str, Any] = {
        "node": "data_coverage",
        "datasets": len(rows),
        "source": (ctx or {}).get("primary_dataset"),
        "coverage_status": (ctx or {}).get("coverage_status"),
        "errors": ",".join(coverage.get("errors") or []),
    }
    if state.get("coverage_time_clamp_applied"):
        trace_row["time_range_clamped"] = True
    state.setdefault("trace", []).append(trace_row)
    return state


def format_data_coverage_for_prompt(coverage: dict[str, Any] | None) -> str:
    if not isinstance(coverage, dict):
        return ""
    rows = coverage.get("datasets") or []
    if not isinstance(rows, list) or not rows:
        return ""
    lines = ["\nData coverage from DB (authoritative; mention caveat if requested range exceeds source coverage):"]
    for row in rows[:12]:
        if not isinstance(row, dict):
            continue
        policy = get_data_source_policy(str(row.get("dataset") or ""))
        time_col = row.get("time_column") or (policy.time_column if policy else "")
        semantics = row.get("time_semantics_vi") or (policy.time_semantics_vi if policy else "")
        lines.append(
            f"- {row.get('dataset')}: {row.get('min_date')} → {row.get('max_date')} "
            f"({row.get('row_count')} rows, {row.get('source')}; "
            f"time={time_col or 'n/a'}; semantics={semantics or 'unknown'})"
        )
    return "\n".join(lines) + "\n"


def _preferred_dataset(state: GraphState) -> str:
    datasets = selected_datasets_for_state(state)
    return datasets[0] if datasets else "analytics.ai_sales_daily"


def coverage_window_for_template(state: GraphState) -> dict[str, Any]:
    preferred = _preferred_dataset(state)
    ensure_data_source_context(state)
    ctx = coverage_context_for_source(
        state.get("data_coverage_context"),
        preferred,
        requested_range=_requested_range(state),
    )
    return {
        "dataset": preferred,
        "min_date": str(ctx.get("min_date") or ""),
        "max_date": str(ctx.get("max_date") or ""),
        "row_count": int(ctx.get("row_count") or 0),
        "source": str(ctx.get("source") or ""),
        "time_column": ctx.get("time_column"),
        "time_semantics": ctx.get("time_semantics"),
        "coverage_status": ctx.get("coverage_status"),
        "caveats": ctx.get("caveats") or [],
        "available_range": ctx.get("available_range") or {},
        "actual_data_range": ctx.get("actual_data_range") or {},
    }


def coverage_max_date_for_template(state: GraphState) -> str:
    return str(coverage_window_for_template(state).get("max_date") or "")
