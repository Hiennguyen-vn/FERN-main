from __future__ import annotations

import logging
import re
from typing import Any

from app.query_policy import select_verified_query
from app.templates.registry import TEMPLATES, ensure_runtime_templates_loaded, list_templates
from app.utils.text import fold_text as _fold_text

logger = logging.getLogger(__name__)

_OUTLET_NAME_RE = re.compile(r"\boutlet\s+[\w-]+", re.IGNORECASE)
_AI_SALES_DAILY_DATASET_RE = re.compile(r"\b(?:analytics\.)?ai_sales_daily\b", re.IGNORECASE)


def category_template_for_question(question: str) -> str | None:
    q = _fold_text(question)
    categoryish = any(token in q for token in ("danh muc", "category", "nhom san pham", "nhom mon"))
    if not categoryish:
        return None
    if any(token in q for token in ("dong gop", "contribution", "ty trong", "share")):
        return "T17_category_contribution"
    if any(
        token in q
        for token in (
            "doanh thu",
            "revenue",
            "xep hang",
            "rank",
            "manh",
            "yeu",
            "kem",
            "te",
            "tot",
            "xau",
            "ban tot",
            "ban xau",
            "ban chay",
            "ban cham",
            "cao nhat",
            "thap nhat",
            "nhieu nhat",
            "it nhat",
        )
    ):
        return "T03_revenue_by_category"
    return None


def deterministic_template_entities(question: str) -> dict[str, list[str]]:
    outlets = [m.group(0).strip() for m in _OUTLET_NAME_RE.finditer(question or "")]
    return {"outlet_names": outlets, "product_names": [], "categories": [], "employee_names": []}


def deterministic_category_template_shortcut(question: str, time_range: dict[str, str]) -> dict[str, Any] | None:
    template_key = category_template_for_question(question)
    if template_key not in {"T03_revenue_by_category", "T17_category_contribution"}:
        return None
    return {
        "route": "data_query",
        "intent": "product_mix",
        "confidence": 0.99,
        "time_range": dict(time_range),
        "raw_entities": deterministic_template_entities(question),
        "template_key": template_key,
        "template_params": {"from_date": time_range["from_date"], "to_date": time_range["to_date"], "limit": None, "threshold": None},
        "needs_sql_writer": False,
        "clarification_question": None,
    }


def is_ai_sales_daily_outlet_list_question(question: str) -> bool:
    q = _fold_text(question)
    if not _AI_SALES_DAILY_DATASET_RE.search(q):
        return False
    return any(
        token in q
        for token in (
            "co nhung cua hang nao",
            "nhung cua hang nao",
            "cua hang nao",
            "outlet nao",
            "danh sach cua hang",
            "danh sach outlet",
            "liet ke cua hang",
            "liet ke outlet",
            "store list",
            "list outlet",
        )
    )


def deterministic_ai_sales_daily_outlet_shortcut(question: str) -> dict[str, Any] | None:
    if not is_ai_sales_daily_outlet_list_question(question):
        return None
    return {
        "route": "data_query",
        "intent": "lookup",
        "confidence": 0.99,
        "time_range": {"from_date": "", "to_date": ""},
        "raw_entities": deterministic_template_entities(question),
        "template_key": "T37_ai_sales_daily_outlets",
        "template_params": {},
        "needs_sql_writer": False,
        "clarification_question": None,
    }


def normalise_template_key(key: str | None) -> str | None:
    ensure_runtime_templates_loaded()
    if not key:
        return None
    if key in TEMPLATES:
        return key
    if key in list_templates():
        return key
    return None


def ensure_template_params(
    template_key: str | None,
    raw_params: dict[str, Any] | None,
    time_range: dict[str, str],
) -> dict[str, Any]:
    ensure_runtime_templates_loaded()
    if not template_key or template_key not in TEMPLATES:
        return {}
    meta = TEMPLATES[template_key]
    params = {k: v for k, v in (raw_params or {}).items() if v not in (None, "")}
    for required in meta.required_params:
        if not params.get(required) and required in time_range:
            params[required] = time_range[required]
    return params


def rank_direction_from_question(question: str) -> str | None:
    q = _fold_text(question)
    if any(term in q for term in ("thap nhat", "yeu nhat", "kem nhat", "te nhat", "lowest", "worst", "bottom")):
        return "asc"
    return None


def apply_question_derived_template_params(template_key: str | None, params: dict[str, Any], question: str) -> dict[str, Any]:
    if template_key != "T22_outlet_rank":
        return params
    rank_direction = rank_direction_from_question(question)
    if not rank_direction:
        return params
    return {**params, "rank_direction": rank_direction}


def verified_query_shortcut(*, question: str, intent: str | None, time_range: dict[str, str]) -> dict[str, Any] | None:
    try:
        match = select_verified_query(question=question, intent=intent, time_range=time_range)
    except Exception as exc:  # noqa: BLE001
        logger.warning("verified_query lookup failed: %s", exc)
        return None
    if not match:
        return None
    return {
        "template_key": match.template_key,
        "template_params": dict(match.params),
        "confidence": match.confidence,
        "asset": {
            "template_key": match.asset.template_key,
            "metric_ids": list(match.asset.metric_ids),
            "time_column": match.asset.time_column,
            "outlet_column": match.asset.outlet_column,
            "golden_cases": list(match.asset.golden_cases),
        },
    }
