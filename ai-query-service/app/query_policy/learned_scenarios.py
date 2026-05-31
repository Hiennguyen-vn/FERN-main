"""Promoted scenario memory for bounded autonomous template routing.

This module lets the system accumulate successful scenario blueprints without
hand-writing every future phrasing. Humans still approve/publish scenarios;
runtime matching stays bounded to existing templates and query policy.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Any

from app.graph.state import GraphState
from app.query_policy.policy import ALLOWED_FULL_TABLES, domain_keys_for_question
from app.templates.registry import TEMPLATES, ensure_runtime_templates_loaded

_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_KNOWLEDGE_PATH = _ROOT / "knowledge" / "learned_scenarios.yaml"
_CACHE_MTIME_NS: int | None = None
_CACHE_ROWS: tuple["LearnedScenarioAsset", ...] = ()
_CACHE_SQL_MTIME_NS: int | None = None
_CACHE_SQL_ROWS: tuple["SqlWriterScenarioAsset", ...] = ()

_REPORT_SPEC_FIELDS = (
    "analysis_mode",
    "group_by",
    "time_axis",
    "comparison_mode",
    "ranking_mode",
)


@dataclass(frozen=True)
class LearnedScenarioAsset:
    scenario_key: str
    template_key: str
    intent: str
    domain: str
    task_type: str
    metric_ids: tuple[str, ...]
    required_slots: tuple[str, ...]
    report_spec: dict[str, Any]
    dataset_candidates: tuple[str, ...] = ()
    example_questions: tuple[str, ...] = ()
    permission_profile: dict[str, Any] | None = None
    min_confidence: float = 0.78
    enabled: bool = True


@dataclass(frozen=True)
class LearnedScenarioMatch:
    template_key: str
    params: dict[str, str | int]
    confidence: float
    asset: LearnedScenarioAsset


@dataclass(frozen=True)
class SqlWriterScenarioAsset:
    """Promoted SQL Writer blueprint.

    This deliberately does not contain raw SQL. It is a bounded memory record
    that can steer GenSQL toward approved candidate tables/report shape; the
    runtime still generates fresh SQL and applies all hard gates.
    """

    scenario_key: str
    intent: str
    domain: str
    task_type: str
    metric_ids: tuple[str, ...]
    required_slots: tuple[str, ...]
    report_spec: dict[str, Any]
    dataset_candidates: tuple[str, ...]
    tables_used: tuple[str, ...] = ()
    sql_hashes: tuple[str, ...] = ()
    sql_plan: dict[str, Any] | None = None
    example_questions: tuple[str, ...] = ()
    permission_profile: dict[str, Any] | None = None
    min_confidence: float = 0.8
    enabled: bool = True


@dataclass(frozen=True)
class SqlWriterScenarioMatch:
    confidence: float
    asset: SqlWriterScenarioAsset


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    no_marks = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return no_marks.replace("đ", "d").replace("Đ", "D").lower()


def _tokenize(text: str) -> set[str]:
    return {tok for tok in re.split(r"[^a-z0-9]+", _fold(text)) if len(tok) >= 3}


def _normalize_text_list(values: Any, *, limit: int = 8) -> tuple[str, ...]:
    out: list[str] = []
    for raw in values or []:
        text = str(raw or "").strip()
        if text and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return tuple(out)


def _normalize_report_spec(spec: Any) -> dict[str, Any]:
    data = spec if isinstance(spec, dict) else {}
    out: dict[str, Any] = {field: data.get(field) for field in _REPORT_SPEC_FIELDS}
    metric_focus = _normalize_text_list(data.get("metric_focus") or (), limit=6)
    out["metric_focus"] = list(metric_focus)
    return out


def _normalize_permission_profile(profile: Any) -> dict[str, Any]:
    data = profile if isinstance(profile, dict) else {}
    include_fallbacks = bool(data.get("include_fallback_tables"))
    try:
        max_tables = int(data.get("max_tables") or (8 if include_fallbacks else 6))
    except (TypeError, ValueError):
        max_tables = 8 if include_fallbacks else 6
    return {
        "include_fallback_tables": include_fallbacks,
        "max_tables": max(4, min(max_tables, 16)),
    }


def _normalize_allowed_table_list(values: Any, *, limit: int = 10) -> tuple[str, ...]:
    out: list[str] = []
    for raw in values or []:
        text = str(raw or "").strip().lower()
        if text in ALLOWED_FULL_TABLES and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return tuple(out)


def _normalize_sql_plan(plan: Any) -> dict[str, Any]:
    data = plan if isinstance(plan, dict) else {}
    primary = _normalize_allowed_table_list(data.get("primary_tables") or (), limit=8)
    optional = tuple(x for x in _normalize_allowed_table_list(data.get("optional_tables") or (), limit=8) if x not in primary)
    return {
        "goal_vi": str(data.get("goal_vi") or "").strip()[:400],
        "primary_tables": list(primary),
        "optional_tables": list(optional),
        "grain_vi": str(data.get("grain_vi") or "").strip()[:300],
        "time_binding_vi": str(data.get("time_binding_vi") or "").strip()[:300],
        "metric_plan_vi": list(_normalize_text_list(data.get("metric_plan_vi") or (), limit=10)),
        "join_hints_vi": list(_normalize_text_list(data.get("join_hints_vi") or (), limit=8)),
        "filter_hints_vi": list(_normalize_text_list(data.get("filter_hints_vi") or (), limit=8)),
        "risk_notes_vi": list(_normalize_text_list(data.get("risk_notes_vi") or (), limit=6)),
        "must_avoid_vi": list(_normalize_text_list(data.get("must_avoid_vi") or (), limit=10)),
        "logical_steps_vi": list(_normalize_text_list(data.get("logical_steps_vi") or (), limit=12)),
    }


def _asset_from_row(row: Any) -> LearnedScenarioAsset | None:
    ensure_runtime_templates_loaded()
    if not isinstance(row, dict):
        return None
    template_key = str(row.get("template_key") or "").strip()
    scenario_key = str(row.get("scenario_key") or "").strip()
    if not template_key or template_key not in TEMPLATES or not scenario_key:
        return None
    return LearnedScenarioAsset(
        scenario_key=scenario_key,
        template_key=template_key,
        intent=str(row.get("intent") or "").strip().lower(),
        domain=str(row.get("domain") or "").strip().lower(),
        task_type=str(row.get("task_type") or "").strip(),
        metric_ids=_normalize_text_list(row.get("metric_ids") or (), limit=8),
        required_slots=_normalize_text_list(row.get("required_slots") or (), limit=8),
        report_spec=_normalize_report_spec(row.get("report_spec")),
        dataset_candidates=_normalize_text_list(row.get("dataset_candidates") or (), limit=10),
        example_questions=_normalize_text_list(row.get("example_questions") or (), limit=6),
        permission_profile=_normalize_permission_profile(row.get("permission_profile")),
        min_confidence=max(0.0, min(float(row.get("min_confidence") or 0.78), 0.99)),
        enabled=bool(row.get("enabled", True)),
    )


def _sql_writer_asset_from_row(row: Any) -> SqlWriterScenarioAsset | None:
    if not isinstance(row, dict):
        return None
    scenario_type = str(row.get("scenario_type") or row.get("candidate_type") or "").strip().lower()
    if scenario_type not in {"sql_writer", "sql_writer_codegen"}:
        return None
    scenario_key = str(row.get("scenario_key") or "").strip()
    if not scenario_key:
        return None
    datasets = _normalize_allowed_table_list(row.get("dataset_candidates") or (), limit=10)
    tables_used = _normalize_allowed_table_list(row.get("tables_used") or (), limit=10)
    if not datasets and not tables_used:
        return None
    sql_hashes = _normalize_text_list(row.get("sql_hashes") or ([row.get("sql_hash")] if row.get("sql_hash") else []), limit=12)
    return SqlWriterScenarioAsset(
        scenario_key=scenario_key,
        intent=str(row.get("intent") or "").strip().lower(),
        domain=str(row.get("domain") or "").strip().lower(),
        task_type=str(row.get("task_type") or "").strip(),
        metric_ids=_normalize_text_list(row.get("metric_ids") or (), limit=8),
        required_slots=_normalize_text_list(row.get("required_slots") or (), limit=8),
        report_spec=_normalize_report_spec(row.get("report_spec")),
        dataset_candidates=datasets,
        tables_used=tables_used,
        sql_hashes=sql_hashes,
        sql_plan=_normalize_sql_plan(row.get("sql_plan")) if row.get("sql_plan") else None,
        example_questions=_normalize_text_list(row.get("example_questions") or (), limit=8),
        permission_profile=_normalize_permission_profile(row.get("permission_profile")),
        min_confidence=max(0.0, min(float(row.get("min_confidence") or 0.8), 0.99)),
        enabled=bool(row.get("enabled", True)),
    )


def clear_learned_scenarios_cache() -> None:
    global _CACHE_MTIME_NS, _CACHE_ROWS, _CACHE_SQL_MTIME_NS, _CACHE_SQL_ROWS
    _CACHE_MTIME_NS = None
    _CACHE_ROWS = ()
    _CACHE_SQL_MTIME_NS = None
    _CACHE_SQL_ROWS = ()


def load_learned_scenarios() -> tuple[LearnedScenarioAsset, ...]:
    global _CACHE_MTIME_NS, _CACHE_ROWS
    try:
        stat = SCENARIO_KNOWLEDGE_PATH.stat()
    except OSError:
        clear_learned_scenarios_cache()
        return ()
    if _CACHE_MTIME_NS == stat.st_mtime_ns:
        return _CACHE_ROWS

    try:
        import yaml

        raw = yaml.safe_load(SCENARIO_KNOWLEDGE_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        clear_learned_scenarios_cache()
        return ()

    rows = raw.get("scenarios") if isinstance(raw, dict) else []
    parsed: list[LearnedScenarioAsset] = []
    for row in rows or []:
        asset = _asset_from_row(row)
        if asset is not None:
            parsed.append(asset)
    _CACHE_MTIME_NS = stat.st_mtime_ns
    _CACHE_ROWS = tuple(parsed)
    return _CACHE_ROWS


def load_sql_writer_scenarios() -> tuple[SqlWriterScenarioAsset, ...]:
    global _CACHE_SQL_MTIME_NS, _CACHE_SQL_ROWS
    try:
        stat = SCENARIO_KNOWLEDGE_PATH.stat()
    except OSError:
        clear_learned_scenarios_cache()
        return ()
    if _CACHE_SQL_MTIME_NS == stat.st_mtime_ns:
        return _CACHE_SQL_ROWS

    try:
        import yaml

        raw = yaml.safe_load(SCENARIO_KNOWLEDGE_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        clear_learned_scenarios_cache()
        return ()

    rows = raw.get("scenarios") if isinstance(raw, dict) else []
    parsed: list[SqlWriterScenarioAsset] = []
    for row in rows or []:
        asset = _sql_writer_asset_from_row(row)
        if asset is not None:
            parsed.append(asset)
    _CACHE_SQL_MTIME_NS = stat.st_mtime_ns
    _CACHE_SQL_ROWS = tuple(parsed)
    return _CACHE_SQL_ROWS


def learned_scenario_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for asset in load_learned_scenarios():
        rows.append(
            {
                "scenario_key": asset.scenario_key,
                "template_key": asset.template_key,
                "intent": asset.intent,
                "domain": asset.domain,
                "task_type": asset.task_type,
                "metric_ids": list(asset.metric_ids),
                "required_slots": list(asset.required_slots),
                "report_spec": dict(asset.report_spec),
                "dataset_candidates": list(asset.dataset_candidates),
                "example_questions": list(asset.example_questions),
                "permission_profile": dict(asset.permission_profile or {}),
                "min_confidence": asset.min_confidence,
                "enabled": asset.enabled,
            }
        )
    for asset in load_sql_writer_scenarios():
        rows.append(
            {
                "scenario_type": "sql_writer",
                "scenario_key": asset.scenario_key,
                "template_key": None,
                "intent": asset.intent,
                "domain": asset.domain,
                "task_type": asset.task_type,
                "metric_ids": list(asset.metric_ids),
                "required_slots": list(asset.required_slots),
                "report_spec": dict(asset.report_spec),
                "dataset_candidates": list(asset.dataset_candidates),
                "tables_used": list(asset.tables_used),
                "sql_hashes": list(asset.sql_hashes),
                "sql_plan": dict(asset.sql_plan or {}),
                "example_questions": list(asset.example_questions),
                "permission_profile": dict(asset.permission_profile or {}),
                "min_confidence": asset.min_confidence,
                "enabled": asset.enabled,
            }
        )
    return rows


def build_scenario_key(
    *,
    template_key: str,
    intent: str,
    domain: str,
    task_type: str,
    report_spec: dict[str, Any] | None,
) -> str:
    payload = {
        "template_key": template_key,
        "intent": (intent or "").strip().lower(),
        "domain": (domain or "").strip().lower(),
        "task_type": (task_type or "").strip(),
        "report_spec": _normalize_report_spec(report_spec),
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return "scenario:" + hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


def _default_report_spec(template_key: str, metric_ids: list[str] | tuple[str, ...] | None = None) -> dict[str, Any]:
    metric_focus = [str(x).strip() for x in (metric_ids or []) if str(x).strip()][:4]
    spec = {
        "analysis_mode": "summary",
        "group_by": None,
        "time_axis": None,
        "comparison_mode": None,
        "ranking_mode": None,
        "metric_focus": metric_focus,
    }
    if template_key == "T34_sales_detail_by_day":
        spec.update({"analysis_mode": "detail_list", "group_by": "sale_line"})
    elif template_key == "T33_zero_revenue_outlets":
        spec.update({"analysis_mode": "exception_list", "group_by": "outlet"})
    elif template_key == "T23_peak_hour_analysis":
        spec.update({"analysis_mode": "distribution", "group_by": "hour_of_day", "time_axis": "hour_of_day", "ranking_mode": "top"})
    elif template_key == "T07_revenue_comparison_yoy":
        spec.update({"analysis_mode": "comparison", "comparison_mode": "same_period_last_year"})
    elif template_key == "T08_revenue_by_payment_method":
        spec.update({"analysis_mode": "breakdown", "group_by": "payment_method", "ranking_mode": "top"})
    elif template_key == "T09_avg_basket_size":
        spec["metric_focus"] = metric_focus or ["avg_basket_size"]
    elif template_key == "T10_transaction_count":
        spec["metric_focus"] = metric_focus or ["txn_count"]
    elif template_key == "T30_sale_cancellation_rate":
        spec["metric_focus"] = metric_focus or ["cancellation_rate"]
    elif template_key == "T24_daily_pnl_summary":
        spec["metric_focus"] = metric_focus or ["operating_profit"]
    elif template_key == "T04_top_products":
        spec.update({"analysis_mode": "ranking", "group_by": "product", "ranking_mode": "top"})
    elif template_key == "T01_daily_revenue":
        spec.update({"analysis_mode": "time_series", "time_axis": "business_date"})
    elif template_key == "T35_weekly_revenue_trend":
        spec.update({"analysis_mode": "time_series", "time_axis": "week_start"})
    elif template_key == "T36_revenue_period_driver_bridge":
        spec.update({"analysis_mode": "comparison", "comparison_mode": "two_custom_periods", "metric_focus": ["net_revenue", "txn_count", "aov", "outlet_count"]})
    elif template_key == "T22_outlet_rank":
        spec.update({"analysis_mode": "ranking", "group_by": "outlet", "ranking_mode": "top"})
    elif template_key == "T02_revenue_by_outlet":
        spec.update({"analysis_mode": "breakdown", "group_by": "outlet", "ranking_mode": "top"})
    return spec


def _default_task_type(template_key: str, intent: str) -> str:
    mapping = {
        "T34_sales_detail_by_day": "sales_detail",
        "T33_zero_revenue_outlets": "zero_revenue_outlets",
        "T23_peak_hour_analysis": "peak_hour_analysis",
        "T31_outlet_directory": "outlet_directory",
        "T11_inventory_current_stock": "inventory",
        "T12_inventory_low_stock": "inventory",
        "T15_inventory_reorder_alerts": "inventory",
        "T24_daily_pnl_summary": "pnl",
        "T04_top_products": "product_mix",
        "T01_daily_revenue": "trend",
        "T35_weekly_revenue_trend": "trend",
        "T36_revenue_period_driver_bridge": "trend",
        "T07_revenue_comparison_yoy": "outlet_compare",
        "T22_outlet_rank": "outlet_compare",
    }
    return mapping.get(template_key, "metric_summary" if intent != "lookup" else "outlet_directory")


def _required_slots_from_state(state: GraphState, intent: str, task_type: str) -> list[str]:
    decision = state.get("planning_decision")
    if isinstance(decision, dict) and decision.get("required_slots"):
        return [str(x).strip() for x in decision.get("required_slots") or [] if str(x).strip()]
    time_range = state.get("time_range") or {}
    if intent not in {"lookup", "greeting", "thanks", "hr_staff"} and (
        str(time_range.get("from_date") or "").strip() or str(time_range.get("to_date") or "").strip()
    ):
        return ["from_date", "to_date"]
    if task_type in {"sales_detail", "zero_revenue_outlets", "peak_hour_analysis"}:
        return ["from_date", "to_date"]
    return []


def _permission_profile_for_state(dataset_candidates: list[str]) -> dict[str, Any]:
    expanded = any(tbl.startswith(("cdc.", "fern.")) or tbl.startswith("analytics.fct_") for tbl in dataset_candidates)
    return {
        "include_fallback_tables": expanded,
        "max_tables": max(6, min(len(dataset_candidates) or 6, 16)),
    }


def build_scenario_candidate_from_state(state: GraphState) -> dict[str, Any] | None:
    template_key = str(state.get("template_key") or "").strip()
    if not template_key:
        return None
    intent = str(state.get("intent") or "").strip().lower()
    if intent in {"greeting", "thanks", "hr_staff"}:
        return None

    frame = state.get("planning_frame") if isinstance(state.get("planning_frame"), dict) else {}
    decision = state.get("planning_decision") if isinstance(state.get("planning_decision"), dict) else {}
    domain = str(frame.get("domain") or (domain_keys_for_question(intent, state.get("normalized_question") or "")[:1] or ["sales"])[0]).strip().lower()
    task_type = str(frame.get("task_type") or _default_task_type(template_key, intent)).strip()
    metric_ids = [str(x).strip() for x in (decision.get("selected_metric_ids") or frame.get("metric_ids") or []) if str(x).strip()]
    report_spec = decision.get("report_spec") if isinstance(decision.get("report_spec"), dict) else _default_report_spec(template_key, metric_ids)
    required_slots = _required_slots_from_state(state, intent, task_type)
    datasets = [str(x).strip() for x in (decision.get("selected_dataset_candidates") or []) if str(x).strip()][:10]
    example = str(state.get("normalized_question") or state.get("contextualized_question") or "").strip()

    return {
        "scenario_key": build_scenario_key(
            template_key=template_key,
            intent=intent,
            domain=domain,
            task_type=task_type,
            report_spec=report_spec,
        ),
        "template_key": template_key,
        "intent": intent,
        "domain": domain,
        "task_type": task_type,
        "metric_ids": metric_ids[:8],
        "required_slots": required_slots,
        "report_spec": _normalize_report_spec(report_spec),
        "dataset_candidates": datasets,
        "example_questions": [example] if example else [],
        "permission_profile": _permission_profile_for_state(datasets),
        "min_confidence": max(0.72, min(float(state.get("template_confidence") or 0.82), 0.99)),
    }


def _params_from_required_slots(
    required_slots: tuple[str, ...] | list[str],
    time_range: dict[str, Any],
) -> dict[str, str | int] | None:
    params: dict[str, str | int] = {}
    slots = {str(x).strip() for x in required_slots if str(x).strip()}
    if "from_date" in slots or "to_date" in slots:
        fd = str(time_range.get("from_date") or "").strip()
        td = str(time_range.get("to_date") or "").strip()
        if not fd or not td:
            return None
        params["from_date"] = fd
        params["to_date"] = td
    return params


def _report_spec_match_score(current: dict[str, Any], learned: dict[str, Any]) -> float:
    score = 0.0
    weights = {
        "analysis_mode": 0.18,
        "group_by": 0.16,
        "comparison_mode": 0.1,
        "ranking_mode": 0.08,
        "time_axis": 0.06,
    }
    for field, weight in weights.items():
        cur = current.get(field)
        ref = learned.get(field)
        if cur and ref and cur == ref:
            score += weight
    cur_metrics = set(_normalize_text_list(current.get("metric_focus") or (), limit=6))
    ref_metrics = set(_normalize_text_list(learned.get("metric_focus") or (), limit=6))
    if cur_metrics and ref_metrics:
        score += 0.12 * (len(cur_metrics & ref_metrics) / max(len(cur_metrics | ref_metrics), 1))
    return score


def _metric_match_score(current_metrics: list[str], learned_metrics: tuple[str, ...]) -> float:
    cur = {str(x).strip() for x in current_metrics if str(x).strip()}
    ref = {str(x).strip() for x in learned_metrics if str(x).strip()}
    if not cur or not ref:
        return 0.0
    return 0.16 * (len(cur & ref) / max(len(cur | ref), 1))


def _question_example_score(question: str, examples: tuple[str, ...]) -> float:
    current = _tokenize(question)
    if not current or not examples:
        return 0.0
    best = 0.0
    for example in examples:
        tokens = _tokenize(example)
        if not tokens:
            continue
        overlap = len(current & tokens) / max(len(current | tokens), 1)
        if overlap > best:
            best = overlap
    return 0.12 * best


def select_learned_scenario(
    *,
    question: str,
    intent: str | None,
    time_range: dict[str, Any],
    planning_frame: dict[str, Any] | None = None,
    planning_decision: dict[str, Any] | None = None,
    min_score: float = 0.78,
) -> LearnedScenarioMatch | None:
    current_intent = (intent or "").strip().lower()
    if current_intent in {"greeting", "thanks", "hr_staff"}:
        return None
    frame = planning_frame if isinstance(planning_frame, dict) else {}
    decision = planning_decision if isinstance(planning_decision, dict) else {}
    current_domain = str(frame.get("domain") or "").strip().lower()
    if not current_domain:
        current_domain = (domain_keys_for_question(current_intent, question)[:1] or ["sales"])[0]
    current_task = str(frame.get("task_type") or "").strip()
    current_metrics = [str(x).strip() for x in (decision.get("selected_metric_ids") or frame.get("metric_ids") or []) if str(x).strip()]
    current_spec = _normalize_report_spec(decision.get("report_spec") or {})

    best: LearnedScenarioMatch | None = None
    for asset in load_learned_scenarios():
        if not asset.enabled:
            continue
        params = _params_from_required_slots(asset.required_slots, time_range)
        if params is None:
            continue
        score = 0.0
        if asset.intent and asset.intent == current_intent:
            score += 0.22
        elif asset.intent in {"revenue", "trend", "outlet_compare"} and current_intent in {"revenue", "trend", "outlet_compare"}:
            score += 0.12
        if asset.domain and asset.domain == current_domain:
            score += 0.14
        if asset.task_type and current_task and asset.task_type == current_task:
            score += 0.12
        score += _report_spec_match_score(current_spec, asset.report_spec)
        score += _metric_match_score(current_metrics, asset.metric_ids)
        score += _question_example_score(question, asset.example_questions)
        threshold = max(float(min_score), float(asset.min_confidence))
        if score < threshold:
            continue
        if best is None or score > best.confidence:
            best = LearnedScenarioMatch(
                template_key=asset.template_key,
                params=params,
                confidence=min(score, 0.99),
                asset=asset,
            )
    return best


def select_sql_writer_scenario(
    *,
    question: str,
    intent: str | None,
    time_range: dict[str, Any],
    planning_frame: dict[str, Any] | None = None,
    planning_decision: dict[str, Any] | None = None,
    min_score: float = 0.8,
) -> SqlWriterScenarioMatch | None:
    current_intent = (intent or "").strip().lower()
    if current_intent in {"greeting", "thanks", "hr_staff"}:
        return None
    frame = planning_frame if isinstance(planning_frame, dict) else {}
    decision = planning_decision if isinstance(planning_decision, dict) else {}
    current_domain = str(frame.get("domain") or decision.get("selected_domain") or "").strip().lower()
    if not current_domain:
        current_domain = (domain_keys_for_question(current_intent, question)[:1] or ["sales"])[0]
    current_task = str(frame.get("task_type") or "").strip()
    current_metrics = [str(x).strip() for x in (decision.get("selected_metric_ids") or frame.get("metric_ids") or []) if str(x).strip()]
    current_spec = _normalize_report_spec(decision.get("report_spec") or {})

    best: SqlWriterScenarioMatch | None = None
    for asset in load_sql_writer_scenarios():
        if not asset.enabled:
            continue
        if _params_from_required_slots(asset.required_slots, time_range) is None:
            continue
        score = 0.0
        if asset.intent and asset.intent == current_intent:
            score += 0.22
        elif asset.intent in {"revenue", "trend", "outlet_compare"} and current_intent in {"revenue", "trend", "outlet_compare"}:
            score += 0.12
        if asset.domain and asset.domain == current_domain:
            score += 0.14
        if asset.task_type and current_task and asset.task_type == current_task:
            score += 0.12
        score += _report_spec_match_score(current_spec, asset.report_spec)
        score += _metric_match_score(current_metrics, asset.metric_ids)
        score += _question_example_score(question, asset.example_questions)
        threshold = max(float(min_score), float(asset.min_confidence))
        if score < threshold:
            continue
        if best is None or score > best.confidence:
            best = SqlWriterScenarioMatch(confidence=min(score, 0.99), asset=asset)
    return best
